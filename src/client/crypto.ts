import type { MatrixClient } from 'matrix-js-sdk'
import {
  CRYPTO_WASM_BYTES,
  CRYPTO_LOAD_IDLE,
  type CryptoLoadState,
} from './cryptoProgress'

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
export function e2eeEnabled(): boolean {
  return !!import.meta.env.VITE_E2EE
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
