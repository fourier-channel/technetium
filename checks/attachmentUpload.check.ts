// Checks that a picture's upload is never made twice for one send.
//
// Measured on production 2026-10-01: media in the repo that no event references.
// A send that failed AFTER its upload landed put the picture back in the tray
// with nothing remembered, so Send again uploaded the same bytes a second time
// and the first copy was orphaned. The encrypted path uploaded its thumbnail
// before the picture, so a failed main upload orphaned the thumbnail too.
import {
  sendAttachment,
  removePendingAttachment,
  describeAttachmentFailure,
  AttachmentStageError,
  type UploadStash,
  type ReadyUpload,
} from '../src/client/attachmentUpload.ts'
import { uploadAndPostBackground, type BackgroundAttempt } from '../src/client/backgroundPost.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// A fake media repo that counts uploads by the name they were sent under and
// fails the next N uploads of a given name on demand.
function fakeIo(opts: { failUploads?: Record<string, number>; thumb?: boolean } = {}) {
  const calls: string[] = []
  const failLeft = { ...(opts.failUploads ?? {}) }
  let n = 0
  return {
    calls,
    count: (name: string) => calls.filter((c) => c === name).length,
    io: {
      async uploadContent(_body: Blob, o: { name: string; type: string }) {
        calls.push(o.name)
        if ((failLeft[o.name] ?? 0) > 0) {
          failLeft[o.name]--
          throw Object.assign(new Error('Timeout'), {})
        }
        n++
        return { content_uri: `mxc://test/${o.name}-${n}` }
      },
      async makeThumbnail() {
        if (opts.thumb === false) return null
        return { blob: new Blob([new Uint8Array([1, 2, 3])]), w: 4, h: 3, mimetype: 'image/png' }
      },
    },
  }
}

// An event sender that fails its first `failFirst` calls.
function fakeSend(failFirst: number) {
  const sent: ReadyUpload[] = []
  let left = failFirst
  return {
    sent,
    async sendEvent(up: ReadyUpload) {
      if (left > 0) { left--; throw Object.assign(new Error('socket hang up'), {}) }
      sent.push(up)
      return { event_id: '$e' }
    },
  }
}

const file = new File([new Uint8Array([9, 8, 7, 6, 5])], 'cat.png', { type: 'image/png' })

async function attempt(args: Parameters<typeof sendAttachment>[0]): Promise<unknown> {
  try { await sendAttachment(args); return null } catch (err) { return err }
}

console.log('== a failed event send does not re-upload on retry (unencrypted)')
{
  const stash: UploadStash = new Map()
  const m = fakeIo()
  const s = fakeSend(1)
  const args = { id: 'a1', file, encrypt: false, stash, io: m.io, sendEvent: s.sendEvent }
  const first = await attempt(args)
  check('the first send fails at the send stage',
    first instanceof AttachmentStageError && first.stage === 'send', first)
  check('the landed upload is remembered for the retry', stash.get('a1')?.main?.contentUri !== undefined)
  const second = await attempt(args)
  check('the retry succeeds', second === null, second)
  check('uploadContent was called exactly once across both presses', m.count('cat.png') === 1, m.calls)
  check('the event carries the mxc from that one upload',
    s.sent.length === 1 && s.sent[0].contentUri === 'mxc://test/cat.png-1', s.sent)
  check('the stash entry is gone once the event is sent', !stash.has('a1'))
}

console.log('\n== encrypted: picture and thumbnail each upload once across a retry')
{
  const stash: UploadStash = new Map()
  const m = fakeIo()
  const s = fakeSend(1)
  const args = { id: 'e1', file, encrypt: true, stash, io: m.io, sendEvent: s.sendEvent }
  await attempt(args)
  const keyBefore = stash.get('e1')?.main?.encrypted?.key.k
  const second = await attempt(args)
  check('the retry succeeds', second === null, second)
  check('the encrypted picture uploaded once', m.count('encrypted') === 1, m.calls)
  check('the encrypted thumbnail uploaded once', m.count('encrypted-thumbnail') === 1, m.calls)
  const sent = s.sent[0]
  check('the event keeps the key that matches the uploaded ciphertext',
    !!keyBefore && sent?.encrypted?.key.k === keyBefore)
  const tf = sent?.thumbInfo.thumbnail_file as { url?: string } | undefined
  check('the event carries the thumbnail from that one upload',
    typeof tf?.url === 'string' && tf.url.startsWith('mxc://test/encrypted-thumbnail-'), sent?.thumbInfo)
}

