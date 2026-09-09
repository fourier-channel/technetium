// Checks for sender-side thumbnail geometry.
//
// The DRAWING needs a canvas and cannot run here; only the geometry is checked,
// and saying so is the point -- a check that claimed to cover makeThumbnail
// would be claiming coverage of the half that can actually corrupt a picture.
import { THUMB_MAX_EDGE, thumbDimensions, thumbMimetype } from '../src/client/imageThumbnail.ts'
import { encryptedThumbnailOf } from '../src/client/encryptedFile.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('== when a thumbnail is worth making')
check('an image already inside the box gets none',
  thumbDimensions(400, 300) === null)
check('exactly the max edge gets none',
  thumbDimensions(THUMB_MAX_EDGE, THUMB_MAX_EDGE) === null)
check('one pixel over does get one',
  thumbDimensions(THUMB_MAX_EDGE + 1, 10) !== null)

console.log('\n== the geometry')
{
  const d = thumbDimensions(4000, 2000)!
  check('the long edge lands on the max', d.w === THUMB_MAX_EDGE, d)
  check('aspect is preserved', Math.abs(d.w / d.h - 2) < 0.02, d)
}
{
  const d = thumbDimensions(2000, 4000)!
  check('portrait scales on its own long edge', d.h === THUMB_MAX_EDGE, d)
}
{
  // A canvas of zero height throws. 512/4000 rounds this short edge to 0.
  const d = thumbDimensions(4000, 1)!
  check('an extreme panorama keeps at least one pixel of height', d.h >= 1, d)
}
check('never enlarges', thumbDimensions(10, 10) === null)

console.log('\n== degenerate input is refused, not drawn')
for (const [w, h] of [[0, 100], [100, 0], [-5, 5], [NaN, 10], [Infinity, 10]]) {
  check(`${w}x${h} yields no thumbnail`, thumbDimensions(w as number, h as number) === null)
}

console.log('\n== the output format')
// A JPEG thumbnail of a transparent PNG composites alpha onto black, which
// reads as corruption rather than compression.
check('png keeps png, to keep alpha', thumbMimetype('image/png') === 'image/png')
check('jpeg becomes jpeg', thumbMimetype('image/jpeg') === 'image/jpeg')
check('an unknown type becomes jpeg', thumbMimetype('image/heic') === 'image/jpeg')

console.log('\n== reading one back off an event')
const goodFile = { url: 'mxc://e.org/t', key: { k: 'x' }, iv: 'y', hashes: { sha256: 'z' } }
check('a thumbnail_file with its info is found',
  encryptedThumbnailOf({ info: { thumbnail_file: goodFile, thumbnail_info: { mimetype: 'image/jpeg' } } })?.mimetype === 'image/jpeg')
check('a thumbnail_file without info still works',
  !!encryptedThumbnailOf({ info: { thumbnail_file: goodFile } }))
check('an image with no thumbnail returns null',
  encryptedThumbnailOf({ info: { mimetype: 'image/png' } }) === null)
check('a half-formed thumbnail_file is refused',
  encryptedThumbnailOf({ info: { thumbnail_file: { url: 'mxc://e.org/t' } } }) === null)
check('junk is refused',
  encryptedThumbnailOf(null) === null && encryptedThumbnailOf({ info: 7 }) === null)

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
