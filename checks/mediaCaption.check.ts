// The words that came with a picture (launch-polish L26).
//
// Operator, 2026-10-08: "image posts on the matrix server are swallowing any
// text that came with them." The composer has sent MSC2530 captions since its
// first commit; the timeline drew them only under a GALLERY, and a single
// picture never becomes one. Holds the rule and the one place it is drawn.
import { readFileSync } from 'node:fs'
import { hasCaption } from '../src/client/mediaCaption.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('\n-- the rule (MSC2530) --')
{
  check('a picture this client captioned: body is the words, filename the file',
    hasCaption({ msgtype: 'm.image', body: 'look at this', filename: 'cat.png' }))
  check('a plain picture from this client: body is the file name, no filename',
    !hasCaption({ msgtype: 'm.image', body: 'cat.png' }))
  check('a plain picture from a client that sends both: the same string twice',
    !hasCaption({ msgtype: 'm.image', body: 'cat.png', filename: 'cat.png' }))
  check('a blank body is not words', !hasCaption({ msgtype: 'm.image', body: '   ', filename: 'cat.png' }))
  check('no content, no caption', !hasCaption(null) && !hasCaption(undefined))
  check('a non-string body is not words', !hasCaption({ msgtype: 'm.image', body: 3, filename: 'cat.png' }))
}

console.log('\n-- where it is drawn --')
{
  const timeline = readFileSync('src/ui/Timeline.tsx', 'utf8')
  const gallery = /function GalleryBody[\s\S]*?\n}\n/.exec(timeline)?.[0] ?? ''
  const row = /export function Row\([\s\S]*?\n}\n/.exec(timeline)?.[0] ?? ''
  check('found the gallery and the row', gallery.length > 0 && row.length > 0)
  check('the gallery no longer draws a caption of its own (one place, not two)',
    !/caption/i.test(gallery.replace(/\/\/.*$/gm, '')), gallery.length)
  check('the row draws it, for every media row',
    /<MediaCaption content=\{captionContent\} \/>/.test(row))
  check('a single picture reads its own content, with an edit applied',
    /isMediaRow \? item\.content/.test(row))
  check('a gallery reads its first image, where the composer puts the words',
    /kind === 'gallery' \? \(cells\?\.\[0\]\?\.getContent\(\)/.test(row))
  check('and the rule decides, not a filename test of its own',
    /hasCaption\(captionSource\)/.test(row) && !/typeof\s+\w+\?*\.filename === 'string'/.test(row))
  // OUTSIDE the picture-and-rail line: inside the body column it would widen
  // the column and push the reactions off the picture's edge (L6).
  const railLine = row.indexOf('tc-row-time-rail')
  const drawn = row.indexOf('<MediaCaption')
  check('drawn after the picture-and-rail line, not inside it', railLine > 0 && drawn > railLine)
}

console.log('\n-- what the composer sends --')
{
  const composer = readFileSync('src/ui/Composer.tsx', 'utf8')
  check('a captioned send puts the words in body and the name in filename',
    /body: captioned \? caption!\.plain : filename/.test(composer) && /\.\.\.\(captioned \? \{ filename \} : \{\}\)/.test(composer))
}

if (failures > 0) {
  console.log(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nall ok')
