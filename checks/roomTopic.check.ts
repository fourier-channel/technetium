// A room's topic carries its quick rules (operator, 2026-10-10): its line
// breaks are content, the header flattens it, and a failed save says what to do.
//
// WHAT THIS CANNOT SEE: who may edit (the SDK's maySendStateEvent decides), or
// the header drawing it. tools/visual/out drives the real RoomHeaderInfo.
import { describeTopicError, topicEdit, topicLine, topicText } from '../src/client/roomTopic.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const rules = 'Rules:\r\n1. Be kind   \r\n2. No spam\n\n\n\n3. Tag your posts\n'
check('line breaks are kept, CRLF folded, trailing spaces and runs of blank lines trimmed',
  topicText({ topic: rules }) === 'Rules:\n1. Be kind\n2. No spam\n\n3. Tag your posts', JSON.stringify(topicText({ topic: rules })))
check('the header line is one line', topicLine(topicText({ topic: rules })) === 'Rules: 1. Be kind 2. No spam 3. Tag your posts')
check('no topic, a non-string, or no content reads as empty',
  topicText({}) === '' && topicText({ topic: 7 }) === '' && topicText(undefined) === '' && topicText(null) === '')

check('an unchanged draft is not a change', !topicEdit('Rules:\n1. Be kind  ', 'Rules:\n1. Be kind').changed)
check('a changed draft is, and is written normalised',
  topicEdit('  New rule  \n', 'Old').next === 'New rule' && topicEdit('New', 'Old').changed)
check('clearing a topic is a change to empty', topicEdit('   ', 'Old').next === '' && topicEdit('   ', 'Old').changed)

check('a 403 names the cause and who to ask', /may not change this topic.*ask a moderator/.test(describeTopicError({ httpStatus: 403 })))
check('a rate limit says to wait and that the text is kept', /wait a moment/.test(describeTopicError({ errcode: 'M_LIMIT_EXCEEDED' })) && /still here/.test(describeTopicError({ httpStatus: 429 })))
check('anything else carries its message and the remedy', /\(boom\).*Save again/.test(describeTopicError(new Error('boom'))))
check('even with no error object at all', /no reason given/.test(describeTopicError(null)))

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
