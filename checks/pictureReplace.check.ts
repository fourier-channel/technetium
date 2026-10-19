// Replace picture: who is offered it, whether it is switched on, and the exact
// edit it sends -- which is the contract Neru-chan reads (fourier-tunnel
// capabilities/replace.js pictureEdit: m.relates_to m.replace, m.new_content
// an m.image with a url, net.41chan.replace.old_file keep|expire).
import { buildPictureEdit, canReplacePicture, replaceEnabledFrom, REPLACE_CHOICE_KEY } from '../src/client/pictureReplace'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

const store = (v: string | null) => ({ read: () => v, write: () => {}, remove: () => {} })

console.log('== held: off in production unless opted in')
check('build flag "1" turns it on', replaceEnabledFrom({ flag: '1' }, store(null)))
check('any other flag value does not', !replaceEnabledFrom({ flag: 'true' }, store(null)) && !replaceEnabledFrom({ flag: 1 }, store(null)))
check('dev turns it on', replaceEnabledFrom({ dev: true }, null))
check('the per-browser opt-in turns it on', replaceEnabledFrom({}, store('1')))
check('nothing set: off', !replaceEnabledFrom({}, store(null)) && !replaceEnabledFrom({}, null))

console.log('== who is offered it')
const pic = { msgtype: 'm.image', body: 'a.png', url: 'mxc://41chan.net/OLD' }
const base = { content: pic, sender: '@ann:x', me: '@ann:x', eventId: '$e', roomEncrypted: false }
check('your own unencrypted picture: yes', canReplacePicture(base))
check('someone else\'s: no (only the sender can edit, which is the creator-only rule)', !canReplacePicture({ ...base, me: '@bob:x' }))
check('in an encrypted room: no', !canReplacePicture({ ...base, roomEncrypted: true }))
check('an encrypted attachment: no', !canReplacePicture({ ...base, content: { ...pic, url: undefined, file: { url: 'mxc://x/y' } } }))
check('a local echo: no', !canReplacePicture({ ...base, eventId: '~local' }))
check('text: no', !canReplacePicture({ ...base, content: { msgtype: 'm.text', body: 'hi' } }))
check('signed out: no', !canReplacePicture({ ...base, me: null }))

console.log('== the edit it sends')
{
  const e = buildPictureEdit({ originalId: '$orig', current: pic, url: 'mxc://41chan.net/NEW', info: { mimetype: 'image/png', w: 10, h: 10 }, filename: 'b.png', oldFile: 'expire' })
  const rel = e['m.relates_to'] as { rel_type?: string; event_id?: string }
  const nc = e['m.new_content'] as Record<string, unknown>
  check('an m.replace of the original', rel?.rel_type === 'm.replace' && rel?.event_id === '$orig')
  check('the new content is an m.image naming the new file', nc?.msgtype === 'm.image' && nc?.url === 'mxc://41chan.net/NEW' && nc?.filename === 'b.png')
  check('no relation inside m.new_content', !('m.relates_to' in (nc ?? {})))
  check('the fallback carries the new file too', e.url === 'mxc://41chan.net/NEW' && e.body === '* b.png')
  check('the old-file choice rides where Neru-chan reads it', REPLACE_CHOICE_KEY === 'net.41chan.replace' && (e[REPLACE_CHOICE_KEY] as { old_file?: string })?.old_file === 'expire')
}
{
  const captioned = { ...pic, body: 'my best one', filename: 'a.png', format: 'org.matrix.custom.html', formatted_body: '<b>my best one</b>' }
  const e = buildPictureEdit({ originalId: '$orig', current: captioned, url: 'mxc://41chan.net/NEW', info: {}, filename: 'b.png', oldFile: 'keep' })
  const nc = e['m.new_content'] as Record<string, unknown>
  check('a caption is kept, not replaced by the file name', nc.body === 'my best one' && nc.filename === 'b.png' && nc.formatted_body === '<b>my best one</b>')
  check('keep rides too', (e[REPLACE_CHOICE_KEY] as { old_file?: string }).old_file === 'keep')
}

if (failures) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
