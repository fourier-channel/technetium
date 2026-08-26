'use strict'

// ---------------------------------------------------------------------------
// What this window is allowed to navigate to.
//
// The risk being managed is narrow: a link in a message navigating the app
// window away from the client, in a frame with no address bar to get back with.
// Those go to the user's real browser. First-party hosts do not -- and getting
// that boundary wrong is not a cosmetic failure, it BREAKS LOGIN, because MAS
// sign-in is a full-page navigation off-origin and back.
//
// Paid for once: the first version listed hosts from memory (tc, 41chan,
// matrix) and omitted the identity provider, which lives on its own host
// discovered at runtime. Sign-in was ejected to the system browser, MAS
// redirected there, and the callback landed in a browser holding none of the
// state the app had stored -- surfacing as "the state available to log in is
// not in storage on this machine", which names the symptom and hides the cause.
//
// So the rule is DERIVED, not enumerated: the app origin, plus any https host
// in the same registrable domain as the app origin. auth, matrix, mxc and any
// future first-party host are covered without another edit, and another edit is
// exactly what went missing last time.
// ---------------------------------------------------------------------------

// Last two labels of the app's own host. Deliberately not a hardcoded literal:
// it follows TECHNETIUM_ORIGIN, so a staging origin allows its own siblings and
// not production's.
function baseDomainOf(host) {
  const labels = host.split('.')
  return labels.length >= 2 ? labels.slice(-2).join('.') : host
}

function isFirstParty(url, appOrigin) {
  let u, app
  try {
    u = new URL(url)
    app = new URL(appOrigin)
  } catch {
    return false
  }

  // Compared on parsed origin, never string prefix: `https://tc.41chan.net.evil.tld`
  // starts with our origin as text and is a different site.
  if (u.origin === app.origin) return true

  // A loopback or bare-host dev origin has no meaningful sibling zone, so it
  // gets exact-match only rather than a suffix rule over `0.1` or `localhost`.
  const appHost = app.hostname
  if (appHost === 'localhost' || /^[0-9.]+$/.test(appHost)) return false

  if (u.protocol !== 'https:') return false

  const base = baseDomainOf(appHost)
  return u.hostname === base || u.hostname.endsWith('.' + base)
}

module.exports = { isFirstParty, baseDomainOf }
