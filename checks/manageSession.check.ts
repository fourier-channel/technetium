// Manage session (operator, 2026-10-05): "Build it into Technetium via a
// 'manage session' button under the user avatar in the room list. Move the
// E2EE options to that dropdown." It shows the life of each token, live, as
// the booru's card does -- the PIP2 sentence "The life of any given token is
// displayed at all times" was true only on the booru (claims sweep 2026-10-04).
//
// The sentences are proved over the clock (tokenLife.ts is pure); the record
// that feeds them is proved to be written at sign-in and at every refresh;
// the placement and the move are read from source. The dropdown's look is
// rendered in tools/visual/session.html; the live countdown against a real
// sign-in is not something this box can show.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  accessTokenLine,
  booruLines,
  formatSpan,
  readBooruStatus,
  refreshTokenLine,
  type BooruRead,
} from '../src/client/tokenLife.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const root = fileURLToPath(new URL('../', import.meta.url))
const read = (p: string) => readFileSync(join(root, p), 'utf8')
function walk(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((n) => {
    const p = `${dir}/${n}`
    return statSync(join(root, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []
  })
}

const T = 1_800_000_000_000 // a fixed "now"
const MIN = 60_000

console.log('== the countdown reads like a countdown')
check('seconds under a minute', formatSpan(42_000) === '0m 42s', formatSpan(42_000))
check('minutes and seconds under an hour', formatSpan(4 * MIN + 5_000) === '4m 05s', formatSpan(4 * MIN + 5_000))
check('hours and minutes under a day', formatSpan(67 * MIN) === '1h 07m', formatSpan(67 * MIN))
check('days and hours beyond', formatSpan((3 * 24 + 2) * 60 * MIN) === '3d 2h')
check('never negative', formatSpan(-5_000) === '0m 00s')

console.log('== the access token')
{
  const live = accessTokenLine(T + 4 * MIN + 5_000, T)
  check('live: how long is left, and that it renews by itself', live.tone === 'ok' && /^4m 05s left\. It renews by itself/.test(live.text), live)
  const later = accessTokenLine(T + 4 * MIN + 5_000, T + 1_000)
  check('and it counts down as the clock moves', /^4m 04s left/.test(later.text), later.text)
  const lapsed = accessTokenLine(T - 90_000, T)
  check('lapsed: how long ago, and that there is nothing to do', lapsed.tone === 'warn' && /^Lapsed 1m 30s ago\. It renews by itself on the next request/.test(lapsed.text), lapsed)
  const unknown = accessTokenLine(undefined, T)
  check('not recorded: says so, invents no time', unknown.tone === 'unknown' && /not recorded/.test(unknown.text) && !/\d+m/.test(unknown.text), unknown)
}

console.log('== the refresh token')
{
  const r = refreshTokenLine(true, T - 12 * MIN, T)
  check('held: when it was issued, and that it has no clock', r.tone === 'ok' && /^Issued 12m 00s ago\./.test(r.text) && /has no clock/.test(r.text) && /ends when you log out/.test(r.text), r)
  check('held but not recorded: says so', /was not recorded/.test(refreshTokenLine(true, undefined, T).text))
  const none = refreshTokenLine(false, undefined, T)
  check('none: says this sign-in ends with the access token', none.tone === 'bad' && /sign in again/.test(none.text), none)
}

console.log('== the booru, as session_status says it')
{
  const serverNow = 1_700_000_000 // the booru's clock, seconds
  // The booru's clock an hour BEHIND ours: the remaining time must be the
  // booru's own count, not ours against its timestamp.
  const readAt = T
  const status = {
    booru: { signed_in: true, name: 'saber', started_at: serverNow - 3600 },
    matrix: { linked: true, info: { expires_at: serverNow + 5 * 3600 } },
    now: serverNow,
  }
  const lines = booruLines({ state: 'read', status, readAt }, T + 30_000)
  const acct = lines.find((l) => l.label === 'Booru account')
  const pass = lines.find((l) => l.label === 'Booru picture pass')
  check('the account: signed in as whom, for how long, aged by our clock since the read',
    acct?.tone === 'ok' && /^Signed in as saber, for 1h 00m\./.test(acct.text), acct)
  check('the pass: its life by the booru\'s own count, aged since the read, whatever our clock says',
    pass?.tone === 'ok' && /^4h 59m left\./.test(pass.text), pass)
  const ended = booruLines({ state: 'read', status, readAt }, T + 5 * 3600_000 + 60_000)
  check('a pass past its end says ended, and what happens next',
    ended.find((l) => l.label === 'Booru picture pass')?.tone === 'warn' && /^Ended 1m 00s ago/.test(ended.find((l) => l.label === 'Booru picture pass')!.text))
  const noInfo = booruLines({ state: 'read', status: { ...status, matrix: { linked: true, info: null } }, readAt }, T)
  check('an expiry the booru does not publish is said to be unpublished, not invented',
    noInfo.find((l) => l.label === 'Booru picture pass')?.tone === 'unknown' && !/left/.test(noInfo.find((l) => l.label === 'Booru picture pass')!.text))
  const none = booruLines({ state: 'read', status: { booru: { signed_in: false }, matrix: { linked: false }, now: serverNow }, readAt }, T)
  check('no account and no pass: both said', /Not signed in/.test(none[0].text) && /^None/.test(none[1].text), none)
  const failed = booruLines({ state: 'failed', why: 'HTTP 403' }, T)
  check('a failed read names its reason and the remedy', failed.length === 1 && failed[0].tone === 'bad' && /HTTP 403/.test(failed[0].text) && /Read it again/.test(failed[0].text), failed)
  check('reading is said as reading, never as a state', booruLines({ state: 'reading' }, T)[0].tone === 'unknown' && booruLines(null, T)[0].tone === 'unknown')
}

console.log('== the read itself')
{
  const calls: { url: string; init: RequestInit }[] = []
  const r = await readBooruStatus(async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ now: 1 }) } }, 'https://b', () => T)
  check('GET modulation/session_status with this browser\'s cookies',
    calls[0].url === 'https://b/modulation/session_status' && calls[0].init.credentials === 'include' && (calls[0].init.method ?? 'GET') === 'GET', calls[0])
  check('and no header that would force a preflight', Object.keys((calls[0].init.headers ?? {}) as Record<string, string>).every((h) => /^(accept|content-type)$/i.test(h)))
  check('the reading carries when it was taken', (r as Extract<BooruRead, { state: 'read' }>).readAt === T)
  const bad = await readBooruStatus(async () => ({ ok: false, status: 403, json: async () => ({}) }), 'https://b', () => T)
  check('a refusal is a failure with its status', bad.state === 'failed' && bad.why === 'HTTP 403', bad)
  const gone = await readBooruStatus(async () => { throw new TypeError('x') }, 'https://b', () => T)
  check('no answer is a failure, never a throw', gone.state === 'failed' && gone.why === 'no answer', gone)
  const junk = await readBooruStatus(async () => ({ ok: true, status: 200, json: async () => null }), 'https://b', () => T)
  check('an answer that is not a session is not read as one', junk.state === 'failed', junk)
}

