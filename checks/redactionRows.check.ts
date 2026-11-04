// Checks that a redaction is never a row of its own.
//
// The SDK keeps every m.room.redaction in the live timeline (room.js
// tryApplyRedaction: "We continue to add the redaction event to the timeline
// ... so clients can say 'so and so redacted an event'"). Without a filter it
// classified as 'other' and drew as a literal `[m.room.redaction]` row. The
// position-prune job in synapse-deploy (rulings E29/E30) redacts about 90 old
// position events in each of 11 rooms on its first run, so every one of those
// rooms would have filled with them.
const { toItems, rendersAsItem } = await import('../src/client/useTimeline.ts')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const ev = (id: string, type: string, content: any, opts: { redacted?: boolean; redacts?: string } = {}): any => ({
  getId: () => id,
  getSender: () => '@a:x.net',
  getTs: () => 1,
  getType: () => type,
  isRedacted: () => !!opts.redacted,
  isRedaction: () => type === 'm.room.redaction',
  isDecryptionFailure: () => false,
  isBeingDecrypted: () => false,
  isEncrypted: () => false,
  getContent: () => (opts.redacted ? {} : content),
  getOriginalContent: () => content,
  event: { type, redacts: opts.redacts },
})

console.log('\n-- a redaction is not a row --')
{
  const redaction = ev('$r', 'm.room.redaction', { reason: 'position-prune' }, { redacts: '$p' })
  check('rendersAsItem refuses m.room.redaction', !rendersAsItem(redaction))
  check('even with system events shown', !rendersAsItem(redaction, { showSystemEvents: true }))

  const items = toItems([
    ev('$1', 'm.room.message', { msgtype: 'm.text', body: 'hello' }),
    ev('$p', 'net.41chan.spatial.position', {}, { redacted: true }),
    redaction,
    ev('$2', 'm.room.message', { msgtype: 'm.text', body: 'world' }),
  ])
  check('a pruned position leaves no row at all', items.map((i) => i.id).join(',') === '$1,$2', items.map((i) => i.id))
}

console.log('\n-- what a redaction removes still shows as deleted --')
{
  // The filter is on the redaction EVENT, not on what it redacted: a deleted
  // message keeps its "(message deleted)" row.
  const items = toItems([
    ev('$m', 'm.room.message', { msgtype: 'm.text', body: 'gone' }, { redacted: true }),
    ev('$r', 'm.room.redaction', {}, { redacts: '$m' }),
  ])
  check('the deleted message is one row', items.length === 1 && items[0].id === '$m', items.map((i) => i.id))
  check('and it is the redacted kind', items[0]?.kind === 'redacted', items[0]?.kind)
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
