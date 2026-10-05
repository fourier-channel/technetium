// ---------------------------------------------------------------------------
// The per-browser encryption switch -- which, since 2026-10-05, turns
// encryption OFF.
//
// Operator, 2026-10-05: "E2EE is defaulted to ON and the passphrase box in
// settings allows it to be turned OFF. Change it to 'E2EE' from 'E2EETEST'."
// Encryption is on in every build; there is no build flag any more. This
// browser can opt OUT, with the passphrase, and opt back in without one.
// (Until that day it was the other way round: off in production, and the
// passphrase -- then E2EETEST -- turned it on for one browser.)
//
// WHY OFF IS THE GUARDED DIRECTION NOW. Off is the one that costs something:
// direct messages started in this browser go out unencrypted and encrypted
// ones stop opening here. A speed bump belongs in front of that, and never in
// front of the way back -- a switch that needs a password to undo is a trap.
//
// THE PASSPHRASE IS A SPEED BUMP, NOT A SECRET. It ships in the bundle, which
// anybody can read; it stops a curious click and nothing else.
//
// PER BROWSER, in localStorage, like every other local preference here.
//
// FAILS TOWARDS ON. A store that cannot be read is not an opt-out: the worst
// a broken store can do is leave encryption on, never switch it off.
//
// Pure apart from the injected store (O-tp9), so the checks drive it. The
// file keeps its name because the rest of the tree and the docs know it by
// that name; what it decides is the opt-OUT.
// ---------------------------------------------------------------------------

export const E2EE_PASSPHRASE = 'E2EE'

export const E2EE_OPT_OUT_KEY = 'net.41chan.e2ee_opt_out'
// The old opt-IN key. Meaningless now (encryption is on without it); read
// by nothing, and removed whenever the switch is used so it does not linger.
export const LEGACY_E2EE_OPT_IN_KEY = 'net.41chan.e2ee_opt_in'

// A store rather than a direct localStorage call, so the decision logic can be
// checked in node, where there is no localStorage at all. Shared with domain
// mode's switch (domainMode.ts), which is a plain on-flag.
export interface OptInStore {
  read(): string | null
  write(value: string): void
  remove(): void
}

// Is the flag set? Only the exact string '1' counts; anything doubtful,
// including a store that throws, is "not set".
export function readFlag(store: OptInStore): boolean {
  try {
    return store.read() === '1'
  } catch {
    return false
  }
}

export function passphraseAccepted(input: string): boolean {
  // Trimmed because a pasted passphrase carries whitespace. NOT case-folded:
  // the operator was given an exact string.
  return input.trim() === E2EE_PASSPHRASE
}

// Has this browser turned encryption off? Not set, junk, or unreadable: no.
export function readOptOut(store: OptInStore): boolean {
  return readFlag(store)
}

export type OptOutResult = 'turned-off' | 'turned-on' | 'bad-passphrase'

// OFF takes the passphrase. ON (back to the default) does not.
export function applyOptOut(store: OptInStore, passphrase: string, off: boolean): OptOutResult {
  if (!off) {
    try { store.remove() } catch { /* nothing stored, nothing to undo */ }
    return 'turned-on'
  }
  if (!passphraseAccepted(passphrase)) return 'bad-passphrase'
  try {
    store.write('1')
  } catch {
    // Storage refused. Say nothing changed rather than reporting an off that
    // forgets itself on reload.
    return 'bad-passphrase'
  }
  return readFlag(store) ? 'turned-off' : 'bad-passphrase'
}

// Does a change of this switch require a reload to take effect?
//
// ALWAYS YES when it changes: crypto is initialised once while the client is
// built, so flipping the answer mid-session would draw encryption UI over a
// client that cannot encrypt, or the reverse -- the false claim E10 forbids.
export function needsReload(before: boolean, after: boolean): boolean {
  return before !== after
}

export const browserOptOutStore: OptInStore = {
  read: () => (typeof localStorage === 'undefined' ? null : localStorage.getItem(E2EE_OPT_OUT_KEY)),
  write: (v) => {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(E2EE_OPT_OUT_KEY, v)
    localStorage.removeItem(LEGACY_E2EE_OPT_IN_KEY)
  },
  remove: () => {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(E2EE_OPT_OUT_KEY)
    localStorage.removeItem(LEGACY_E2EE_OPT_IN_KEY)
  },
}
