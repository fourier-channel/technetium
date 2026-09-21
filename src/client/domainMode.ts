import { type OptInStore, readOptIn } from './e2eeOptIn'

// ---------------------------------------------------------------------------
// Whether domain mode exists for this user at all.
//
// WHY. Launch is imminent and domain mode is not ready (operator, 2026-09-21).
// It stays in the tree, fully built and fully tested, and simply is not
// offered: a half-finished feature nobody can reach ships better than one
// ripped out in a hurry, and ripping it out is the change most likely to break
// something else on the day.
//
// THREE SOURCES, IN THIS ORDER, and the order is the design:
//
//   1. VITE_DOMAIN=1     -- a build says yes. This is how a dev build has it.
//   2. import.meta.env.DEV -- any dev server has it without configuring
//      anything, because "enabled in dev" was the actual request.
//   3. the per-browser opt-in -- how the operator plays with it on the
//      DEPLOYED site, which a build flag alone cannot do. The same reason
//      e2eeOptIn.ts exists, and deliberately the same shape: a build flag is
//      not reachable from a browser, and asking for a deploy to try something
//      is how a feature stops being tried.
//
// FAIL CLOSED. Anything unreadable, unset or unrecognised is OFF. The worst
// case of a bug in this file must be that domain mode stays hidden, never that
// it appears for everybody on launch day.
//
// Pure apart from the injected env and store (O-tp9), so the decision is
// checkable in node where there is neither.
// ---------------------------------------------------------------------------

export const DOMAIN_OPT_IN_KEY = 'net.41chan.domain_opt_in'

// The same speed bump as encryption's, and the same honesty about it: this
// ships in the bundle, anybody can read it, and it stops a curious user
// flipping a switch they did not mean to flip and stops nothing else. If
// domain mode ever needs to be gated for real, that gate belongs on the
// server.
export const DOMAIN_PASSPHRASE = 'DOMAINTEST'

export function domainPassphraseAccepted(input: string): boolean {
  return input.trim() === DOMAIN_PASSPHRASE
}

export const domainOptInStore: OptInStore = {
  read: () => (typeof localStorage === 'undefined' ? null : localStorage.getItem(DOMAIN_OPT_IN_KEY)),
  write: (v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(DOMAIN_OPT_IN_KEY, v) },
  remove: () => { if (typeof localStorage !== 'undefined') localStorage.removeItem(DOMAIN_OPT_IN_KEY) },
}

export interface DomainEnv {
  /** import.meta.env.VITE_DOMAIN */
  flag?: unknown
  /** import.meta.env.DEV */
  dev?: unknown
}

/**
 * The decision, as a pure function of the two things that decide it.
 *
 * `'1'` and nothing else turns the build flag on: a stray VITE_DOMAIN=0 or
 * VITE_DOMAIN=false must not read as yes, which is the failure a truthiness
 * test invites and the one that would put it in front of everybody.
 */
export function domainEnabledFrom(env: DomainEnv, store: OptInStore | null): boolean {
  if (env.flag === '1') return true
  if (env.dev === true) return true
  if (!store) return false
  return readOptIn(store)
}

/** The same decision, asked of this build and this browser. */
export function domainEnabled(): boolean {
  return domainEnabledFrom(
    { flag: import.meta.env.VITE_DOMAIN, dev: import.meta.env.DEV },
    domainOptInStore,
  )
}

export type DomainOptInResult = 'enabled' | 'disabled' | 'bad-passphrase'

/**
 * Turning it ON takes the passphrase; turning it OFF does not.
 *
 * A switch that demands a password to undo it is a trap, and the safe
 * direction should never be the guarded one -- the same rule e2eeOptIn.ts
 * states, and it is a rule rather than a coincidence.
 */
export function applyDomainOptIn(store: OptInStore, passphrase: string, on: boolean): DomainOptInResult {
  if (!on) {
    try { store.remove() } catch { /* nothing to undo */ }
    return 'disabled'
  }
  if (!domainPassphraseAccepted(passphrase)) return 'bad-passphrase'
  try {
    store.write('1')
  } catch {
    // Storage refused. Report nothing succeeded rather than leaving the user
    // with a switch that forgets itself on reload.
    return 'bad-passphrase'
  }
  return 'enabled'
}
