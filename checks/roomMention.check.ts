// @room (launch-polish L28).
//
// Operator, 2026-10-08: "I don't seem to be able to do @room or anything from
// Technetium." Measured against Synapse 1.152.1 first (client/roomMention.ts
// has the table): a message carrying m.mentions without `room` notifies
// nobody of its @room, and this client sent m.mentions with every picked name
// and every reply. Holds the rules, and the composer's use of them.
import { readFileSync } from 'node:fs'
import {
  containsRoomMention,
  mentionsBlock,
  mentionsMe,
  offersRoomMention,
  roomMentionPermission,
  roomMentionRefusal,
} from '../src/client/roomMention.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const ME = '@me:x.net'
const MOD = '@mod:x.net'
const yes = () => true
const no = () => false

console.log('\n-- the picker --')
{
  check('a bare "@" offers it (last, so Enter cannot pick it by accident)', offersRoomMention(''))
  check('"@ro" offers it', offersRoomMention('ro'))
  check('"@Room" offers it', offersRoomMention('Room'))
  check('"@every" and "@here" -- the Discord words -- offer it too',
    offersRoomMention('every') && offersRoomMention('here'))
  check('"@rob" does not', !offersRoomMention('rob'))
  check('"@roomy" does not', !offersRoomMention('roomy'))
}

console.log('\n-- "@room" as a word --')
{
  for (const t of ['@room', '@room hello', 'hey @room', 'hey @room.', '(@room)', '@room, look', 'line\n@room'])
    check(`found in ${JSON.stringify(t)}`, containsRoomMention(t))
  for (const t of ['@roommate', 'mail me@room.net', 'https://x.net/@room', '@room:x.net', 'room', '#room', 'a@room'])
    check(`not in ${JSON.stringify(t)}`, !containsRoomMention(t))
}

console.log('\n-- who may --')
{
  const pl = { users: { [MOD]: 50, [ME]: 0 }, notifications: { room: 50 } }
  check('a moderator at the room level may', roomMentionPermission(pl, MOD).allowed)
  check('a member at 0 may not', !roomMentionPermission(pl, ME).allowed)
  const def = roomMentionPermission({ users: { [MOD]: 50 } }, MOD)
  check('no notifications entry: the spec default of 50', def.need === 50 && def.allowed, def)
  check('a room that lowered it to 0 lets everyone',
    roomMentionPermission({ notifications: { room: 0 } }, ME).allowed)
  check('a room-version-12 creator always may',
    roomMentionPermission({ notifications: { room: 100 } }, ME, [ME]).allowed)
  const why = roomMentionRefusal(roomMentionPermission(pl, ME))
  check('a refusal says what is needed and what you have', /50/.test(why) && /0/.test(why), why)
}

console.log('\n-- what is sent --')
{
  check('nothing to say: no m.mentions at all (the shape plain messages always had)',
    Object.keys(mentionsBlock([], false)).length === 0)
  const both = mentionsBlock(['@a:x.net', '@a:x.net'], true)['m.mentions']
  check('a person AND @room: both, the person once',
    both?.room === true && both.user_ids?.join(',') === '@a:x.net', both)
  const roomOnly = mentionsBlock([], true)['m.mentions']
  check('@room alone: room only', roomOnly?.room === true && roomOnly.user_ids === undefined, roomOnly)
}

console.log('\n-- does it call on me --')
{
  check('my id in m.mentions', mentionsMe({ body: 'hi', 'm.mentions': { user_ids: [ME] } }, ME, no))
  check('m.mentions.room from someone allowed', mentionsMe({ body: '@room', 'm.mentions': { room: true } }, ME, yes))
  check('m.mentions.room from someone NOT allowed: the server did not ping, neither do we',
    !mentionsMe({ body: '@room', 'm.mentions': { room: true } }, ME, no))
  check('m.mentions present without me or room: the body is not consulted (MSC3952)',
    !mentionsMe({ body: '@room and @a', 'm.mentions': { user_ids: ['@a:x.net'] } }, ME, yes))
  check('no m.mentions: "@room" in the body from someone allowed (the old fallback)',
    mentionsMe({ body: '@room hello' }, ME, yes))
  check('no m.mentions: a link to me in the formatted body',
    mentionsMe({ body: 'me', formatted_body: `<a href="https://matrix.to/#/${ME}">me</a>` }, ME, no))
  check('an ordinary message does not', !mentionsMe({ body: 'just talking' }, ME, yes))
  let asked = false
  mentionsMe({ body: 'just talking' }, ME, () => { asked = true; return true })
  check('permission is only asked when the answer depends on it', !asked)
}

console.log('\n-- the composer uses all of it --')
{
  const c = readFileSync('src/ui/Composer.tsx', 'utf8')
  check('a text send builds m.mentions from the rule, @room included',
    /containsRoomMention\(plain\) && roomPermission\(\)\.allowed/.test(c) && /mentionsBlock\(mentionIds, everyone\)/.test(c))
  check('never on an edit', /mode\.kind !== 'edit' && containsRoomMention\(plain\)/.test(c))
  check('the explicit-content path is taken whenever m.mentions exists',
    /else if \(mentions\['m\.mentions'\]\)/.test(c))
  check('no hand-built m.mentions left beside the rule', !/'m\.mentions': \{ user_ids/.test(c))
  check('a caption is formatted with the picked names', /formatMessage\(input, \{ mentions: pickedMentions \}\)/.test(c))
  check('and carries m.mentions, @room included',
    /containsRoomMention\(caption\.plain\) && roomPermission\(\)\.allowed/.test(c) && /cap \? captionMentions : \{\}/.test(c))
  check('the picker offers @room after the members, and only when allowed',
    /\[\.\.\.members, \{ kind: 'room' \}/.test(c) && /roomRefusal: roomMentionRefusal\(perm\)/.test(c))
  const t = readFileSync('src/ui/Timeline.tsx', 'utf8')
  check('a row that calls on me is marked', /data-mentions-me=\{callsOnMe \? 'true' : undefined\}/.test(t))
  const css = readFileSync('src/index.css', 'utf8')
  check('and the mark is drawn', /\.tc-row\[data-mentions-me='true'\]\s*\{/.test(css))
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
