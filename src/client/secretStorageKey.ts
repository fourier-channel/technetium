// ---------------------------------------------------------------------------
// The one place a recovery key is ever handed to the SDK.
//
// A recovery key is NOT the backup key. It is the key that unlocks secret
// storage, and the backup key -- and the private cross-signing keys -- live
// inside that. restoreFromRecoveryKey used to decode the typed key and store
// it AS the backup key, which is the pre-secret-storage model; against an
// account set up the modern way (Element's, and now the operator's) the MAC
// failed and the panel said "wrong key" about a key that was right.
//
// The SDK asks for the storage key through CryptoCallbacks.getSecretStorageKey,
// possibly several times in quick succession for a single operation. The key
// is held here ONLY for the duration of that operation, in memory, and cleared
// in a finally. It is never persisted: a recovery key is the one secret that
// must survive losing every device, and a copy on this device defeats it.
// ---------------------------------------------------------------------------
import type { CryptoCallbacks } from 'matrix-js-sdk/lib/crypto-api'

let pending: { keyId: string; key: Uint8Array<ArrayBuffer> } | null = null

export const cryptoCallbacks: CryptoCallbacks = {
  getSecretStorageKey: async ({ keys }) => {
    if (!pending) return null
    // Answer only for the key the user actually typed. If the SDK is asking
    // about some other key id, we do not know it, and saying so lets the
    // operation fail honestly instead of with a MAC error deep inside.
    if (!(pending.keyId in keys)) return null
    return [pending.keyId, pending.key]
  },
}

export async function withRecoveryKey<T>(
  keyId: string,
  key: Uint8Array<ArrayBuffer>,
  fn: () => Promise<T>,
): Promise<T> {
  pending = { keyId, key }
  try {
    return await fn()
  } finally {
    pending = null
  }
}
