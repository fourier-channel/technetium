// A read-only room (LIVE_4CHAN_LENS.md ruling 5): members read, only
// moderators and bots post. Technetium does not offer what the server will
// refuse: where this person may not send a message, the composer is replaced
// by one line saying why.
//
// Holds: the message level is events['m.room.message'], else events_default,
// else 0 (the spec's defaults); a person's level is their entry, else
// users_default, else 0, and unlimited for a room-v12 creator; malformed
// numbers fall back rather than reading as "anyone"; the gate lives in the
// exported Composer, so both places that draw one get it.
import { readFileSync } from 'node:fs'
const { messageLevel, mayPostMessage, READ_ONLY_LEVEL, READ_ONLY_LINE } = await import('../src/client/readOnlyRoom.ts')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('\n-- the level a message needs --')
{
  check('no power-levels event: anyone may post', messageLevel(undefined) === 0 && mayPostMessage(undefined, '@a:x'))
  check('events_default is the level', messageLevel({ events_default: 50 }) === 50)
  check('an m.room.message entry wins over events_default',
    messageLevel({ events_default: 50, events: { 'm.room.message': 0 } }) === 0)
  check('a non-integer events_default falls back to 0', messageLevel({ events_default: '50' }) === 0)
  check('the read-only level is moderator', READ_ONLY_LEVEL === 50)
}

console.log('\n-- who may post in a read-only room --')
{
  const ro = { events_default: 50, users: { '@sample:x': 50, '@mod:x': 100, '@low:x': 49 } }
  check('a member at the default 0 may not', !mayPostMessage(ro, '@reader:x'))
  check('a member one below may not', !mayPostMessage(ro, '@low:x'))
  check('the bot at 50 may', mayPostMessage(ro, '@sample:x'))
  check('a moderator above may', mayPostMessage(ro, '@mod:x'))
  check('users_default lifts everyone', mayPostMessage({ ...ro, users_default: 50 }, '@reader:x'))
  check('a room-v12 creator may, though never listed in users',
    mayPostMessage(ro, '@op:x', ['@op:x']) && !mayPostMessage(ro, '@op:x'))
  check('an ordinary room lets everyone post', mayPostMessage({ events_default: 0, users: {} }, '@reader:x'))
}

console.log('\n-- the gate is in the one composer every view draws --')
{
  const src = readFileSync('src/ui/Composer.tsx', 'utf8')
  check('the exported Composer checks mayPostMessage',
    /export function Composer\(props[\s\S]{0,2500}mayPostMessage\(/.test(src))
  check('and shows the read-only line in its place', /READ_ONLY_LINE/.test(src))
  check('it re-reads on state events from the client, not the swappable currentState',
    /client\.on\(RoomStateEvent\.Events/.test(src) && !/currentState\.on\(/.test(src))
  check('the line says who posts', /moderators and bots/.test(READ_ONLY_LINE))
  for (const file of ['src/App.tsx', 'src/ui/ThreadPanel.tsx']) {
    const s = readFileSync(file, 'utf8')
    check(`${file} draws the gated Composer, not the body`, /<Composer\b/.test(s) && !/ComposerBody/.test(s))
  }
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
