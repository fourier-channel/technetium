// Checks for W2.8 forward-content building. See checks/relations.check.ts for
// how these run (`npm run check`).
import { buildForwardContent, isForwardable } from '../src/client/forwardContent.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log('  ok   ' + name)
  } else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

console.log('\n-- isForwardable --')
{
  check('text', isForwardable({ msgtype: 'm.text', body: 'hi' } as any))
  check('image', isForwardable({ msgtype: 'm.image', url: 'mxc://x/y', body: 'a.png' } as any))
  check('no msgtype', !isForwardable({ body: 'hi' } as any))
  check('msgtype but nothing to carry', !isForwardable({ msgtype: 'm.text' } as any))
}

console.log('\n-- context is stripped, content is kept --')
{
  const original: any = {
    msgtype: 'm.text',
    body: '> <@a:x.net> quoted\n\nthe real text',
    format: 'org.matrix.custom.html',
    formatted_body: '<mx-reply><blockquote>quoted</blockquote></mx-reply>the real text',
    'm.relates_to': { 'm.in_reply_to': { event_id: '$1' } },
    'm.mentions': { user_ids: ['@c:x.net'] },
    'net.41chan.gallery': { id: 'batch1', index: 0, count: 3 },
    'net.41chan.domain_ttd': 60,
  }
  const out: any = buildForwardContent(original)

  check('msgtype kept', out.msgtype === 'm.text')
  // A reply to an event that does not exist in the target room.
  check('m.relates_to stripped', out['m.relates_to'] === undefined)
  // Forwarding must not ping people mentioned in another conversation.
  check('m.mentions stripped', out['m.mentions'] === undefined)
  // A forwarded image is not part of the original gallery.
  check('gallery hint stripped', out['net.41chan.gallery'] === undefined)
  check('domain ttd stripped', out['net.41chan.domain_ttd'] === undefined)
  check('reply fallback stripped from body', out.body === 'the real text', out.body)
  check(
    'mx-reply stripped from formatted_body',
    out.formatted_body === 'the real text',
    out.formatted_body,
  )
  check('the original object is not mutated', original['m.relates_to'] !== undefined)
}

console.log('\n-- images forward by reference --')
{
  const img: any = buildForwardContent({
    msgtype: 'm.image',
    url: 'mxc://server/abc',
    body: 'cat.png',
    info: { mimetype: 'image/png', size: 1234 },
  } as any)
  // Same content URI named again: no re-upload, so no second copy on the
  // homeserver and no duplicate booru post from the bridge.
  check('mxc url preserved verbatim', img.url === 'mxc://server/abc')
  check('info preserved', img.info?.size === 1234)
  check('filename/body preserved', img.body === 'cat.png')
}

console.log('\n-- an edited message forwards its CURRENT text --')
{
  // The verb passes item.content, which is the effective content with the
  // winning edit applied (S1). m.new_content must not ride along.
  const out: any = buildForwardContent({
    msgtype: 'm.text',
    body: 'the edited text',
    'm.new_content': { msgtype: 'm.text', body: 'the edited text' },
  } as any)
  check('m.new_content stripped', out['m.new_content'] === undefined)
  check('body is the current text', out.body === 'the edited text')
}

console.log('\n-- plain forwards are untouched --')
{
  const out: any = buildForwardContent({ msgtype: 'm.text', body: 'just text' } as any)
  check('body unchanged', out.body === 'just text')
  check('no stray keys added', Object.keys(out).sort().join(',') === 'body,msgtype')
  // A message that legitimately begins with a quote is not a reply fallback.
  const quoted: any = buildForwardContent({ msgtype: 'm.text', body: '> not a fallback' } as any)
  check('a lone quote line survives', quoted.body === '> not a fallback', quoted.body)
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
