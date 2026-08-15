// Checks for the egress consent model.
//
// The security-relevant property here is the DEFAULT, not the logic: every
// ambiguous state must resolve to blocked. A corrupted record, a storage
// failure, an unknown surface or a stale notice version must never become a
// silent opt-in to a third-party connection. Most of this file is that one
// property, approached from as many directions as I could find.
import {
  EGRESS_SURFACES,
  consentRows,
  deny,
  egressState,
  egressSurface,
  grant,
  mayReachOut,
  parseConsent,
  revoke,
  revokeAll,
  shouldPrompt,
  suppress,
  type ConsentMap,
} from '../src/client/egressConsent.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const NOW = 1_800_000_000_000
const GIF = 'gif.klipy'

console.log('\n-- register integrity --')
{
  const ids = EGRESS_SURFACES.map((s) => s.id)
  check('surface ids are unique', new Set(ids).size === ids.length)
  check('every surface names its operator', EGRESS_SURFACES.every((s) => !!s.operator))
  // "A third party" is not informed consent; the notice has to say what leaves.
  check('every surface lists what it discloses', EGRESS_SURFACES.every((s) => s.discloses.length > 0))
  check('every surface says what declining costs', EGRESS_SURFACES.every((s) => !!s.ifDeclined))
  check('every surface has a positive notice version',
    EGRESS_SURFACES.every((s) => Number.isInteger(s.noticeVersion) && s.noticeVersion > 0))
  check('lookup works', egressSurface(GIF)?.operator === 'KLIPY')
  check('an unknown id is null', egressSurface('nope') === null)
}

console.log('\n-- THE DEFAULT: everything ambiguous is blocked --')
{
  const empty: ConsentMap = {}
  check('no record at all -> unasked', egressState(empty, GIF) === 'unasked')
  check('and therefore may NOT reach out', !mayReachOut(empty, GIF))
  // The case that matters most: storage returned junk.
  check('null blob -> blocked', !mayReachOut(parseConsent(null), GIF))
  check('a string blob -> blocked', !mayReachOut(parseConsent('yes'), GIF))
  check('an array blob -> blocked', !mayReachOut(parseConsent([{ granted: true }]), GIF))
  check('a number blob -> blocked', !mayReachOut(parseConsent(42), GIF))
  // An unknown surface has nothing coherent to prompt about, so it is
  // suppressed rather than unasked -- blocked either way.
  check('an unknown surface may not reach out', !mayReachOut(empty, 'gif.whoever'))
  check('and does not prompt', !shouldPrompt(empty, 'gif.whoever'))
}

console.log('\n-- malformed records are DROPPED, never coerced --')
{
  const truthy = parseConsent({ [GIF]: { granted: 'yes', version: 1, at: NOW } })
  check('a string "yes" is not a grant', !mayReachOut(truthy, GIF))
  check('and the record is dropped entirely', !(GIF in truthy))

  const noVersion = parseConsent({ [GIF]: { granted: true, at: NOW } })
  check('a grant with no version is dropped', !mayReachOut(noVersion, GIF))

  const nanVersion = parseConsent({ [GIF]: { granted: true, at: NOW, version: Number.NaN } })
  check('a NaN version is dropped', !mayReachOut(nanVersion, GIF))

  const nested = parseConsent({ [GIF]: 'granted' })
  check('a string record is dropped', !(GIF in nested))

  // A missing timestamp is survivable -- it is display metadata, not the
  // decision -- so the record is kept with at:0 rather than thrown away.
  const noAt = parseConsent({ [GIF]: { granted: true, version: 1 } })
  check('a missing timestamp does not void a valid grant', mayReachOut(noAt, GIF))
  check('and reads as 0', noAt[GIF].at === 0)
}

