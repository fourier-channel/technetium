// A picture an event REFERENCES on the booru rather than uploads (4chan lens
// L0b; fourier-basis docs/design/LIVE_4CHAN_LENS.md).
//
// Holds: a reference is read only from content["net.41chan.booru"] with a
// file name the media gate itself accepts (32 hex, 1-5 alphanumerics),
// lowercased so one picture has one address; post_id, w and h are positive
// integers or absent; the in-client address is mxc://booru.41chan.net/<file>;
// mediaUrl sends that address to the booru's media gate and NEVER to the
// homeserver, while a real mxc is unchanged; a reference with no post yet
// names no picture (ruling 1: nothing shows until the booru has a post); the
// tag store never asks the homeserver about a booru picture, the row seeds the
// store with the post, and the withheld/blocked filter knows the picture by
// the same address the row draws.
import { readFileSync } from 'node:fs'
const {
  parseBooruRef, isBooruMxc, booruMediaUrl, pictureMxcOf, BOORU_REF_KEY, BOORU_MEDIA_SERVER,
} = await import('../src/client/booruRef.ts')
const { mediaUrl } = await import('../src/client/media.ts')
const { BOORU_ORIGIN } = await import('../src/client/booruUrl.ts')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const MD5 = '0123456789abcdef0123456789abcdef'
const ref = (r: Record<string, unknown>) => ({ msgtype: 'm.text', body: 'x', [BOORU_REF_KEY]: r })

console.log('\n-- a reference is read only in its own shape --')
{
  const full = parseBooruRef(ref({ post_id: 42, md5: MD5, ext: 'png', w: 800, h: 600 }))
  check('a full reference parses', full?.postId === 42 && full.md5 === MD5 && full.ext === 'png'
    && full.w === 800 && full.h === 600, full)
  check('the in-client address is the booru mxc',
    full?.mxc === `mxc://${BOORU_MEDIA_SERVER}/${MD5}.png`, full?.mxc)
  check('the key is net.41chan.booru', BOORU_REF_KEY === 'net.41chan.booru')
  const upper = parseBooruRef(ref({ post_id: 1, md5: MD5.toUpperCase(), ext: '.JPG' }))
  check('case and a leading dot are normalised, one picture one address',
    upper?.mxc === `mxc://${BOORU_MEDIA_SERVER}/${MD5}.jpg`, upper)
  check('no reference key is null', parseBooruRef({ msgtype: 'm.text', body: 'x' }) === null)
  check('null content is null', parseBooruRef(null) === null)
  check('an array is not a reference', parseBooruRef({ [BOORU_REF_KEY]: [MD5, 'png'] }) === null)
  check('a short md5 is refused', parseBooruRef(ref({ md5: MD5.slice(1), ext: 'png' })) === null)
  check('a non-hex md5 is refused', parseBooruRef(ref({ md5: 'g' + MD5.slice(1), ext: 'png' })) === null)
  check('a path in the md5 is refused', parseBooruRef(ref({ md5: '../' + MD5, ext: 'png' })) === null)
  check('a long ext is refused', parseBooruRef(ref({ md5: MD5, ext: 'abcdef' })) === null)
  check('a path in the ext is refused', parseBooruRef(ref({ md5: MD5, ext: 'p/ng' })) === null)
  check('a number md5 is refused', parseBooruRef(ref({ md5: 123, ext: 'png' })) === null)
}

console.log('\n-- post_id, w and h are positive integers or absent --')
{
  const pid = (v: unknown) => parseBooruRef(ref({ post_id: v, md5: MD5, ext: 'png' }))?.postId
  check('no post_id is a picture being tagged', pid(undefined) === undefined)
  check('a zero post_id is absent', pid(0) === undefined)
  check('a negative post_id is absent', pid(-3) === undefined)
  check('a fractional post_id is absent', pid(1.5) === undefined)
  check('a string post_id is absent', pid('42') === undefined)
  check('a positive post_id is kept', pid(7) === 7)
  const sized = parseBooruRef(ref({ post_id: 1, md5: MD5, ext: 'png', w: 'big', h: -1 }))
  check('bad sizes are absent, the reference still parses',
    sized !== null && sized.w === undefined && sized.h === undefined, sized)
}

