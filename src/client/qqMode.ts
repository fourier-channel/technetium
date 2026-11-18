import { type OptInStore, readFlag } from './e2eeOptIn'

// ---------------------------------------------------------------------------
// Whether QuickQueue (tc.152) exists for this user at all.
//
// QuickQueue is being built in steps and is not finished, so it is HELD the
// way domain mode is (domainMode.ts says why, at length): in the tree, built
// and checked, and not offered. Same three sources in the same order --
//
//   1. VITE_QQ=1           -- a build says yes;
//   2. import.meta.env.DEV -- any dev server has it with nothing configured;
//   3. the per-browser opt-in under Settings > Unfinished features, which is
//      how the operator tries it on the DEPLOYED site.
//
// FAIL CLOSED. Unset, unreadable or unrecognised is OFF: the worst a bug here
// may do is keep QuickQueue hidden, never show it to everybody.
//
// Pure apart from the injected env and store (O-tp9); checks/qqMode drives it.
// ---------------------------------------------------------------------------

export const QQ_OPT_IN_KEY = 'net.41chan.qq_opt_in'

// A speed bump, not a lock: it ships in the bundle. It stops a curious user
// flipping a switch they did not mean to, and nothing else.
export const QQ_PASSPHRASE = 'QQTEST'

export function qqPassphraseAccepted(input: string): boolean {
  return input.trim() === QQ_PASSPHRASE
}

export const qqOptInStore: OptInStore = {
  read: () => (typeof localStorage === 'undefined' ? null : localStorage.getItem(QQ_OPT_IN_KEY)),
  write: (v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(QQ_OPT_IN_KEY, v) },
  remove: () => { if (typeof localStorage !== 'undefined') localStorage.removeItem(QQ_OPT_IN_KEY) },
}

export interface QqEnv {
  /** import.meta.env.VITE_QQ */
  flag?: unknown
  /** import.meta.env.DEV */
  dev?: unknown
}

/** `'1'` and nothing else turns the build flag on; `true` and nothing else is a dev server. */
export function qqEnabledFrom(env: QqEnv, store: OptInStore | null): boolean {
  if (env.flag === '1') return true
  if (env.dev === true) return true
  if (!store) return false
  return readFlag(store)
}

export function qqEnabled(): boolean {
  return qqEnabledFrom({ flag: import.meta.env.VITE_QQ, dev: import.meta.env.DEV }, qqOptInStore)
}

export type QqOptInResult = 'enabled' | 'disabled' | 'bad-passphrase'

/** Turning it ON takes the passphrase; turning it OFF never does (a switch that
 *  demands a password to undo it is a trap). */
export function applyQqOptIn(store: OptInStore, passphrase: string, on: boolean): QqOptInResult {
  if (!on) {
    try { store.remove() } catch { /* nothing to undo */ }
    return 'disabled'
  }
  if (!qqPassphraseAccepted(passphrase)) return 'bad-passphrase'
  try {
    store.write('1')
  } catch {
    return 'bad-passphrase'
  }
  return 'enabled'
}
