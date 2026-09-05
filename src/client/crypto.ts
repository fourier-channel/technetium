import type { MatrixClient } from 'matrix-js-sdk'
import {
  CRYPTO_WASM_BYTES,
  CRYPTO_LOAD_IDLE,
  type CryptoLoadState,
} from './cryptoProgress'
import { isSilentAction, type CryptoIdentityFacts, type IdentityAction } from './cryptoIdentity'
import type { KeyBackupFacts } from './keyBackup'

// ---------------------------------------------------------------------------
// Bringing up the Rust crypto engine, and showing the user that it is
// happening.
//
// !!! ONE FRAGILE ASSUMPTION, ISOLATED HERE (same discipline as slidingSync) !!!
//
// The engine is a ~5.6MB wasm module (1.7-1.9MB on the wire, compressed) that
// matrix-js-sdk loads via `WebAssembly.instantiateStreaming(fetch(url))` inside
// the crypto package's `initAsync()`. That call exposes NO progress hook, and
// the URL is a build-time hashed asset we cannot name from here: the package's
// `exports` map has no subpaths, so `import '.../pkg/*.wasm?url'` is a hard
// build error (verified 2026-08-23, not assumed).
//
// So we do not try to name the URL. We wrap `fetch` for the duration of the
// load, tee the one response whose URL ends in `.wasm` through a byte counter,
// and put `fetch` back. The wrapper passes everything else through untouched,
// so its worst failure mode is doing nothing. This runs BEFORE `startClient`,
// so there is no sync traffic to race with.
//
// Why not alias the asset in vite.config and prefetch it by URL: that emits the
// file down a second path and warms a URL the SDK may not be the one asking
// for. A meter that measures a different download than the one being waited on
// is worse than no meter.
// ---------------------------------------------------------------------------

// Opt-in via env so the default path is untouched until this is proven against
// a live login. Set VITE_E2EE=1 to enable.
//
// Compared against the string '1', not truthiness: Vite env values are
// STRINGS, so !!'0' is true and the .env.production line VITE_E2EE=0 --
// written to pin the flag OFF -- was what switched it on in the first
// production build to carry it (2026-09-05, found live and unproven).
export function e2eeEnabled(): boolean {
  return import.meta.env.VITE_E2EE === '1'
}

// Where the crypto store lives in IndexedDB. Named, not inlined, because
// changing it orphans every key the user has -- see E8.
const CRYPTO_STORE_PREFIX = 'matrix-js-sdk::matrix-sdk-crypto'

type Report = (state: CryptoLoadState) => void

const isWasmUrl = (url: string): boolean => /\.wasm(\?|$)/.test(url)

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

// Tee one response body through a counter, preserving status and headers so
// `instantiateStreaming` still sees `application/wasm`.
//
// Exported for the check harness only. It is the one piece here that can fail
// SILENTLY and catastrophically: a tee that drops or reorders a chunk hands
// WebAssembly a corrupt module, and the error surfaces as a compile failure
// with no hint that a progress meter caused it.
export function countingResponse(
  res: Response,
  onBytes: (received: number) => void,
  onDone: () => void,
): Response {
  const body = res.body
  if (!body) return res
  let received = 0
  const counted = new ReadableStream<Uint8Array>({
    start(controller) {
      const reader = body.getReader()
      const pump = (): void => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              controller.close()
              onDone()
              return
            }
            received += value.byteLength
            onBytes(received)
            controller.enqueue(value)
            pump()
          })
          .catch((err: unknown) => {
            controller.error(err)
          })
      }
      pump()
    },
  })
  return new Response(counted, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}

// Run `work` with a fetch that reports progress on the wasm request.
//
// Restores the original fetch in a `finally`, so a throw inside `work` cannot
// leave the app running on a wrapped fetch forever.
async function withWasmProgress(
  onBytes: (received: number) => void,
  onDone: () => void,
  work: () => Promise<void>,
) {
  const original = globalThis.fetch
  const wrapped: typeof fetch = async (input, init) => {
    const res = await original(input, init)
    if (!isWasmUrl(urlOf(input)) || !res.ok) return res
    return countingResponse(res, onBytes, onDone)
  }
  globalThis.fetch = wrapped
  try {
    await work()
  } finally {
    globalThis.fetch = original
  }
}

// Bring up crypto, reporting progress as it goes.
//
// Resolves TRUE when crypto is usable and FALSE when it is not. It does not
// throw: a client without encryption is still a working client, and the caller
// must be able to carry on and tell the truth about the state (E10). The
// failure is reported through `report`, never swallowed (G-tc05).
//
// Must be called after createClient and before startClient.
export async function initCrypto(client: MatrixClient, report: Report): Promise<boolean> {
  let state: CryptoLoadState = { ...CRYPTO_LOAD_IDLE, phase: 'downloading' }
  const emit = (next: Partial<CryptoLoadState>) => {
    state = { ...state, ...next }
    report(state)
  }
  emit({})

  try {
    await withWasmProgress(
      (received) => emit({ received: Math.min(received, CRYPTO_WASM_BYTES) }),
      // The bytes are in; what remains is instantiation and opening the store,
      // which report nothing and can take a visible beat on a slow device.
      () => emit({ phase: 'installing', received: CRYPTO_WASM_BYTES }),
      async () => {
        // The wasm arrives during this call; the store opens after it, which is
        // why 'installing' is a separate phase rather than a spinner at 100%.
        await client.initRustCrypto({ useIndexedDB: true, cryptoDatabasePrefix: CRYPTO_STORE_PREFIX })
      },
    )
    emit({ phase: 'ready', received: CRYPTO_WASM_BYTES })
    return true
  } catch (err) {
    // Deliberate swallow, reported at the same moment (G-tc05). The message is
    // what the user reads, so it names the consequence rather than the cause.
    emit({
      phase: 'failed',
      error: 'Encryption could not be set up. Private chats will not be encrypted.',
    })
    console.error('[crypto] initRustCrypto failed', err)
    return false
  }
}

