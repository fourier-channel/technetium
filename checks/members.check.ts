// Checks for W4.1 standing sort and W4.4 ignore-list handling. See
// checks/relations.check.ts for how these run (`npm run check`).
import { compareByStanding, honorificRank } from '../src/client/members.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log('  ok   ' + name)
  } else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

const m = (displayName: string, pl?: number): any => ({
  id: '@' + displayName.toLowerCase() + ':x.net',
  displayName,
  sources: ['matrix'],
  powerByRoom: pl === undefined ? {} : { '!r:x.net': pl },
})

console.log('\n-- honorificRank --')
{
  check('owner is first', honorificRank(100) === 0)
  check('moderator second', honorificRank(50) === 1)
  check('voice third', honorificRank(25) === 2)
  check('plain member last', honorificRank(0) === 3)
  // Tier, not raw PL: 50 and 99 are both "@" and must rank identically, or the
  // list order would disagree with the glyphs it is showing.
  check('50 and 99 share the moderator tier', honorificRank(50) === honorificRank(99))
  check('100 and 150 share the owner tier', honorificRank(100) === honorificRank(150))
}

console.log('\n-- compareByStanding --')
{
  const sorted = [m('zoe', 100), m('adam'), m('bob', 50), m('yara', 25), m('alice', 50)]
    .sort(compareByStanding)
    .map((x) => x.displayName)
  check('tiers group in order', sorted.join(',') === 'zoe,alice,bob,yara,adam', sorted)

  // Within a tier it is alphabetical, NOT by power level.
  const within = [m('bob', 99), m('alice', 50)].sort(compareByStanding).map((x) => x.displayName)
  check('within a tier, alpha beats power level', within.join(',') === 'alice,bob', within)

  check('case-insensitive', [m('Zed'), m('adam')].sort(compareByStanding)[0].displayName === 'adam')

  // maxPower is the highest standing ANYWHERE, so a member with power in one
  // room outranks a plain member even when the viewed room is a different one.
  const multi: any = { ...m('carol'), powerByRoom: { '!a:x.net': 0, '!b:x.net': 100 } }
  check('maxPower drives the tier', compareByStanding(multi, m('adam')) < 0)

  check('no power at all sorts last', compareByStanding(m('adam'), m('bob', 25)) > 0)
}

console.log('\n-- ignore filtering at toItems (W4.4) --')
{
  // toItems is imported lazily: useTimeline pulls in React, which is fine in
  // node, but keeping the import here documents the dependency.
  const { toItems } = await import('../src/client/useTimeline.ts')

  const ev = (id: string, sender: string, body: string): any => ({
    getId: () => id,
    getSender: () => sender,
    getTs: () => 1,
    getType: () => 'm.room.message',
    isRedacted: () => false,
    isEncrypted: () => false,
    getContent: () => ({ msgtype: 'm.text', body }),
    getOriginalContent: () => ({ msgtype: 'm.text', body }),
    get isThreadRoot() {
      return false
    },
  })

  const events = [ev('$1', '@ok:x.net', 'fine'), ev('$2', '@bad:x.net', 'spam')]

  const unfiltered = toItems(events, {})
  check('both render with no ignore list', unfiltered.length === 2)

  const filtered = toItems(events, { ignoredUsers: ['@bad:x.net'] })
  check('an ignored sender is dropped entirely', filtered.length === 1)
  check('the right one survives', filtered[0].event.getSender() === '@ok:x.net')

  check('an empty ignore list changes nothing', toItems(events, { ignoredUsers: [] }).length === 2)
  check(
    'ignoring someone absent changes nothing',
    toItems(events, { ignoredUsers: ['@nobody:x.net'] }).length === 2,
  )
  check(
    'ignoring everyone yields an empty timeline',
    toItems(events, { ignoredUsers: ['@ok:x.net', '@bad:x.net'] }).length === 0,
  )
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