console.log('\n== encrypted: a failed picture upload orphans no thumbnail')
{
  const stash: UploadStash = new Map()
  const m = fakeIo({ failUploads: { encrypted: 1 } })
  const s = fakeSend(0)
  const args = { id: 'e2', file, encrypt: true, stash, io: m.io, sendEvent: s.sendEvent }
  const first = await attempt(args)
  check('the first press fails at the upload stage',
    first instanceof AttachmentStageError && first.stage === 'upload', first)
  check('no thumbnail was uploaded before the picture had landed',
    m.count('encrypted-thumbnail') === 0, m.calls)
  await attempt(args)
  check('after the retry: one thumbnail upload in total', m.count('encrypted-thumbnail') === 1, m.calls)
  check('after the retry: one event', s.sent.length === 1)
}

console.log('\n== encrypted: a failed thumbnail upload keeps the picture for the retry')
{
  const stash: UploadStash = new Map()
  const m = fakeIo({ failUploads: { 'encrypted-thumbnail': 1 } })
  const s = fakeSend(0)
  const args = { id: 'e3', file, encrypt: true, stash, io: m.io, sendEvent: s.sendEvent }
  await attempt(args)
  await attempt(args)
  check('the picture uploaded once', m.count('encrypted') === 1, m.calls)
  check('the thumbnail was retried, not the picture', m.count('encrypted-thumbnail') === 2, m.calls)
  check('one event went', s.sent.length === 1)
}

console.log('\n== no thumbnail possible is settled, not retried')
{
  const stash: UploadStash = new Map()
  const m = fakeIo({ thumb: false })
  const s = fakeSend(1)
  const args = { id: 'e4', file, encrypt: true, stash, io: m.io, sendEvent: s.sendEvent }
  await attempt(args)
  await attempt(args)
  check('one picture upload, no thumbnail upload',
    m.count('encrypted') === 1 && m.count('encrypted-thumbnail') === 0, m.calls)
  check('the event goes without thumbnail fields', s.sent.length === 1 && Object.keys(s.sent[0].thumbInfo).length === 0)
}

console.log('\n== a plaintext upload is never reused in a room that is now encrypted')
{
  const stash: UploadStash = new Map()
  const m = fakeIo()
  const s = fakeSend(1)
  await attempt({ id: 'x1', file, encrypt: false, stash, io: m.io, sendEvent: s.sendEvent })
  await attempt({ id: 'x1', file, encrypt: true, stash, io: m.io, sendEvent: s.sendEvent })
  check('the encrypted retry uploaded ciphertext', m.count('encrypted') === 1, m.calls)
  check('the event is the encrypted one', s.sent.length === 1 && s.sent[0].encrypted !== null)
}

console.log('\n== what each branch hands the media repo')
{
  const bodies: { body: Blob; name: string }[] = []
  const io = {
    async uploadContent(body: Blob, o: { name: string; type: string }) {
      bodies.push({ body, name: o.name })
      return { content_uri: 'mxc://test/b' }
    },
    async makeThumbnail() { return null },
  }
  const ok = async () => ({})
  await sendAttachment({ id: 'p1', file, encrypt: false, stash: new Map(), io, sendEvent: ok })
  check('a plaintext room uploads the untouched file under its own name',
    bodies[0]?.body === file && bodies[0]?.name === 'cat.png', bodies[0])
  await sendAttachment({ id: 'p2', file, encrypt: true, stash: new Map(), io, sendEvent: ok })
  check('an encrypted room uploads other bytes under a name that is not the real one',
    bodies[1]?.body !== file && bodies[1]?.name === 'encrypted', bodies[1])
}

