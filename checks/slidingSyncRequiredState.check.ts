// The law written at the top of LIST_REQUIRED_STATE, enforced.
//
// "ANYTHING read through room.currentState MUST be listed here. Sliding sync
// delivers only the state types a client asks for -- unlisted state is not
// 'late', it never arrives at all, and currentState returns null forever."
//
// That comment has been correct and unenforced since sliding sync landed, and
// on 2026-09-09 it cost a PLAINTEXT LEAK: m.room.encryption was missing, so
// room.hasEncryptionStateEvent() was false forever, no outbound encryptor was
// ever built, and the SDK sent cleartext into a room whose state said
// m.megolm.v1.aes-sha2 -- while decryption kept working, because inbound keys
// arrive by to-device and never consult room state. Proven by reading the
// room's events back off the server: the creator's messages had readable
// bodies, the other party's were ciphertext.
//
// A comment is not a check. This is the check.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// EventType members this codebase reads through currentState, resolved to the
// wire strings. Deliberately explicit: an UNKNOWN member fails the run rather
// than being skipped, because a check that quietly ignores what it cannot
// resolve is a check that cannot fail.
const EVENT_TYPE_STRINGS: Record<string, string> = {
  RoomEncryption: 'm.room.encryption',
  RoomPinnedEvents: 'm.room.pinned_events',
  RoomTopic: 'm.room.topic',
  RoomName: 'm.room.name',
  RoomAvatar: 'm.room.avatar',
  RoomCanonicalAlias: 'm.room.canonical_alias',
  RoomCreate: 'm.room.create',
  RoomPowerLevels: 'm.room.power_levels',
  RoomMember: 'm.room.member',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const sliding = readFileSync('src/client/slidingSync.ts', 'utf8')
// Start at the `= [` that OPENS the array, not at the declaration: the type
// annotation `string[][]` contains brackets, and slicing to the first ']' after
// the name ended inside it and parsed an empty list -- which would have made
// every assertion below fail for the wrong reason.
const declStart = sliding.indexOf('const LIST_REQUIRED_STATE')
const arrayStart = sliding.indexOf('= [', declStart) + 2
const block = sliding.slice(arrayStart, sliding.indexOf('\n]', arrayStart))
const declared = new Set([...block.matchAll(/\[\s*'([^']+)'/g)].map((m) => m[1]))
console.log('== declared in LIST_REQUIRED_STATE')
console.log('  ' + [...declared].join(', '))

check('the list is non-empty and was actually parsed', declared.size >= 5, { size: declared.size })
// The one that was missing. Named explicitly as well as by the sweep below, so
// the regression has a test with its own name.
check('m.room.encryption is requested -- without it the client sends CLEARTEXT',
  declared.has('m.room.encryption'))

console.log('\n== every state type read through currentState is requested')
const files = walk('src')
const unresolved: string[] = []
const read = new Map<string, string>()
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/getStateEvents\(\s*(?:EventType\.([A-Za-z]+)|'([^']+)')/g)) {
    if (m[2]) read.set(m[2], f)
    else if (m[1] && EVENT_TYPE_STRINGS[m[1]]) read.set(EVENT_TYPE_STRINGS[m[1]], f)
    else unresolved.push(`${m[1]} in ${f}`)
  }
}
check('every EventType member used could be resolved to a wire string',
  unresolved.length === 0,
  unresolved.length ? { unresolved, fix: 'add it to EVENT_TYPE_STRINGS in this check' } : undefined)

for (const [type, where] of [...read].sort()) {
  check(`${type} (read in ${where.replace('src/', '')}) is in required_state`,
    declared.has(type),
    declared.has(type) ? undefined : { fix: "add ['" + type + "', ''] to LIST_REQUIRED_STATE" })
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
