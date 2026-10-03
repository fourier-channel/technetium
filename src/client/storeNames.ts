// The names of the browser databases the client keeps, in one place, so code
// that must tell them apart -- above all, the purge that must never touch the
// encryption keys -- reads the same names the code that creates them uses.

// The rust crypto store for a device: `${CRYPTO_STORE_PREFIX}::<user>::<device>`
// plus the SDK's own suffixes. Holding these is holding the device's keys.
export const CRYPTO_STORE_PREFIX = 'matrix-js-sdk::matrix-sdk-crypto'
