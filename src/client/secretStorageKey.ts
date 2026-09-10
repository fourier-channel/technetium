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

// The key the SDK has JUST CREATED, during a set-up or a rotation. The SDK
// makes the key, hands it to cacheSecretStorageKey, and then asks for it back
// through getSecretStorageKey to write the identity and backup secrets into
// the new storage. Answering only for a typed key left that ask unanswered:
// "getSecretStorageKey callback returned falsey", seen live 2026-09-10, and
// every set-up failed after the account data was already written. Same
// discipline as `pending`: held only inside withCreatedKey, cleared in a
// finally, never persisted.
let created: { keyId: string; key: Uint8Array<ArrayBuffer> } | null = null

export const cryptoCallbacks: CryptoCallbacks = {
  getSecretStorageKey: async ({ keys }) => {
    // Answer only for a key we actually hold. If the SDK is asking about
    // some other key id, we do not know it, and saying so lets the
    // operation fail honestly instead of with a MAC error deep inside.
    if (pending && pending.keyId in keys) return [pending.keyId, pending.key]
    if (created && created.keyId in keys) return [created.keyId, created.key]
    return null
  },
  cacheSecretStorageKey: (keyId, _keyInfo, key) => {
    // Outside a creating operation there is nothing to hold it for, and
    // holding it anyway would be the persistence this module refuses.
    if (!creating) return
    created = { keyId, key: key as Uint8Array<ArrayBuffer> }
  },
}

let creating = false

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

// Wrap an operation that CREATES a secret storage key. Whatever the SDK
// caches through cacheSecretStorageKey inside is answered back to it, and
// forgotten the moment the operation ends, however it ends.
export async function withCreatedKey<T>(fn: () => Promise<T>): Promise<T> {
  creating = true
  try {
    return await fn()
  } finally {
    creating = false
    created = null
  }
}
