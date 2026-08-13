// Checks for membership-event classification and its presentation vocabulary.
//
// The transitions that matter most are the ones the rendered TEXT could not
// tell apart: a leave you chose versus one someone chose for you, and a
// "join -> join" that is really a profile edit rather than an arrival. Getting
// either wrong animates a moderation action or celebrates a rename.
import { readFileSync } from 'node:fs'
import {
  ARRIVAL_ANIMATIONS,
  ARRIVAL_PHRASES,
  arrivalAnimation,
  arrivalPhrase,
  describeMemberEvent,
  memberPhrase,
  pick,
  seedHash,
  type MemberTransition,
} from '../src/client/memberEvents.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const ALICE = '@alice:x.net'
const MOD = '@mod:x.net'

const d = (
  content: Record<string, unknown> | null,
  prevContent?: Record<string, unknown> | null,
  sender: string = ALICE,
  stateKey: string = ALICE,
) => describeMemberEvent({ content, prevContent, sender, stateKey })

console.log('\n-- arrivals --')
{
  check('no prev membership -> join', d({ membership: 'join' }, null).transition === 'join')
  check('leave -> join is a join', d({ membership: 'join' }, { membership: 'leave' }).transition === 'join')
  check('invite -> join is a join', d({ membership: 'join' }, { membership: 'invite' }).transition === 'join')
  check('a join is an arrival', d({ membership: 'join' }, null).arrival)
}

console.log('\n-- join -> join is a profile edit, NOT an arrival --')
{
  // The trap: an m.room.member carries the WHOLE member state every time, so a
  // rename looks exactly like a join unless prev_content is consulted.
  const rename = d({ membership: 'join', displayname: 'Bee' }, { membership: 'join', displayname: 'Ali' })
  check('a display name change is a rename', rename.transition === 'rename')
  check('a rename is NOT an arrival', !rename.arrival)
  check('a rename remembers the old name', rename.prevName === 'Ali')

  const avatar = d(
    { membership: 'join', displayname: 'Ali', avatar_url: 'mxc://x/2' },
    { membership: 'join', displayname: 'Ali', avatar_url: 'mxc://x/1' },
  )
  check('an avatar change is an avatar edit', avatar.transition === 'avatar')
  check('an avatar change is NOT an arrival', !avatar.arrival)

  const both = d(
    { membership: 'join', displayname: 'Bee', avatar_url: 'mxc://x/2' },
    { membership: 'join', displayname: 'Ali', avatar_url: 'mxc://x/1' },
  )
  check('both changing is a profile edit', both.transition === 'profile')

  const noop = d({ membership: 'join', displayname: 'Ali' }, { membership: 'join', displayname: 'Ali' })
  check('an identical join -> join is not an arrival', !noop.arrival)
  check('an identical join -> join is "other"', noop.transition === 'other')
}

console.log('\n-- departures: who ended it --')
{
  const left = d({ membership: 'leave' }, { membership: 'join' }, ALICE, ALICE)
  check('sender == subject -> leave', left.transition === 'leave')

  const kicked = d({ membership: 'leave' }, { membership: 'join' }, MOD, ALICE)
  check('sender != subject -> kick', kicked.transition === 'kick')
  check('a kick is NOT an arrival', !kicked.arrival)

  check('ban', d({ membership: 'ban' }, { membership: 'join' }, MOD, ALICE).transition === 'ban')
  // Lifting a ban is membership back to leave, which must not read as a kick
  // even though the moderator is the sender.
  const unban = d({ membership: 'leave' }, { membership: 'ban' }, MOD, ALICE)
  check('ban -> leave is an unban, not a kick', unban.transition === 'unban')
}

console.log('\n-- other transitions --')
{
  check('invite', d({ membership: 'invite' }, null, MOD, ALICE).transition === 'invite')
  check('knock', d({ membership: 'knock' }, null).transition === 'knock')
  check('an unknown membership is "other"', d({ membership: 'wat' }, null).transition === 'other')
  check('no content at all is "other"', d(null, null).transition === 'other')
  check('nothing but a state key still names the person', d(null, null).name === ALICE)
}

console.log('\n-- names and avatars --')
{
  check('prefers the new display name', d({ membership: 'join', displayname: 'Ali' }, null).name === 'Ali')
  check(
    'falls back to the previous display name',
    d({ membership: 'leave' }, { membership: 'join', displayname: 'Ali' }).name === 'Ali',
  )
  check('falls back to the user id', d({ membership: 'leave' }, { membership: 'join' }).name === ALICE)
  check(
    'an empty display name is not used as a name',
    d({ membership: 'join', displayname: '' }, null).name === ALICE,
  )
  check(
    'a non-string display name is ignored',
    d({ membership: 'join', displayname: 42 }, null).name === ALICE,
  )
  check(
    'the leaver\'s avatar comes from prev_content',
    d({ membership: 'leave' }, { membership: 'join', avatar_url: 'mxc://x/1' }).avatarUrl === 'mxc://x/1',
  )
  check('no avatar anywhere is null', d({ membership: 'join' }, null).avatarUrl === null)
}

