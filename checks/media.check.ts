// Checks for the media URL builder.
//
// This is the single most load-bearing function in the media path -- every
// picture on screen is one of its outputs -- and it had no coverage at all.
// The cases below are the ones that have actually gone wrong: a room hint sent
// where it was not wanted, and the same bytes fetched more than once because
// the cache was keyed on the arguments rather than on the request.
import { mediaUrl, parseMxc, THUMB_SIZES } from '../src/client/media.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const MXC = 'mxc://41chan.net/abc123'
const ROOM = '!room:41chan.net'

// Minimal stand-in: mediaUrl only ever asks for the homeserver URL and whether
// a room carries an encryption state event.
const clientWith = (encrypted: boolean | null) =>
  ({
    getHomeserverUrl: () => 'https://matrix.example.net/',
    getRoom: (_id: string) =>
      encrypted === null ? null : { hasEncryptionStateEvent: () => encrypted },
  }) as any

console.log('\n-- the room hint is for encrypted rooms only --')
{
  // The regression: the comment said "only ever needed for ENCRYPTED rooms"
  // and the code sent it for every room that had an id. In an unencrypted room
  // the server can already see the event, so the hint adds nothing and asks a
  // stricter question about media legitimately rendered elsewhere -- a forward,
  // a thread panel, a gallery cell.
  const plain = mediaUrl(clientWith(false), MXC, 320, ROOM)!
  check('an unencrypted room sends no room hint', !plain.includes('room_id'), plain)

  // Read the DECODED param rather than matching an encoded string:
  // URLSearchParams escapes '!' where encodeURIComponent does not, and an
  // assertion that encodes it by hand tests the test, not the code.
  const enc = mediaUrl(clientWith(true), MXC, 320, ROOM)!
  check('an encrypted room still sends it', new URL(enc).searchParams.get('room_id') === ROOM, enc)

  // A room we do not have yet must not be guessed at in either direction.
  const unknown = mediaUrl(clientWith(null), MXC, 320, ROOM)!
  check('an unknown room sends no hint', !unknown.includes('room_id'), unknown)

  check('no room id, no hint', !mediaUrl(clientWith(false), MXC, 320)!.includes('room_id'))
}

console.log('\n-- the URL is the cache key, so it must be stable --')
{
  // Two renders of the same picture from different rooms now produce the SAME
  // url, which is what makes them one cache entry and one download instead of
  // three of each.
  const a = mediaUrl(clientWith(false), MXC, 320, '!one:41chan.net')
  const b = mediaUrl(clientWith(false), MXC, 320, '!two:41chan.net')
  const c = mediaUrl(clientWith(false), MXC, 320)
  check('the same image from different rooms is one URL', a === b && b === c, [a, b, c])

  // ...and things that genuinely differ must NOT collide, or one size would
  // serve another and the cache would hand back the wrong picture.
  const sizes = new Set(THUMB_SIZES.map((w) => mediaUrl(clientWith(false), MXC, w)))
  check('each size is a distinct URL', sizes.size === THUMB_SIZES.length)
  check('a thumbnail is not the download URL',
    mediaUrl(clientWith(false), MXC, 320) !== mediaUrl(clientWith(false), MXC))
  check('different media do not collide',
    mediaUrl(clientWith(false), MXC, 320) !==
      mediaUrl(clientWith(false), 'mxc://41chan.net/zzz999', 320))
}

console.log('\n-- URL shape --')
{
  const thumb = mediaUrl(clientWith(false), MXC, 180)!
  check('thumbnails use the thumbnail endpoint', thumb.includes('/_matrix/client/v1/media/thumbnail/'))
  check('the trailing slash on the homeserver url is not doubled',
    !thumb.includes('net//_matrix'), thumb)
  check('a thumbnail carries width, height and method',
    thumb.includes('width=180') && thumb.includes('height=180') && thumb.includes('method=scale'))
  const full = mediaUrl(clientWith(false), MXC)!
  check('the unsized request uses download', full.includes('/media/download/') && !full.includes('?'))

  // A malformed mxc must be refused rather than turned into a URL that 404s.
  check('a malformed mxc yields null', mediaUrl(clientWith(false), 'not-an-mxc', 320) === null)
  check('parseMxc agrees', parseMxc('not-an-mxc') === null && parseMxc(MXC)?.mediaId === 'abc123')

  // Server names and ids are path segments and must be escaped, or an id with
  // a slash in it would silently address a different path.
  const odd = mediaUrl(clientWith(false), 'mxc://a b.net/x%y', 320)!
  check('path segments are encoded', odd.includes('a%20b.net') && odd.includes('x%25y'), odd)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