console.log('\n-- grant / deny / suppress --')
{
  const g = grant({}, GIF, NOW, { readPolicy: true })
  check('granting allows the request', mayReachOut(g, GIF))
  check('and stops prompting', !shouldPrompt(g, GIF))
  check('it records the notice version it answered', g[GIF].version === egressSurface(GIF)!.noticeVersion)
  check('and whether the policy was opened', g[GIF].readPolicy === true)

  const d = deny({}, GIF, NOW)
  check('denying blocks', !mayReachOut(d, GIF))
  check('and WILL ask again next time', shouldPrompt(d, GIF))

  const s = suppress({}, GIF, NOW)
  check('suppressing blocks', !mayReachOut(s, GIF))
  check('and does NOT ask again', !shouldPrompt(s, GIF))
  check('suppressed is its own state', egressState(s, GIF) === 'suppressed')

  // Refusing to write a record for a surface that does not exist: it would
  // become a live grant the moment that id was added to the register.
  check('granting an unknown surface is a no-op', Object.keys(grant({}, 'nope', NOW)).length === 0)
  check('denying an unknown surface is a no-op', Object.keys(deny({}, 'nope', NOW)).length === 0)
}

console.log('\n-- a notice version bump re-asks (D-eg02) --')
{
  const current = egressSurface(GIF)!.noticeVersion
  const stale = parseConsent({ [GIF]: { granted: true, at: NOW, version: current - 1 } })
  check('an old grant does NOT carry forward', !mayReachOut(stale, GIF))
  check('it reads as unasked', egressState(stale, GIF) === 'unasked')
  check('and it prompts again', shouldPrompt(stale, GIF))

  // A record from a version this client does not know about is equally not an
  // answer to the notice this client would show.
  const future = parseConsent({ [GIF]: { granted: true, at: NOW, version: current + 5 } })
  check('a future-version grant does not carry either', !mayReachOut(future, GIF))

  // But suppression is not a grant, and outlives a bump: someone who asked not
  // to be bothered has not agreed to be bothered by a new edition.
  const supStale = parseConsent({
    [GIF]: { granted: false, at: NOW, version: current - 1, suppressed: true },
  })
  check('suppression survives a version bump', egressState(supStale, GIF) === 'suppressed')
  check('and still does not prompt', !shouldPrompt(supStale, GIF))
}

console.log('\n-- revocation resets to UNASKED, not denied (D-eg04) --')
{
  const g = grant({}, GIF, NOW)
  const r = revoke(g, GIF)
  check('revoking blocks the surface', !mayReachOut(r, GIF))
  check('it reads as unasked, not denied', egressState(r, GIF) === 'unasked')
  // The behavioural difference that makes the two switches worth having.
  check('so it prompts again next use', shouldPrompt(r, GIF))
  check('the record is gone entirely', !(GIF in r))
  check('revoking something never granted is a no-op', Object.keys(revoke({}, GIF)).length === 0)

  const all = revokeAll()
  check('revoke-all clears everything', Object.keys(all).length === 0)
  check('and blocks every surface', EGRESS_SURFACES.every((s) => !mayReachOut(all, s.id)))
}

console.log('\n-- immutability: no operation mutates its input --')
{
  const before = grant({}, GIF, NOW)
  const snapshot = JSON.stringify(before)
  deny(before, GIF, NOW + 1)
  suppress(before, GIF, NOW + 1)
  revoke(before, GIF)
  check('the original map is untouched', JSON.stringify(before) === snapshot)
}

console.log('\n-- rows for the "information you have shared" view --')
{
  const rows = consentRows(grant({}, GIF, NOW))
  check('one row per registered surface', rows.length === EGRESS_SURFACES.length)
  // Register order, not object key order, or the list reshuffles as the user
  // toggles things.
  check('rows follow register order',
    rows.map((r) => r.surface.id).join(',') === EGRESS_SURFACES.map((s) => s.id).join(','))
  const gifRow = rows.find((r) => r.surface.id === GIF)!
  check('a granted row reports granted', gifRow.state === 'granted')
  check('and carries its timestamp', gifRow.at === NOW)
  const other = rows.find((r) => r.surface.id !== GIF)!
  check('an untouched row reports unasked', other.state === 'unasked')
  check('and carries no timestamp', other.at === undefined)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