console.log('\n-- the media gate address --')
{
  check('original', booruMediaUrl(`${MD5}.png`) === `${BOORU_ORIGIN}/fourier/booru/${MD5}.png`)
  check('variant', booruMediaUrl(`${MD5}.png`, 320) === `${BOORU_ORIGIN}/fourier/booru/${MD5}.png?w=320`)
  check('a name the gate would refuse is null', booruMediaUrl('../profile.json') === null)
  check('an uppercase name is null (never a second address)', booruMediaUrl(`${MD5.toUpperCase()}.png`) === null)
}

console.log('\n-- mediaUrl: a booru picture goes to the booru, never the homeserver --')
{
  let askedHomeserver = 0
  const client = {
    getHomeserverUrl: () => { askedHomeserver++; return 'https://matrix.example.net/' },
    getRoom: () => ({ hasEncryptionStateEvent: () => false }),
  } as any
  const booru = `mxc://${BOORU_MEDIA_SERVER}/${MD5}.webp`
  const thumb = mediaUrl(client, booru, 320, '!room:41chan.net')
  const full = mediaUrl(client, booru, undefined, '!room:41chan.net')
  check('thumbnail is the gate variant', thumb === `${BOORU_ORIGIN}/fourier/booru/${MD5}.webp?w=320`, thumb)
  check('download is the gate original', full === `${BOORU_ORIGIN}/fourier/booru/${MD5}.webp`, full)
  check('no room hint rides to the booru', !thumb?.includes('room_id') && !full?.includes('room_id'))
  check('the homeserver was not consulted', askedHomeserver === 0, askedHomeserver)
  check('a bad file name on the booru server is null, not a homeserver URL',
    mediaUrl(client, `mxc://${BOORU_MEDIA_SERVER}/nope`, 320) === null)
  const real = mediaUrl(client, 'mxc://41chan.net/abc123', 320)
  check('a real mxc still goes to the homeserver',
    !!real?.startsWith('https://matrix.example.net/_matrix/client/v1/media/thumbnail/41chan.net/abc123'), real)
  check('isBooruMxc tells them apart', isBooruMxc(booru) && !isBooruMxc('mxc://41chan.net/abc123'))
}

console.log('\n-- a picture is named only once it has a post --')
{
  const img = { msgtype: 'm.image', url: 'mxc://41chan.net/abc', body: 'a.png' }
  check('an m.image is its own url', pictureMxcOf(img) === 'mxc://41chan.net/abc')
  check('a posted reference is its booru address',
    pictureMxcOf(ref({ post_id: 9, md5: MD5, ext: 'gif' })) === `mxc://${BOORU_MEDIA_SERVER}/${MD5}.gif`)
  check('a reference being tagged names nothing', pictureMxcOf(ref({ md5: MD5, ext: 'gif' })) === undefined)
  check('plain text names nothing', pictureMxcOf({ msgtype: 'm.text', body: 'hi' }) === undefined)
}

console.log('\n-- the surfaces that take it --')
{
  const tags = readFileSync(new URL('../src/client/useMediaTags.ts', import.meta.url), 'utf8')
  const fetchTags = tags.slice(tags.indexOf('export function fetchTags'), tags.indexOf('export function seedBooruRef'))
  check('fetchTags returns for a booru picture before asking anyone',
    /if \(isBooruMxc\(mxc\)\) return/.test(fetchTags)
      && fetchTags.indexOf('isBooruMxc(mxc)') < fetchTags.indexOf('beginAsk('))
  const seed = tags.slice(tags.indexOf('export function seedBooruRef'))
  check('seedBooruRef writes only when the post is new',
    /sets\.get\(mediaId\)\?\.postId === postId\) return/.test(seed) && /ingestSet\(/.test(seed))

  const timeline = readFileSync(new URL('../src/ui/Timeline.tsx', import.meta.url), 'utf8')
  check('the row seeds the store when the reference has a post',
    /if \(ref\.postId !== undefined\) seedBooruRef\(ref\.mxc, ref\.postId\)/.test(timeline))
  check('a reference being tagged draws the tagging slot, no image',
    /data-testid="booru-tagging"/.test(timeline))

  const tl = readFileSync(new URL('../src/client/useTimeline.ts', import.meta.url), 'utf8')
  const withheld = tl.slice(tl.indexOf('function isWithheld'), tl.indexOf('function isWithheld') + 600)
  check('the withheld/blocked filter names the picture by pictureMxcOf', /pictureMxcOf\(/.test(withheld))

  const seq = readFileSync(new URL('../src/ui/mediaSequence.ts', import.meta.url), 'utf8')
  check('the lightbox sequence takes a posted reference', /parseBooruRef\(/.test(seq))
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
