// Checks for W5.3 poll tallying and W5.2 link extraction.
import { parsePollStart, tallyPoll } from '../src/client/polls.ts'
import { firstLink, isPreviewable } from '../src/client/urlPreview.ts'
import { searchLoaded } from '../src/client/search.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const START = 'org.matrix.msc3381.poll.start'
const RESP = 'org.matrix.msc3381.poll.response'
const END = 'org.matrix.msc3381.poll.end'

const ev = (type: string, sender: string, ts: number, content: any, redacted = false): any => ({
  getType: () => type,
  getSender: () => sender,
  getTs: () => ts,
  isRedacted: () => redacted,
  getOriginalContent: () => content,
  getContent: () => content,
})

const startEv = (sender: string, opts: any = {}) =>
  ev(START, sender, 100, {
    [START]: {
      question: { 'org.matrix.msc1767.text': opts.question ?? 'Best colour?' },
      kind: opts.kind ?? 'org.matrix.msc3381.poll.disclosed',
      max_selections: opts.max ?? 1,
      answers: opts.answers ?? [
        { id: 'a', 'org.matrix.msc1767.text': 'Red' },
        { id: 'b', 'org.matrix.msc1767.text': 'Blue' },
      ],
    },
  })

const respEv = (sender: string, ts: number, ids: string[], redacted = false) =>
  ev(RESP, sender, ts, { [RESP]: { answers: ids } }, redacted)

console.log('\n-- parsePollStart --')
{
  const d = parsePollStart(startEv('@a:x.net'))!
  check('question parsed', d.question === 'Best colour?')
  check('answers parsed', d.answers.map((a) => a.id).join(',') === 'a,b')
  check('answer text parsed', d.answers[0].text === 'Red')
  check('disclosed by default', d.undisclosed === false)
  check('undisclosed detected', parsePollStart(startEv('@a:x.net', { kind: 'org.matrix.msc3381.poll.undisclosed' }))!.undisclosed)
  check('a poll with no answers is not a poll', parsePollStart(startEv('@a:x.net', { answers: [] })) === null)
  check('answers without ids are dropped', parsePollStart(startEv('@a:x.net', { answers: [{ 'org.matrix.msc1767.text': 'x' }] })) === null)
}

