// Pure-helper checks for the S1 relations read layer.
//
// Run with `npm run check`. No test runner and no new dependency: Node strips
// TS types natively, and the project already compiles under
// `erasableSyntaxOnly`, so every source file here is directly runnable. A
// module under check must import matrix-js-sdk TYPES only -- a value import
// would pull the whole sdk into a bare node process.
//
// checks/ is excluded from eslint (it is not shipped code) and from
// tsconfig.app.json's `include` (which is src-only).
import {
  buildRelationIndex,
  effectiveContent,
  isRelationOnlyEvent,
  readRelatesTo,
  resolveReply,
} from '../src/client/relations.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log('  ok   ' + name)
  } else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

type Fake = {
  id: string
  sender: string
  ts: number
  type: string
  content: Record<string, unknown>
  redacted?: boolean
}

function ev(f: Fake): any {
  return {
    getId: () => f.id,
    getSender: () => f.sender,
    getTs: () => f.ts,
    getType: () => f.type,
    isRedacted: () => !!f.redacted,
    getOriginalContent: () => f.content,
  }
}

const msg = (id: string, sender: string, ts: number, body: string, extra = {}) =>
  ev({ id, sender, ts, type: 'm.room.message', content: { msgtype: 'm.text', body, ...extra } })

const edit = (id: string, sender: string, ts: number, target: string, body: string) =>
  ev({
    id,
    sender,
    ts,
    type: 'm.room.message',
    content: {
      msgtype: 'm.text',
      body: '* ' + body,
      'm.new_content': { msgtype: 'm.text', body },
      'm.relates_to': { rel_type: 'm.replace', event_id: target },
    },
  })

const react = (id: string, sender: string, ts: number, target: string, key: string, redacted = false) =>
  ev({
    id,
    sender,
    ts,
    type: 'm.reaction',
    redacted,
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: target, key } },
  })

const ME = '@me:x.net'
const OTHER = '@other:x.net'

console.log('\n-- readRelatesTo --')
{
  const plain = msg('$1', ME, 1, 'hi')
  check('plain message has no relation', readRelatesTo(plain).relType === null)
  const r = readRelatesTo(react('$r', ME, 2, '$1', 'thumbsup'))
  check('annotation relType', r.relType === 'm.annotation')
  check('annotation key', r.key === 'thumbsup')
  check('annotation target', r.targetId === '$1')
  // Hostile input must not throw.
  const junk = ev({ id: '$j', sender: ME, ts: 1, type: 'm.room.message', content: { 'm.relates_to': 'not-an-object' } })
  check('string m.relates_to does not throw', readRelatesTo(junk).relType === null)
  const junk2 = ev({ id: '$j2', sender: ME, ts: 1, type: 'm.room.message', content: { 'm.relates_to': { rel_type: 42, event_id: [] } } })
  check('wrong-typed fields ignored', readRelatesTo(junk2).relType === null && readRelatesTo(junk2).targetId === null)
}

console.log('\n-- isRelationOnlyEvent (timeline junk filter) --')
{
  check('plain message is a row', !isRelationOnlyEvent(msg('$1', ME, 1, 'hi')))
  check('reaction is NOT a row', isRelationOnlyEvent(react('$r', ME, 2, '$1', 'a')))
  check('edit is NOT a row', isRelationOnlyEvent(edit('$e', ME, 3, '$1', 'fixed')))
  const threadReply = msg('$t', ME, 4, 'in thread', {
    'm.relates_to': { rel_type: 'm.thread', event_id: '$1' },
  })
  check('thread reply IS a row', !isRelationOnlyEvent(threadReply))
}