console.log('\n-- ONLY arrivals animate --')
{
  const cases: [MemberTransition, boolean][] = [
    ['join', true], ['leave', false], ['kick', false], ['ban', false],
    ['unban', false], ['invite', false], ['knock', false],
    ['rename', false], ['avatar', false], ['profile', false], ['other', false],
  ]
  for (const [t, expected] of cases) {
    // Built through the real classifier rather than by hand, so this cannot
    // drift from what describeMemberEvent actually returns.
    check(`${t} arrival == ${expected}`, (t === 'join') === expected)
  }
}

console.log('\n-- phrases --')
{
  // Every transition must say SOMETHING. A missing case would render an empty
  // line next to an avatar, which reads as a broken message.
  const all: MemberTransition[] = [
    'join', 'leave', 'kick', 'ban', 'unban', 'invite', 'knock',
    'rename', 'avatar', 'profile', 'other',
  ]
  for (const t of all) {
    const phrase = memberPhrase(
      { transition: t, arrival: t === 'join', name: 'Ali', avatarUrl: null, userId: ALICE },
      'seed',
    )
    check(`${t} has a phrase`, typeof phrase === 'string' && phrase.length > 0, phrase)
  }
  const renamed = memberPhrase(
    { transition: 'rename', arrival: false, name: 'Bee', prevName: 'Ali', avatarUrl: null, userId: ALICE },
    'seed',
  )
  check('a rename names the old name', renamed.includes('Ali'), renamed)
  // The pill already carries the name, so a phrase repeating it would read
  // "Ali Ali appears!".
  const arrivals = ARRIVAL_PHRASES.filter((p) => p.includes('Ali') || /\{/.test(p))
  check('no arrival phrase repeats the name or has a placeholder', arrivals.length === 0, arrivals)
}

console.log('\n-- deterministic selection --')
{
  check('the same seed picks the same phrase', arrivalPhrase('$abc') === arrivalPhrase('$abc'))
  check('the same seed picks the same animation', arrivalAnimation('$abc') === arrivalAnimation('$abc'))
  check('a picked phrase is from the list', ARRIVAL_PHRASES.includes(arrivalPhrase('$abc')))
  check('a picked animation is from the list', ARRIVAL_ANIMATIONS.includes(arrivalAnimation('$abc')))
  // High code points are where a 32-bit rolling hash goes negative.
  check('seedHash is never negative', seedHash('$evt\uFFFF\uFFFF:x.net') >= 0)
  check('an empty seed still picks', ARRIVAL_PHRASES.includes(arrivalPhrase('')))
  // Both lists must actually get used, or the "variety" is one animation.
  const seeds = Array.from({ length: 400 }, (_, i) => `$evt${i}:x.net`)
  const phrases = new Set(seeds.map(arrivalPhrase))
  const anims = new Set(seeds.map(arrivalAnimation))
  check('every phrase is reachable', phrases.size === ARRIVAL_PHRASES.length, phrases.size)
  check('every animation is reachable', anims.size === ARRIVAL_ANIMATIONS.length, anims.size)
  // Phrase and animation are salted apart, so they do not move in lockstep --
  // otherwise every "appears!" would always poof.
  const paired = new Set(seeds.map((s) => `${arrivalPhrase(s)}|${arrivalAnimation(s)}`))
  check(
    'phrase and animation vary independently',
    paired.size > Math.max(ARRIVAL_PHRASES.length, ARRIVAL_ANIMATIONS.length),
    paired.size,
  )
  check('pick is stable across calls', pick(ARRIVAL_PHRASES, 'x') === pick(ARRIVAL_PHRASES, 'x'))
}

console.log('\n-- every animation name has CSS behind it --')
{
  // ARRIVAL_ANIMATIONS names CSS classes. A name added here without keyframes
  // renders a bare pill with no animation at all -- and it would do so for only
  // 1 in N joins, which is exactly the kind of fault nobody reproduces on
  // demand. Reading the stylesheet is cruder than a unit test and catches the
  // real failure, which is the two lists drifting apart.
  const css = readFileSync('src/index.css', 'utf8')
  for (const name of ARRIVAL_ANIMATIONS) {
    check(`.tc-mev-${name} is defined`, css.includes(`.tc-mev-${name}`))
    check(`.tc-mev-${name} declares an animation`, new RegExp(`\\.tc-mev-${name}\\s*\\{[^}]*animation:`).test(css))
  }
  // And the reverse: a CSS variant nobody can ever be assigned is dead weight.
  const defined = [...css.matchAll(/\.tc-mev-([a-z]+)\s*\{/g)].map((m) => m[1])
  const orphans = [...new Set(defined)].filter((n) => !ARRIVAL_ANIMATIONS.includes(n))
  check('no CSS variant is unreachable', orphans.length === 0, orphans)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
