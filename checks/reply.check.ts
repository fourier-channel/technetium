// Checks for the W2.1 reply content builders. See checks/relations.check.ts
// for how these run (`npm run check`).
import { buildRichReply, escapeHtml, matrixToEvent, matrixToUser, stripMxReply } from '../src/client/matrixHtml.ts'
import { buildReplyContent } from '../src/client/replyContent.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log('  ok   ' + name)
  } else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

function ev(id: string, sender: string, content: Record<string, unknown>): any {
  return {
    getId: () => id,
    getSender: () => sender,
    getContent: () => content,
    getRoomId: () => '!room:x.net',
    isRedacted: () => false,
    getType: () => 'm.room.message',
  }
}

const text = (id: string, sender: string, body: string) =>
  ev(id, sender, { msgtype: 'm.text', body })

const ROOM = '!room:x.net'

console.log('\n-- escapeHtml --')
{
  check('escapes all five', escapeHtml(`<>&"'`) === '&lt;&gt;&amp;&quot;&#39;')
  check('ampersand escaped FIRST (no double-encoding)', escapeHtml('&lt;') === '&amp;lt;')
  check('plain text untouched', escapeHtml('hello world') === 'hello world')
}

console.log('\n-- matrix.to urls --')
{
  check('user url', matrixToUser('@a:x.net') === 'https://matrix.to/#/%40a%3Ax.net')
  // encodeURIComponent leaves '!' alone (it is an unreserved mark); ':' and
  // '$' are escaped. That is fine for a matrix.to permalink.
  check(
    'event url',
    matrixToEvent('!r:x.net', '$e1') === 'https://matrix.to/#/!r%3Ax.net/%24e1',
  )
}

console.log('\n-- stripMxReply --')
{
  check('removes the block and its contents', stripMxReply('<mx-reply><blockquote>old</blockquote></mx-reply>new') === 'new')
  check('case-insensitive', stripMxReply('<MX-REPLY>x</MX-REPLY>new') === 'new')
  check('no block passes through', stripMxReply('<b>hi</b>') === '<b>hi</b>')
  check('multiline block removed', stripMxReply('<mx-reply>\n<blockquote>\na\n</blockquote>\n</mx-reply>new') === 'new')
}

console.log('\n-- buildRichReply: plain-text fallback --')
{
  const target = text('$1', '@alice:x.net', 'first line\nsecond line')
  const r = buildRichReply(target, ROOM, 'my answer')
  const lines = r.body.split('\n')
  check('first quote line carries the sender', lines[0] === '> <@alice:x.net> first line')
  check('subsequent lines quoted without the sender', lines[1] === '> second line')
  check('blank line separates quote from the reply', lines[2] === '')
  check('reply text last', lines[3] === 'my answer')
}

console.log('\n-- buildRichReply: chains do not accumulate --')
{
  // A target that is ITSELF a reply carries its own fallback. Quoting it must
  // use only its new text, else every reply in a chain grows by the whole chain.
  const target = text('$2', '@bob:x.net', '> <@alice:x.net> original\n\nbobs answer')
  const r = buildRichReply(target, ROOM, 'my answer')
  check('older quote is dropped', !r.body.includes('original'))
  check('only the direct parent is quoted', r.body.startsWith('> <@bob:x.net> bobs answer'))
  check('html fallback also drops the older quote', !r.formattedBody.includes('original'))
}

console.log('\n-- buildRichReply: html fallback --')
{
  const target = text('$1', '@alice:x.net', 'hello')
  const r = buildRichReply(target, ROOM, 'answer')
  check('wrapped in mx-reply', r.formattedBody.startsWith('<mx-reply><blockquote>'))
  check('closes the wrapper before the new body', r.formattedBody.includes('</blockquote></mx-reply>answer'))
  check('links to the event', r.formattedBody.includes(matrixToEvent(ROOM, '$1')))
  check('links to the sender', r.formattedBody.includes(matrixToUser('@alice:x.net')))
  check('stripping the wrapper leaves exactly the new body', stripMxReply(r.formattedBody) === 'answer')

  const withHtml = buildRichReply(target, ROOM, 'answer', '<b>answer</b>')
  check('supplied html is used for the new body', stripMxReply(withHtml.formattedBody) === '<b>answer</b>')

  const multi = buildRichReply(target, ROOM, 'line1\nline2')
  check('plain newlines become <br> in the new body', stripMxReply(multi.formattedBody) === 'line1<br>line2')
}

console.log('\n-- buildRichReply: hostile input is escaped, never relayed --')
{
  const nasty = text('$1', '@evil:x.net', '<script>alert(1)</script>')
  const r = buildRichReply(nasty, ROOM, 'ok')
  check('script tag escaped in the quote', !r.formattedBody.includes('<script>'))
  check('escaped form present instead', r.formattedBody.includes('&lt;script&gt;'))

  // A target with its OWN formatted_body must not have that html relayed --
  // we escape its plain body instead of carrying someone else's markup.
  const richTarget = ev('$1', '@evil:x.net', {
    msgtype: 'm.text',
    body: 'plain version',
    format: 'org.matrix.custom.html',
    formatted_body: '<img src=x onerror=alert(1)>',
  })
  const r2 = buildRichReply(richTarget, ROOM, 'ok')
  check('target formatted_body is NOT relayed', !r2.formattedBody.includes('onerror'))
  check('escaped plain body used instead', r2.formattedBody.includes('plain version'))

  const nastySender = ev('$1', '@a"><script>:x.net', { msgtype: 'm.text', body: 'x' })
  const r3 = buildRichReply(nastySender, ROOM, 'ok')
  check('sender id escaped in the href attribute', !r3.formattedBody.includes('"><script>'))
}

console.log('\n-- buildReplyContent --')
{
  const target = text('$1', '@alice:x.net', 'hello')
  const c: any = buildReplyContent(target, ROOM, 'answer')
  check('msgtype is m.text', c.msgtype === 'm.text')
  check('in_reply_to points at the target', c['m.relates_to']['m.in_reply_to'].event_id === '$1')
  check('no rel_type -- the sdk adds m.thread when in a thread', c['m.relates_to'].rel_type === undefined)
  check('format declared', c.format === 'org.matrix.custom.html')
  check('body carries the plain fallback', c.body.includes('> <@alice:x.net> hello'))
  check('body ends with the reply text', c.body.endsWith('answer'))
  check('formatted_body carries the html fallback', c.formatted_body.startsWith('<mx-reply>'))
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
