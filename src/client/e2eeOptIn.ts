// ---------------------------------------------------------------------------
// The runtime switch that lets encryption be turned on from inside the app,
// without a rebuild.
//
// WHY THIS EXISTS. `VITE_E2EE` is a BUILD-time flag: changing it means a build
// and a deploy, so the operator could not try encryption on the deployed site
// at all. This adds a second, runtime source for the same answer, so a build
// with the flag off can still opt in on one browser.
//
// THE PASSPHRASE IS A SPEED BUMP, NOT A SECRET. It ships in the JavaScript
// bundle, which anybody can read, so it stops a curious user flipping a switch
// they did not mean to flip and stops nothing else. It is stated plainly here
// rather than obfuscated, because a hash in a public bundle would only look
// like security. If encryption ever needs to be gated for real, that gate
// belongs on the server, not in this file.
//
// PER BROWSER, NOT PER ACCOUNT. It is stored in localStorage, so it follows the
// browser rather than the user -- the same scope as every other local
// preference here, and the right one for "let me try this on this machine".
//
// Pure apart from the injected store (O-tp9), so the harness can drive it.
// ---------------------------------------------------------------------------

export const E2EE_PASSPHRASE = 'E2EETEST'

export const E2EE_OPT_IN_KEY = 'net.41chan.e2ee_opt_in'

// A store rather than a direct localStorage call, so the decision logic below
// can be checked in node, where there is no localStorage at all.
export interface OptInStore {
  read(): string | null
  write(value: string): void
  remove(): void
}

export function passphraseAccepted(input: string): boolean {
  // Trimmed because a pasted passphrase carries whitespace, and refusing the
  // right word for an invisible reason is the worst kind of refusal. NOT
  // case-folded: the operator was given an exact string.
  return input.trim() === E2EE_PASSPHRASE
}

export function readOptIn(store: OptInStore): boolean {
  try {
    return store.read() === '1'
  } catch {
    // A browser with storage disabled is not an opt-in. Failing closed here
    // means the worst case is encryption staying off, never turning itself on.
    return false
  }
}

export type OptInResult = 'enabled' | 'disabled' | 'bad-passphrase'

// Turning it ON takes the passphrase. Turning it OFF does not: a switch that
// demands a password to undo it is a trap, and the safe direction should never
// be the guarded one.
export function applyOptIn(store: OptInStore, passphrase: string, on: boolean): OptInResult {
  if (!on) {
    try { store.remove() } catch { /* nothing to undo */ }
    return 'disabled'
  }
  if (!passphraseAccepted(passphrase)) return 'bad-passphrase'
  try {
    store.write('1')
  } catch {
    // Storage refused. Say nothing succeeded rather than reporting success and
    // leaving the user with a switch that forgets itself on reload.
    return 'bad-passphrase'
  }
  return 'enabled'
}

// Does a change of this switch require a reload to take effect?
//
// ALWAYS YES when it changes, and the reason is not cosmetic: crypto is
// initialised once while the client is being built, so a session that started
// without it has no crypto object to hand to anything. Flipping the answer
// mid-session would render encryption UI over a client that cannot encrypt --
// which is precisely the false claim E10 forbids.
export function needsReload(before: boolean, after: boolean): boolean {
  return before !== after
}

export const browserOptInStore: OptInStore = {
  read: () => (typeof localStorage === 'undefined' ? null : localStorage.getItem(E2EE_OPT_IN_KEY)),
  write: (v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(E2EE_OPT_IN_KEY, v) },
  remove: () => { if (typeof localStorage !== 'undefined') localStorage.removeItem(E2EE_OPT_IN_KEY) },
}
