// Pure-helper checks for the one-line event preview used by the composer
// reply/edit banner. See checks/relations.check.ts for how these run.
import { eventPreview, stripReplyFallback } from '../src/client/eventPreview.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log('  ok   ' + name)
  } else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

function ev(content: Record<string, unknown>, opts: { redacted?: boolean; type?: string } = {}): any {
  return {
    getContent: () => content,
    getType: () => opts.type ?? 'm.room.message',
    isRedacted: () => !!opts.redacted,
  }
}

const text = (body: string) => ev({ msgtype: 'm.text', body })

console.log('\n-- stripReplyFallback --')
{
  check('no fallback passes through', stripReplyFallback('hello') === 'hello')
  check(
    'single quote line stripped',
    stripReplyFallback('> <@a:x.net> old\n\nnew') === 'new',
  )
  check(
    'multi-line quote stripped',
    stripReplyFallback('> <@a:x.net> old\n> more old\n\nnew') === 'new',
  )
  check('a later > is NOT stripped', stripReplyFallback('new\n> quoted') === 'new\n> quoted')
}

console.log('\n-- eventPreview --')
{
  check('plain text', eventPreview(text('hello there')) === 'hello there')
  check('newlines collapse to one line', eventPreview(text('a\nb\n\nc')) === 'a b c')
  check('leading/trailing space trimmed', eventPreview(text('   padded   ')) === 'padded')

  check('redacted', eventPreview(ev({}, { redacted: true })) === '(message deleted)')

  check('image with body', eventPreview(ev({ msgtype: 'm.image', body: 'cat.png' })) === '[image] cat.png')
  check('image without body', eventPreview(ev({ msgtype: 'm.image' })) === '[image]')
  check('file', eventPreview(ev({ msgtype: 'm.file', body: 'doc.pdf' })) === '[file] doc.pdf')
  check('video', eventPreview(ev({ msgtype: 'm.video' })) === '[video]')

  // A reply's plain body carries the quoted original; previewing must show the
  // NEW text, not the message being replied to.
  check(
    'reply fallback excluded from the preview',
    eventPreview(text('> <@a:x.net> the old message\n\nthe new message')) === 'the new message',
  )

  const long = 'x'.repeat(200)
  const out = eventPreview(text(long))
  check('long body truncated to max', out.length === 120, out.length)
  check('truncation is marked with ASCII ellipsis', out.endsWith('...'))
  check('short body not truncated', !eventPreview(text('short')).endsWith('...'))

  check('empty body falls back to the event type', eventPreview(text('')) === 'm.room.message')
  check('missing body does not throw', eventPreview(ev({ msgtype: 'm.text' })) === 'm.room.message')
  check(
    'non-string body does not throw',
    eventPreview(ev({ msgtype: 'm.text', body: { evil: true } })) === 'm.room.message',
  )
  check(
    'state-ish event falls back to its type',
    eventPreview(ev({}, { type: 'm.room.topic' })) === 'm.room.topic',
  )
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
