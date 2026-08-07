// Checks for the W2.2 edit content builders. See checks/relations.check.ts for
// how these run (`npm run check`).
import { buildEditContent, editableBody, isEditableContent } from '../src/client/editContent.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log('  ok   ' + name)
  } else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

function ev(id: string, content: Record<string, unknown>): any {
  return { getId: () => id, getContent: () => content }
}

console.log('\n-- isEditableContent --')
{
  check('m.text', isEditableContent({ msgtype: 'm.text' } as any))
  check('m.emote', isEditableContent({ msgtype: 'm.emote' } as any))
  check('m.notice', isEditableContent({ msgtype: 'm.notice' } as any))
  // An image's body is a filename or caption, not a draft.
  check('m.image is NOT editable', !isEditableContent({ msgtype: 'm.image' } as any))
  check('m.file is NOT editable', !isEditableContent({ msgtype: 'm.file' } as any))
  check('missing msgtype is NOT editable', !isEditableContent({} as any))
}

console.log('\n-- editableBody --')
{
  check('plain body seeds as-is', editableBody({ body: 'hello' } as any, false) === 'hello')
  // The reply fallback is quoting machinery, not something the author typed.
  check(
    'reply fallback stripped when it IS a reply',
    editableBody({ body: '> <@a:x.net> old\n\nmine' } as any, true) === 'mine',
  )
  check(
    'a body that merely starts with > is left alone when NOT a reply',
    editableBody({ body: '> not a reply quote' } as any, false) === '> not a reply quote',
  )
  check('missing body -> empty string', editableBody({} as any, false) === '')
}

console.log('\n-- buildEditContent --')
{
  const target = ev('$1', { msgtype: 'm.text', body: 'old' })
  const c: any = buildEditContent(target, { msgtype: 'm.text', body: 'old' } as any, 'new text')

  check('rel_type is m.replace', c['m.relates_to'].rel_type === 'm.replace')
  check('targets the original', c['m.relates_to'].event_id === '$1')
  check('fallback body is starred', c.body === '* new text')
  check('m.new_content carries the real text', c['m.new_content'].body === 'new text')
  check('m.new_content carries the msgtype', c['m.new_content'].msgtype === 'm.text')
  // An edit cannot retarget a reply or move a message between threads; the
  // ORIGINAL relation is what survives (relations.ts effectiveContent).
  check('m.new_content has NO m.relates_to', c['m.new_content']['m.relates_to'] === undefined)
  check('no format when the edit is plain', c.format === undefined)
  check('no formatted_body when the edit is plain', c.formatted_body === undefined)

  const withHtml: any = buildEditContent(
    target,
    { msgtype: 'm.text', body: 'old' } as any,
    'new text',
    '<b>new text</b>',
  )
  check('format declared when html is present', withHtml.format === 'org.matrix.custom.html')
  check('fallback formatted_body is starred', withHtml.formatted_body === '* <b>new text</b>')
  check('m.new_content formatted_body is NOT starred', withHtml['m.new_content'].formatted_body === '<b>new text</b>')

  // msgtype comes from the EFFECTIVE content, so editing an emote keeps it an
  // emote rather than silently converting it to m.text.
  const emote: any = buildEditContent(target, { msgtype: 'm.emote', body: 'waves' } as any, 'nods')
  check('msgtype preserved from effective content', emote.msgtype === 'm.emote')
  check('m.new_content msgtype preserved', emote['m.new_content'].msgtype === 'm.emote')

  const noType: any = buildEditContent(target, { body: 'x' } as any, 'y')
  check('missing msgtype defaults to m.text', noType.msgtype === 'm.text')
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
