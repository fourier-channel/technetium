// The QuickQueue panel's height, per browser: a screen-sized preference, so
// it stays with the screen rather than following the account. Kept apart from
// folderStore.ts so the drawer, which is in the main bundle, does not pull the
// panel's IndexedDB code in with it.

const HEIGHT_KEY = 'net.41chan.qq_panel_h'

export function storedPanelHeight(): number | null {
  try {
    const v = localStorage.getItem(HEIGHT_KEY)
    const n = v === null ? NaN : Number(v)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function storePanelHeight(px: number): void {
  try { localStorage.setItem(HEIGHT_KEY, String(Math.round(px))) } catch { /* a convenience, not a record */ }
}