// ---------------------------------------------------------------------------
// Observing the account's cross-signing identity.
//
// Gathering only -- every decision made from these facts lives in the pure
// ./cryptoIdentity, so the branch that could destroy a user's keys is one the
// harness can prove over its whole input space rather than one buried in a
// component.
// ---------------------------------------------------------------------------

// Read the account's crypto identity, or null when crypto is not up.
//
// A failure to observe returns null rather than a guess. Every field here feeds
// a decision about whether something is safe to overwrite, and a defaulted
// `false` on `accountHasIdentity` is precisely the value that would make a
// reset look safe.
export async function observeCryptoIdentity(
  client: MatrixClient,
): Promise<CryptoIdentityFacts | null> {
  const crypto = client.getCrypto()
  const userId = client.getUserId()
  const deviceId = client.getDeviceId()
  if (!crypto || !userId || !deviceId) return null

  try {
    // `downloadUncached: true` -- this must be the SERVER's answer, not
    // whatever happens to be in the local cache on a fresh device. The local
    // cache on a fresh device is empty, and an empty cache read as "no identity
    // exists" is exactly the mistake this whole module is built to prevent.
    const accountHasIdentity = await crypto.userHasCrossSigningKeys(userId, true)
    const status = await crypto.getCrossSigningStatus()
    const cached = status.privateKeysCachedLocally
    const backup = await crypto.getKeyBackupInfo()
    const deviceStatus = await crypto.getDeviceVerificationStatus(userId, deviceId)
    const devices = await crypto.getUserDeviceInfo([userId])

    return {
      accountHasIdentity,
      // All three, not any: a partial set cannot sign or decrypt, and treating
      // it as "keys are here" strands the user on a device that silently
      // cannot do the thing it just claimed.
      privateKeysOnThisDevice: cached.masterKey && cached.selfSigningKey && cached.userSigningKey,
      privateKeysInSecretStorage: status.privateKeysInSecretStorage,
      keyBackupVersion: backup?.version ?? null,
      thisDeviceVerified: deviceStatus?.crossSigningVerified ?? false,
      otherDeviceCount: Math.max(0, (devices.get(userId)?.size ?? 1) - 1),
    }
  } catch (err) {
    // Reported, never swallowed (G-tc05). Null propagates as "we do not know",
    // which every caller must treat as "do nothing destructive".
    console.error('[crypto] could not read the account identity', err)
    return null
  }
}

// Perform the non-destructive setup actions, and only those.
//
// This function CANNOT reset. The SDK's reset option -- the single option that
// replaces an existing identity -- is absent by construction rather than passed
// as false, so no future edit can flip a boolean here. The reset lives in its
// own gated path (E11), the only place `resetPermitted` is consulted, and
// `checks/cryptoIdentity.check.ts` fails the build if that option's name
// appears in any other module.
export async function applySilentIdentityAction(
  client: MatrixClient,
  action: IdentityAction,
): Promise<boolean> {
  if (!isSilentAction(action) || action === 'ready') return action === 'ready'
  const crypto = client.getCrypto()
  if (!crypto) return false
  try {
    await crypto.bootstrapCrossSigning({})
    return true
  } catch (err) {
    console.error('[crypto] non-destructive cross-signing setup failed', err)
    return false
  }
}

// Connect this session to an EXISTING key backup, if there is one.
//
// Strictly non-destructive: `checkKeyBackupAndEnable` reads what is on the
// server and starts using it. It cannot create or replace a version -- the
// call that replaces one deletes the keys in the old version (G-e1), and lives
// with the gated reset, never here.
//
// Returns the facts rather than a boolean, so callers can tell "no backup
// exists" from "we could not find out". Those need different sentences.
export async function connectKeyBackup(client: MatrixClient): Promise<KeyBackupFacts | null> {
  const crypto = client.getCrypto()
  if (!crypto) return null
  try {
    const check = await crypto.checkKeyBackupAndEnable()
    const activeVersion = await crypto.getActiveSessionBackupVersion()
    return {
      backupExists: !!check,
      backupTrusted: check?.trustInfo?.trusted ?? false,
      activeVersion,
    }
  } catch (err) {
    // Reported, never swallowed (G-tc05). Null is "unknown", which callers
    // must not render as "no backup" -- that would tell a protected user they
    // are at risk, and an at-risk user nothing at all.
    console.error('[crypto] could not check the key backup', err)
    return null
  }
}