console.log('== the record behind it: written at sign-in and at every refresh, and watched')
{
  const store = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  }
  const { saveSession, clearSession, subscribeSession, storedSessionRaw, parseSession } = await import('../src/client/session.ts')
  let seen = 0
  const off = subscribeSession(() => { seen++ })
  const rec = { homeserverUrl: 'h', accessToken: 'a', userId: 'u', deviceId: 'd', oidc: { issuer: 'i', clientId: 'c', redirectUri: 'r', idTokenClaims: {} }, accessTokenExpiresAt: T }
  saveSession(rec)
  const snap1 = storedSessionRaw()
  check('a save tells the watcher, so an open panel follows a refresh', seen === 1)
  check('the snapshot is stable until the record changes (a string, compared by value)', storedSessionRaw() === snap1)
  check('and parses back to what was saved', parseSession(snap1)?.accessTokenExpiresAt === T)
  clearSession()
  check('a clear tells it too', seen === 2 && storedSessionRaw() === null)
  off()
  saveSession(rec)
  check('and an unsubscribed watcher hears nothing more', seen === 2)
  check('a corrupt record parses as none, not a throw', parseSession('{nope') === null)

  const ctx = read('src/client/ClientContext.tsx')
  check('sign-in records the access token\'s expiry from expires_in, counted from when it was REQUESTED',
    /const requestedAt = Date\.now\(\)\s*\n\s*const result = await sdk\.completeAuthorizationCodeGrant/.test(ctx) &&
    /accessTokenExpiresAt: typeof expiresIn === 'number' \? issuedAt \+ expiresIn \* 1000 : undefined/.test(ctx) &&
    /const issuedAt = requestedAt/.test(ctx))
  check('and the refresh token\'s issue time', /refreshTokenIssuedAt: result\.tokenResponse\.refresh_token \? issuedAt : undefined/.test(ctx))
  const refresher = read('src/client/tokenRefresher.ts')
  check('every refresh records the new expiry the SDK computed, dropping none it was not given',
    /expiry\?: Date/.test(refresher) && /accessTokenExpiresAt: tokens\.expiry \? tokens\.expiry\.getTime\(\) : undefined/.test(refresher))
  check('and restarts the refresh token\'s clock only when MAS actually rotated it',
    /refreshTokenIssuedAt: tokens\.refreshToken && tokens\.refreshToken !== s\.refreshToken \? Date\.now\(\) : s\.refreshTokenIssuedAt/.test(refresher))
}

