// Checks for W3.6 user-candidate resolution. See checks/relations.check.ts for
// how these run (`npm run check`).
import {
  describeInviteError,
  isValidMxid,
  mergeCandidates,
} from '../src/client/userDirectory.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log('  ok   ' + name)
  } else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

console.log('\n-- isValidMxid --')
{
  check('plain', isValidMxid('@a:x.net'))
  check('dotted localpart', isValidMxid('@first.last:x.net'))
  check('server with a port', isValidMxid('@a:x.net:8448'))
  check('leading/trailing space tolerated', isValidMxid('  @a:x.net  '))
  check('no sigil', !isValidMxid('a:x.net'))
  check('no server', !isValidMxid('@a'))
  check('empty', !isValidMxid(''))
  check('inner space', !isValidMxid('@a b:x.net'))
  check('a bare name is not an id', !isValidMxid('saber'))
}

console.log('\n-- mergeCandidates --')
{
  const local = [{ userId: '@a:x.net', displayName: 'Alice' }]
  const dir = [{ userId: '@b:x.net', displayName: 'Bob' }]

  const out = mergeCandidates(local, dir, '', new Set())
  check('local first', out[0].userId === '@a:x.net')
  check('directory after', out[1].userId === '@b:x.net')

  // A directory hit for someone already known locally must not double up --
  // the local entry has the better display name in context.
  const dupe = mergeCandidates(local, [{ userId: '@a:x.net' }], '', new Set())
  check('a duplicate is dropped', dupe.length === 1)
  check('the LOCAL entry is kept', dupe[0].displayName === 'Alice')

  // Yourself, and people already in the room, are excluded by the caller.
  const excluded = mergeCandidates(local, dir, '', new Set(['@a:x.net']))
  check('excluded ids are removed', !excluded.some((u) => u.userId === '@a:x.net'))
  check('others survive exclusion', excluded.some((u) => u.userId === '@b:x.net'))

  // A hand-typed id is the fallback and goes LAST -- surfacing it above real
  // matches would let a typo outrank the person being looked for.
  const raw = mergeCandidates(local, dir, '@c:x.net', new Set())
  check('raw mxid included', raw.some((u) => u.userId === '@c:x.net'))
  check('raw mxid is LAST', raw[raw.length - 1].userId === '@c:x.net')

  const rawDupe = mergeCandidates(local, [], '@a:x.net', new Set())
  check('a raw id matching a known user does not duplicate', rawDupe.length === 1)

  check('a non-id query adds nothing', mergeCandidates(local, [], 'alice', new Set()).length === 1)
  check('an excluded raw id is not offered', mergeCandidates([], [], '@a:x.net', new Set(['@a:x.net'])).length === 0)
}

console.log('\n-- describeInviteError --')
{
  // A 403 means insufficient power level. Saying "invite failed" when the
  // server said exactly why makes people retry pointlessly.
  check('403 explains the permission', describeInviteError({ httpStatus: 403 }).includes('permission'))
  check('M_FORBIDDEN explains the permission', describeInviteError({ errcode: 'M_FORBIDDEN' }).includes('permission'))
  check('rate limit named', describeInviteError({ errcode: 'M_LIMIT_EXCEEDED' }).includes('Rate-limited'))
  check('unknown user named', describeInviteError({ errcode: 'M_NOT_FOUND' }).includes('could not be found'))
  check('falls back to the message', describeInviteError({ message: 'boom' }) === 'boom')
  check('never returns empty', describeInviteError(null).length > 0)
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