console.log('\n== removing an attachment forgets its upload')
{
  const stash: UploadStash = new Map()
  const m = fakeIo()
  const s = fakeSend(1)
  const args = { id: 'r1', file, encrypt: false, stash, io: m.io, sendEvent: s.sendEvent }
  await attempt(args)
  check('precondition: the failed send left a stash entry', stash.has('r1'))
  const list = [
    { id: 'r1', previewUrl: 'blob:nothing-1' },
    { id: 'r2', previewUrl: 'blob:nothing-2' },
  ]
  const next = removePendingAttachment(list, 'r1', stash)
  check('the attachment leaves the tray', next.length === 1 && next[0].id === 'r2', next)
  check('its stash entry is cleared', !stash.has('r1'))
  // The same id sent again (it cannot be, ids are fresh per pick, but the
  // stash must not be what decides that) starts from a fresh upload.
  await attempt(args)
  check('a later send of that id uploads again', m.count('cat.png') === 2, m.calls)
}

console.log('\n== what the user is told')
{
  const upl = (cause: unknown) => describeAttachmentFailure(new AttachmentStageError('upload', cause))
  const mayHave = /may have arrived/i
  check('an upload that timed out with no answer says it may have arrived',
    mayHave.test(upl(new Error('Timeout'))))
  check('an aborted upload says it may have arrived',
    mayHave.test(upl(Object.assign(new Error('Aborted'), { name: 'AbortError' }))))
  check('a dropped connection during upload says it may have arrived',
    mayHave.test(upl(Object.assign(new Error('request failed: x'), { name: 'ConnectionError' }))))
  check('an upload the server ANSWERED with 413 says too large, not maybe',
    /larger/i.test(upl({ httpStatus: 413, errcode: 'M_TOO_LARGE' })) && !mayHave.test(upl({ httpStatus: 413 })))
  check('an upload refused with an errcode is not a maybe',
    !mayHave.test(upl({ errcode: 'M_FORBIDDEN', httpStatus: 403 })))
  check('a failed EVENT send keeps the ordinary wording',
    !mayHave.test(describeAttachmentFailure(new AttachmentStageError('send', new Error('x')))))
  check('a bare error still produces a sentence',
    describeAttachmentFailure(new Error('x')).length > 15)
}

console.log('\n== domain background: a retry resumes instead of re-uploading')
{
  const bg = new File([new Uint8Array([1, 2])], 'wall.png', { type: 'image/png' })
  let uploads = 0
  let posts = 0
  let failPosts = 1
  const client = {
    async uploadContent() { uploads++; return { content_uri: `mxc://test/bg-${uploads}` } },
    async sendMessage() {
      posts++
      if (failPosts > 0) { failPosts--; throw new Error('socket hang up') }
      return { event_id: `$p${posts}` }
    },
  } as any
  const ref: { current: BackgroundAttempt | null } = { current: null }
  let firstErr: unknown = null
  try { await uploadAndPostBackground(client, '!r:x', bg, 'domain', ref) } catch (e) { firstErr = e }
  check('the first save fails at the post stage', (firstErr as { stage?: string })?.stage === 'post', firstErr)
  const post = await uploadAndPostBackground(client, '!r:x', bg, 'domain', ref)
  check('the retry uploaded nothing new', uploads === 1, { uploads })
  check('the retry posted the first upload', post.mxc === 'mxc://test/bg-1', post)
  // The state write after the post failed: Save again must neither upload
  // nor post a second time.
  const again = await uploadAndPostBackground(client, '!r:x', bg, 'domain', ref)
  check('a resume after a successful post re-posts nothing',
    uploads === 1 && posts === 2 && again.eventId === post.eventId, { uploads, posts })
  const other = new File([new Uint8Array([3])], 'other.png', { type: 'image/png' })
  await uploadAndPostBackground(client, '!r:x', other, 'domain', ref)
  check('a different file starts over', uploads === 2, { uploads })
  await uploadAndPostBackground(client, '!other:x', other, 'domain', ref)
  check('a different room starts over', uploads === 3, { uploads })
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
