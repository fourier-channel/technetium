// Checks for W6.1 day separators and W6.2 same-sender grouping.
//
// The point of these is REGRESSION: grouping is the last feature to land and it
// re-lays-out the Row that every Wave 2 feature decorates, so these assert that
// it collapses the header and nothing else.
import { applyLayout } from '../src/client/useTimeline.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const DAY = 24 * 60 * 60 * 1000
const BASE = new Date('2026-08-07T12:00:00Z').getTime()

const item = (id: string, sender: string, ts: number, extra: any = {}): any => ({
  event: { getTs: () => ts, getSender: () => sender, getId: () => id },
  kind: 'message',
  id,
  content: { msgtype: 'm.text', body: id },
  ...extra,
})

console.log('\n-- day separators --')
{
  const out = applyLayout([item('$1', '@a:x.net', BASE)])
  check('a separator opens the timeline', out[0].kind === 'day')
  check('the message follows it', out[1].id === '$1')
  check('separator carries the timestamp it labels', out[0].dayTs === BASE)

  const twoDays = applyLayout([item('$1', '@a:x.net', BASE), item('$2', '@a:x.net', BASE + DAY)])
  check('a second day inserts a second separator', twoDays.filter((i) => i.kind === 'day').length === 2)

  const sameDay = applyLayout([item('$1', '@a:x.net', BASE), item('$2', '@a:x.net', BASE + 60_000)])
  check('same day inserts only one', sameDay.filter((i) => i.kind === 'day').length === 1)

  check('separator ids are stable and distinct from events', twoDays[0].id.startsWith('day-'))
  check('an empty timeline yields nothing', applyLayout([]).length === 0)
}

console.log('\n-- same-sender grouping --')
{
  const run = applyLayout([
    item('$1', '@a:x.net', BASE),
    item('$2', '@a:x.net', BASE + 1000),
    item('$3', '@a:x.net', BASE + 2000),
  ]).filter((i) => i.kind !== 'day')
  check('first in a run shows its header', run[0].showHeader === true)
  check('second is grouped', run[1].showHeader === false)
  check('third is grouped', run[2].showHeader === false)

  const switched = applyLayout([
    item('$1', '@a:x.net', BASE),
    item('$2', '@b:x.net', BASE + 1000),
  ]).filter((i) => i.kind !== 'day')
  check('a different sender breaks the run', switched[1].showHeader === true)

  // Beyond the window two messages are separate thoughts even from one person.
  const gap = applyLayout([
    item('$1', '@a:x.net', BASE),
    item('$2', '@a:x.net', BASE + 6 * 60 * 1000),
  ]).filter((i) => i.kind !== 'day')
  check('a long gap breaks the run', gap[1].showHeader === true)

  const inWindow = applyLayout([
    item('$1', '@a:x.net', BASE),
    item('$2', '@a:x.net', BASE + 4 * 60 * 1000),
  ]).filter((i) => i.kind !== 'day')
  check('inside the window it still groups', inWindow[1].showHeader === false)

  // A day break always restarts a run, whoever sent it.
  const across = applyLayout([item('$1', '@a:x.net', BASE), item('$2', '@a:x.net', BASE + DAY)])
  const afterSeparator = across[across.findIndex((i) => i.id === '$2')]
  check('a day break restarts the run', afterSeparator.showHeader === true)

  // A reply opens a new thought -- hiding the sender above a reply pill reads
  // as the pill belonging to the message before it.
  const reply = applyLayout([
    item('$1', '@a:x.net', BASE),
    item('$2', '@a:x.net', BASE + 1000, { replyTo: { eventId: '$0', event: null } }),
  ]).filter((i) => i.kind !== 'day')
  check('a reply is never grouped', reply[1].showHeader === true)
}

console.log('\n-- grouping collapses the HEADER and nothing else (regression) --')
{
  const decorated = applyLayout([
    item('$1', '@a:x.net', BASE),
    item('$2', '@a:x.net', BASE + 1000, {
      reactions: [{ key: '👍', count: 2, mine: false, myEventId: null, senders: ['@b:x.net'] }],
      editedTs: BASE + 1500,
    }),
  ]).filter((i) => i.kind !== 'day')

  const grouped = decorated[1]
  check('the grouped row IS grouped', grouped.showHeader === false)
  // Every Wave 2 decoration must survive untouched.
  check('reactions survive grouping', grouped.reactions?.length === 1)
  check('the edited marker survives grouping', grouped.editedTs === BASE + 1500)
  check('content survives grouping', (grouped.content as any).body === '$2')
  check('the event is unchanged', grouped.event.getId() === '$2')
  check('the id is unchanged (jump/receipts key off it)', grouped.id === '$2')
}

console.log('\n-- membership rows break a run, and never anchor one --')
{
  const member = (id: string, sender: string, ts: number) =>
    item(id, sender, ts, { kind: 'member' })

  // The fault this guards: a membership row has no sender pill, so if it could
  // anchor a run, the message after a join from the same person would hide its
  // pill and read as belonging to the join line.
  const out = applyLayout([
    item('$1', '@a:x.net', BASE),
    member('$m', '@a:x.net', BASE + 1000),
    item('$2', '@a:x.net', BASE + 2000),
  ]).filter((i) => i.kind !== 'day')
  check('the membership row survives', out[1].kind === 'member')
  check('a membership row always shows its own header', out[1].showHeader === true)
  check(
    'a same-sender message AFTER it shows its header again',
    out[2].showHeader === true,
    out[2].showHeader,
  )

  // Without the membership row in between, that same pair DOES group -- so the
  // assertion above is about the member row and not about the window.
  const control = applyLayout([
    item('$1', '@a:x.net', BASE),
    item('$2', '@a:x.net', BASE + 2000),
  ]).filter((i) => i.kind !== 'day')
  check('control: the same pair groups without one in between', control[1].showHeader === false)

  // A membership row opening a day must not swallow the separator.
  const dayOpen = applyLayout([member('$m', '@a:x.net', BASE)])
  check('a membership row still gets its day separator', dayOpen[0].kind === 'day')
  check('and renders after it', dayOpen[1].kind === 'member')

  // Two in a row: neither may group into the other.
  const pair = applyLayout([
    member('$m1', '@a:x.net', BASE),
    member('$m2', '@a:x.net', BASE + 500),
  ]).filter((i) => i.kind !== 'day')
  check('consecutive membership rows both show headers',
    pair[0].showHeader === true && pair[1].showHeader === true)
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