console.log('\n-- tallyPoll --')
{
  const s = startEv('@owner:x.net')

  const one = tallyPoll(s, [respEv('@a:x.net', 200, ['a'])], null)!
  check('single vote counted', one.tallies.find((t) => t.answerId === 'a')!.count === 1)
  check('total voters', one.totalVoters === 1)
  check('not ended', one.ended === false)

  // One voter, two votes -> only the LAST counts.
  const revote = tallyPoll(s, [respEv('@a:x.net', 200, ['a']), respEv('@a:x.net', 300, ['b'])], null)!
  check('a re-vote replaces the earlier one', revote.tallies.find((t) => t.answerId === 'a')!.count === 0)
  check('the later vote counts', revote.tallies.find((t) => t.answerId === 'b')!.count === 1)
  check('a re-voter is still one voter', revote.totalVoters === 1)

  check(
    'a redacted response does not count',
    tallyPoll(s, [respEv('@a:x.net', 200, ['a'], true)], null)!.totalVoters === 0,
  )
  check(
    'a vote for an unknown answer is discarded',
    tallyPoll(s, [respEv('@a:x.net', 200, ['zzz'])], null)!.totalVoters === 1 &&
      tallyPoll(s, [respEv('@a:x.net', 200, ['zzz'])], null)!.tallies.every((t) => t.count === 0),
  )

  // max_selections is enforced by the READER, not trusted from the sender.
  const multi = startEv('@owner:x.net', { max: 1 })
  check(
    'votes beyond max_selections are trimmed',
    tallyPoll(multi, [respEv('@a:x.net', 200, ['a', 'b'])], null)!.tallies.filter((t) => t.count > 0).length === 1,
  )

  // Ending: only the poll's CREATOR may close it.
  const endedByOwner = tallyPoll(s, [respEv('@a:x.net', 200, ['a']), ev(END, '@owner:x.net', 250, {})], null)!
  check('creator can end the poll', endedByOwner.ended === true)
  const endedByOther = tallyPoll(s, [ev(END, '@rando:x.net', 250, {})], null)!
  check('a non-creator CANNOT end the poll', endedByOther.ended === false)

  // A vote arriving after the close does not count.
  const late = tallyPoll(s, [ev(END, '@owner:x.net', 250, {}), respEv('@a:x.net', 300, ['a'])], null)!
  check('votes after the close are discarded', late.totalVoters === 0)
  const inTime = tallyPoll(s, [ev(END, '@owner:x.net', 250, {}), respEv('@a:x.net', 200, ['a'])], null)!
  check('votes before the close still count', inTime.totalVoters === 1)

  // Undisclosed hides tallies until it ends.
  const undis = startEv('@owner:x.net', { kind: 'org.matrix.msc3381.poll.undisclosed' })
  check('undisclosed poll hides while open', tallyPoll(undis, [respEv('@a:x.net', 200, ['a'])], null)!.hidden)
  check(
    'undisclosed poll reveals once ended',
    tallyPoll(undis, [respEv('@a:x.net', 200, ['a']), ev(END, '@owner:x.net', 250, {})], null)!.hidden === false,
  )

  check('own vote reported', tallyPoll(s, [respEv('@me:x.net', 200, ['b'])], '@me:x.net')!.myAnswerIds.join(',') === 'b')
  check('no own vote when not voted', tallyPoll(s, [respEv('@a:x.net', 200, ['b'])], '@me:x.net')!.myAnswerIds.length === 0)
}

console.log('\n-- link extraction (W5.2) --')
{
  check('https link found', firstLink('see https://example.test/x') === 'https://example.test/x')
  check('first link only', firstLink('https://a.test and https://b.test') === 'https://a.test')
  check('no link', firstLink('nothing here') === null)
  // Trailing punctuation is almost never part of the URL someone typed.
  check('trailing period trimmed', firstLink('go to https://example.test.') === 'https://example.test')
  check('trailing paren trimmed', firstLink('(https://example.test)') === 'https://example.test')
  // A preview makes the SERVER fetch a URL: anything but http(s) is refused.
  check('javascript: refused', !isPreviewable('javascript:alert(1)'))
  check('file: refused', !isPreviewable('file:///etc/passwd'))
  check('data: refused', !isPreviewable('data:text/html,x'))
  check('https allowed', isPreviewable('https://example.test'))
  check('garbage refused', !isPreviewable('not a url'))
}

console.log('\n-- local search fallback (W5.1) --')
{
  const mkEv = (id: string, body: string, ts: number): any => ({
    getId: () => id,
    getRoomId: () => '!r:x.net',
    getSender: () => '@a:x.net',
    getTs: () => ts,
    getType: () => 'm.room.message',
    isRedacted: () => false,
    getContent: () => ({ msgtype: 'm.text', body }),
  })
  const room: any = {
    roomId: '!r:x.net',
    getMyMembership: () => 'join',
    getLiveTimeline: () => ({
      getEvents: () => [mkEv('$1', 'hello world', 1), mkEv('$2', 'goodbye', 2), mkEv('$3', 'HELLO again', 3)],
    }),
  }
  const client: any = { getRoom: () => room, getRooms: () => [room] }

  const hits = searchLoaded(client, 'hello', 'room', '!r:x.net')
  check('matches found', hits.length === 2)
  check('case-insensitive', hits.some((h) => h.body === 'HELLO again'))
  check('newest first', hits[0].eventId === '$3')
  check('no match', searchLoaded(client, 'zzz', 'room', '!r:x.net').length === 0)
  check('empty term matches nothing', searchLoaded(client, '   ', 'room', '!r:x.net').length === 0)
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
