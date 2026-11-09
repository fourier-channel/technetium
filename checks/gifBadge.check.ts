// The GIF badge.
//
// Operator, 2026-11-09: "A still picture as the thumbnail is okay, though we
// should have some sort of indication that it can be clicked to animate it."
// A GIF's thumbnail is one still frame; the lightbox fetches the original,
// which moves. Holds: a GIF is recognised by its mimetype (by its name only
// when it has none), both the timeline picture and a gallery cell wear the
// badge, and the badge takes no clicks so the click still opens the picture.
import { readFileSync } from 'node:fs'
import { isGif } from '../src/ui/mediaSequence.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('== which pictures are GIFs')
check('image/gif is', isGif({ mimetype: 'image/gif' }))
check('the mimetype is read without regard to case', isGif({ mimetype: 'IMAGE/GIF' }))
check('a jpeg is not', !isGif({ mimetype: 'image/jpeg', name: 'x.jpg' }))
check('the mimetype wins over a misleading name', !isGif({ mimetype: 'image/png', name: 'x.gif' }))
check('with no mimetype, a .gif name is', isGif({ name: 'Dance.GIF' }))
check('with no mimetype, another name is not', !isGif({ name: 'gif.png' }))
check('nothing at all is not', !isGif({}))

console.log('== where the badge is worn')
const tl = readFileSync(new URL('../src/ui/Timeline.tsx', import.meta.url), 'utf8')
check('the timeline picture wears it, inside its frame',
  /<div className="mtags-media">[\s\S]*?\{isGif\(imageMeta\(event\)\) && <GifBadge \/>\}\s*<\/div>/.test(tl))
check('a gallery cell wears it',
  /onClick=\{onOpen\}\s*\/>\s*\{ev && isGif\(imageMeta\(ev\)\) && <GifBadge \/>\}/.test(tl))

const css = readFileSync(new URL('../src/mediatags.css', import.meta.url), 'utf8')
const rule = (sel: string) => {
  const i = css.indexOf(sel + ' {')
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i))
}
check('the timeline frame positions it', /position:\s*relative/.test(rule('.mtags-stack > .mtags-media')))
check('it sits over the picture', /position:\s*absolute/.test(rule('.gif-badge')))
check('it takes no clicks, so the click opens the picture', /pointer-events:\s*none/.test(rule('.gif-badge')))
check('it does not move', !/animation|transition/.test(rule('.gif-badge')))

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