console.log('== where it is, and what moved into it')
{
  const app = read('src/App.tsx')
  const card = app.indexOf('<div className="tc-me">')
  const ms = app.indexOf('<ManageSession />')
  check('the button sits under the avatar card, above the four pills',
    card > 0 && ms > app.indexOf('className="tc-me-card"', card) && ms < app.indexOf('<div className="tc-me-actions">', card) && ms > app.indexOf('<MeName', card))
  const ui = read('src/ui/ManageSession.tsx')
  check('it is a dropdown in the house sense: AnchoredPopup, over the page, nothing pushed aside',
    /<AnchoredPopup anchorRef=\{button\}/.test(ui) && /import \{ AnchoredPopup \} from '\.\/AnchoredPopup'/.test(ui))
  check('it counts in seconds, from the shared clock, not Date.now() in render (G-tc02)',
    /const now = useNowEverySecond\(\)/.test(ui) && !/Date\.now\(\)/.test(ui))
  check('it watches the record, so a refresh while open moves the countdown',
    /useSyncExternalStore\(subscribeSession, storedSessionRaw, storedSessionRaw\)/.test(ui))
  check('and the encryption options are inside it', /<EncryptionOptions \/>/.test(ui))
  // The clock re-renders what reads it every second; the encryption section
  // must not be one of those (no compiler memoises it here).
  const lives = ui.slice(ui.indexOf('function TokenLives('))
  check('the per-second clock is read in the countdown alone, a sibling of the encryption section',
    /useNowEverySecond\(\)/.test(lives) && !/<EncryptionOptions/.test(lives) &&
    !/useNowEverySecond\(\)/.test(ui.slice(0, ui.indexOf('function TokenLives('))))
  const mounts = walk('src').filter((f) => /<EncryptionOptions \/>/.test(read(f)))
  check('mounted there and nowhere else', mounts.length === 1 && mounts[0] === 'src/ui/ManageSession.tsx', mounts)
  const settings = read('src/ui/SettingsDialog.tsx')
  const gone = ['e2eeOptIn', 'restoreFromRecoveryKey', 'performReset', 'startDeviceVerification', 'listSessions', 'createRecovery', "tab === 'encryption'"]
    .filter((n) => settings.includes(n))
  check('Settings carries none of it any more (moved, not copied)', gone.length === 0, gone)
  check('and Settings says where it went', /under <strong>Manage session<\/strong>, below your name in the room list/.test(settings))
  const enc = read('src/ui/EncryptionOptions.tsx')
  check('the moved panel keeps its own rules: the switch first, the reset last',
    enc.indexOf('tc-settings-optin') > 0 && enc.indexOf('tc-settings-optin') < enc.indexOf('Your devices') && enc.lastIndexOf('If you have lost everything') > enc.indexOf('Your devices'))
  const stale = walk('src').filter((f) => /Settings (>|&gt;) Encryption/.test(read(f)))
  check('nothing still sends people to Settings > Encryption', stale.length === 0, stale)
  const css = read('src/index.css')
  const pop = css.slice(css.indexOf('.tc-anchored-pop.tc-manage-session {'), css.indexOf('}', css.indexOf('.tc-anchored-pop.tc-manage-session {')))
  check('one fixed width that fits the window, so a phone gets all of it', /width: min\(\d+rem, calc\(100vw - 16px\)\);/.test(pop), pop)
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nmanage session: all checks passed')
