// ---------------------------------------------------------------------------
// The crypto engine's arrival, as state -- separate from the code that fetches
// it, so the rules are checkable without a network (O-tp9).
//
// Two facts drive every awkward-looking line in this file.
//
// The wasm is served GZIPPED. `Content-Length` is therefore the COMPRESSED
// length, while the response stream yields DECODED bytes -- so the obvious
// `received / contentLength` meter runs to about 290% and looks broken
// (G-e3). The denominator has to be the true decompressed size, which is a
// constant known at build time and checked against the real asset.
//
// And a progress bar that lies is worse than no progress bar, so an unknown
// total resolves to null (indeterminate) rather than to a guess. Every
// ambiguous state here degrades toward "we do not know" instead of toward a
// number, which is E10 applied to a loading spinner.
// ---------------------------------------------------------------------------

// Decompressed byte length of matrix_sdk_crypto_wasm_bg.wasm as shipped by
// @matrix-org/matrix-sdk-crypto-wasm. This MUST track the real asset: it is the
// progress denominator, and a stale value aims the bar wrong without throwing.
// `checks/cryptoProgress.check.ts` reads the file out of node_modules and
// compares, per D-tc01 -- the drift fails the gate instead of shipping.
export const CRYPTO_WASM_BYTES = 5576598

export type CryptoPhase =
  // Not started, or deliberately off.
  | 'idle'
  // Bytes are moving.
  | 'downloading'
  // Bytes are here; the module is being instantiated and the store opened.
  | 'installing'
  // Usable.
  | 'ready'
  // Not usable, and we say so rather than pretending (E10).
  | 'failed'

export interface CryptoLoadState {
  phase: CryptoPhase
  // Decoded bytes received so far.
  received: number
  // Expected decoded total, or null when genuinely unknown.
  total: number | null
  // Present only when phase is 'failed'. Shown to the user, so it must read
  // as a consequence, not as a stack trace.
  error: string | null
}

export const CRYPTO_LOAD_IDLE: CryptoLoadState = {
  phase: 'idle',
  received: 0,
  total: CRYPTO_WASM_BYTES,
  error: null,
}

// Percent complete, or null when the bar must render indeterminate.
//
// Clamped at both ends on purpose. A cached response can deliver the whole
// body in one chunk before any total is known, and a total that is somehow
// smaller than what arrived must not produce 130% -- the bar's job is to stay
// believable, not to report the anomaly.
export function cryptoPercent(state: CryptoLoadState): number | null {
  if (state.phase === 'ready') return 100
  if (state.phase === 'idle' || state.phase === 'failed') return null
  if (state.phase === 'installing') return 100
  if (state.total === null || state.total <= 0) return null
  const pct = (state.received / state.total) * 100
  if (!Number.isFinite(pct)) return null
  return Math.max(0, Math.min(100, pct))
}

// Bytes as a human reads them. Binary units, one decimal past a megabyte,
// because "1.7 MB" and "2 MB" are different amounts of reassurance.
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  const kb = n / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

// The line under the bar. Never a raw error, never a lie.
export function cryptoProgressLabel(state: CryptoLoadState): string {
  switch (state.phase) {
    case 'idle':
      return 'Waiting'
    case 'downloading':
      return state.total === null
        ? formatBytes(state.received)
        : `${formatBytes(state.received)} of ${formatBytes(state.total)}`
    case 'installing':
      return 'Installing'
    case 'ready':
      return 'Ready'
    case 'failed':
      return state.error ?? 'Could not be installed'
  }
}

// Whether the arrival box should be on screen at all.
//
// 'ready' is excluded: the box exists to explain a wait, and a box that
// lingers after the wait is over is just a dialog to dismiss. 'failed' is
// INCLUDED -- a failure the user never sees is the silent-failure rule
// (G-tc05) with encryption behind it.
export function shouldShowCryptoBox(state: CryptoLoadState): boolean {
  return state.phase === 'downloading' || state.phase === 'installing' || state.phase === 'failed'
}
