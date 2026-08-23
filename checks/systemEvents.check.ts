// Checks for the system-noise predicate.
//
// The risk here runs one way. Failing to hide a config event costs a junk row;
// hiding a MESSAGE loses somebody's words with no error and no trace, and the
// only symptom is a gap nobody can see. So most of these assert what must stay
// visible rather than what must go.
import { isSystemEvent } from '../src/client/systemEvents.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('\n-- what must never be hidden --')
{
  // The entire point of the client. If any of these ever match, messages start
  // silently disappearing from rooms.
  const NEVER = [
    'm.room.message',
    'm.room.member',
    'm.room.encrypted',
    'm.room.redaction',
    'm.reaction',
    'm.sticker',
    'm.room.name',
    'm.room.topic',
    'm.room.avatar',
    'm.poll.start',
    'org.matrix.msc3381.poll.start',
  ]
  for (const t of NEVER) check(`${t} stays visible`, !isSystemEvent(t))

  // Unrecognised types stay visible too. Hiding by default whatever we failed
  // to classify is how a real event vanishes and nobody notices for a month.
  check('an unknown type stays visible', !isSystemEvent('com.example.something'))
  check('an empty type stays visible', !isSystemEvent(''))
}

console.log('\n-- what is hidden --')
{
  check('m.room.server_acl is noise', isSystemEvent('m.room.server_acl'))
  check('m.room.power_levels is noise', isSystemEvent('m.room.power_levels'))
  check('m.room.join_rules is noise', isSystemEvent('m.room.join_rules'))
  check('m.room.history_visibility is noise', isSystemEvent('m.room.history_visibility'))
  check('m.room.create is noise', isSystemEvent('m.room.create'))

  // Ours are covered by prefix, so a type nobody has written yet is handled --
  // which is the case a list cannot cover and the reason this is a rule.
  check('net.41chan.domain.action is noise', isSystemEvent('net.41chan.domain.action'))
  check('net.41chan.interaction is noise', isSystemEvent('net.41chan.interaction'))
  check('a 41chan type invented tomorrow is noise',
    isSystemEvent('net.41chan.something.not.written.yet'))

  // ...but the prefix must be anchored, or a hostile or careless type ending in
  // our namespace would inherit the hiding.
  check('the prefix is anchored, not a substring',
    !isSystemEvent('com.evil.net.41chan.message'))
}

console.log('\n-- the one config event that is NOT noise (O-e1) --')
{
  // m.room.encryption was removed from the hidden list deliberately: it is the
  // moment a conversation's privacy changed, and it cannot be undone. Hiding it
  // makes that change invisible, which is the same class of failure as hiding
  // an error. Asserted so it cannot drift back in with the furniture.
  check('m.room.encryption is visible', isSystemEvent('m.room.encryption') === false)
  // Its neighbours in the config block stay hidden -- this is one carve-out,
  // not the list falling over.
  check('m.room.join_rules is still hidden', isSystemEvent('m.room.join_rules') === true)
  check('m.room.power_levels is still hidden', isSystemEvent('m.room.power_levels') === true)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