console.log('\n-- edits --')
{
  const base = msg('$1', ME, 100, 'orignal typo')
  const e1 = edit('$e1', ME, 200, '$1', 'original typo')
  const e2 = edit('$e2', ME, 300, '$1', 'original, fixed')
  const idx = buildRelationIndex([base, e1, e2], ME)
  check('latest edit wins', idx.edits.get('$1')?.event.getId() === '$e2')
  check('effective content is the latest edit', (effectiveContent(base, idx.edits.get('$1')) as any).body === 'original, fixed')
  check('unedited content passes through', (effectiveContent(msg('$9', ME, 1, 'plain')) as any).body === 'plain')

  // Tie on ts -> higher event id wins, so every client agrees.
  const tieA = edit('$aaa', ME, 500, '$1', 'A')
  const tieB = edit('$bbb', ME, 500, '$1', 'B')
  const tie = buildRelationIndex([base, tieA, tieB], ME)
  check('ts tie breaks on event id', tie.edits.get('$1')?.event.getId() === '$bbb')

  // SECURITY: an edit from another user must be ignored.
  const forged = edit('$evil', OTHER, 9999, '$1', 'I never wrote this')
  const sec = buildRelationIndex([base, forged], ME)
  check('forged edit from another sender is REJECTED', sec.edits.get('$1') === undefined)
  check('forged edit does not alter content', (effectiveContent(base, sec.edits.get('$1')) as any).body === 'orignal typo')

  // A redacted edit reverts to the original.
  const redactedEdit = ev({
    id: '$er', sender: ME, ts: 400, type: 'm.room.message', redacted: true,
    content: { 'm.relates_to': { rel_type: 'm.replace', event_id: '$1' } },
  })
  const red = buildRelationIndex([base, redactedEdit], ME)
  check('redacted edit ignored', red.edits.get('$1') === undefined)

  // An edit must not retarget a reply.
  const replyBase = msg('$2', ME, 100, 'answer', {
    'm.relates_to': { 'm.in_reply_to': { event_id: '$0' } },
  })
  const replyEdit = edit('$e3', ME, 200, '$2', 'better answer')
  const ri = buildRelationIndex([replyBase, replyEdit], ME)
  const merged: any = effectiveContent(replyBase, ri.edits.get('$2'))
  check('edit preserves original m.relates_to', merged['m.relates_to']?.['m.in_reply_to']?.event_id === '$0')
  check('edit applies new body', merged.body === 'better answer')
}

console.log('\n-- reactions --')
{
  const base = msg('$1', ME, 100, 'hi')
  const idx = buildRelationIndex(
    [
      base,
      react('$r1', OTHER, 110, '$1', 'thumbsup'),
      react('$r2', ME, 120, '$1', 'thumbsup'),
      react('$r3', OTHER, 130, '$1', 'heart'),
      // same user + same key twice: counts once
      react('$r4', OTHER, 140, '$1', 'heart'),
      // redacted reaction: does not count
      react('$r5', OTHER, 150, '$1', 'fire', true),
    ],
    ME,
  )
  const tallies = idx.reactions.get('$1')!
  check('two distinct keys tallied', tallies.length === 2, tallies)
  check('first-seen key order preserved', tallies[0].key === 'thumbsup' && tallies[1].key === 'heart')
  check('thumbsup counted twice', tallies[0].count === 2)
  check('own reaction flagged', tallies[0].mine === true)
  check('own annotation id captured (needed to un-react)', tallies[0].myEventId === '$r2')
  check('duplicate same-sender same-key counted once', tallies[1].count === 1)
  check('not-mine stays false', tallies[1].mine === false)
  check('redacted reaction excluded', !tallies.some((t) => t.key === 'fire'))
  check('senders recorded', tallies[0].senders.join(',') === OTHER + ',' + ME)

  const anon = buildRelationIndex([base, react('$r1', ME, 110, '$1', 'x')], null)
  check('no myUserId -> nothing is mine', anon.reactions.get('$1')![0].mine === false)
}

console.log('\n-- replies --')
{
  const target = msg('$1', OTHER, 100, 'question')
  const reply = msg('$2', ME, 200, 'answer', {
    'm.relates_to': { 'm.in_reply_to': { event_id: '$1' } },
  })
  const idx = buildRelationIndex([target, reply], ME)
  const ref = resolveReply(reply, idx.byId)
  check('reply target id read', ref?.eventId === '$1')
  check('reply target resolved in window', ref?.event?.getId() === '$1')

  // Target outside the loaded window: id known, event null.
  const lonely = buildRelationIndex([reply], ME)
  const ref2 = resolveReply(reply, lonely.byId)
  check('unloaded target -> null event, id kept', ref2?.eventId === '$1' && ref2?.event === null)

  check('plain message has no reply', resolveReply(target, idx.byId) === null)

  // MSC3440: a thread reply's in_reply_to is a FALLBACK, not a real reply.
  const threadReply = msg('$3', ME, 300, 'in thread', {
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: '$1',
      is_falling_back: true,
      'm.in_reply_to': { event_id: '$1' },
    },
  })
  check('thread fallback does NOT render as a reply', resolveReply(threadReply, idx.byId) === null)

  // A genuine reply INSIDE a thread (is_falling_back absent/false) still counts.
  const realThreadReply = msg('$4', ME, 400, 'replying to you', {
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: '$1',
      is_falling_back: false,
      'm.in_reply_to': { event_id: '$2' },
    },
  })
  check('real reply inside a thread IS a reply', resolveReply(realThreadReply, idx.byId)?.eventId === '$2')
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
