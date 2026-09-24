// Checks for how a picture, its tags and its reactions share a row
// (launch-polish L5, L6, L7).
//
// L6: "Emojis then own the first column on the right side of the image, but
// can be overlapped by the tag list when it is unfurled." L7: "Emojis need to
// be about twice as big as they are currently, in general." These hold the
// CSS and markup to those, because a layout regression throws nothing -- it
// just draws the tags over the picture again, which is how L5 was reported.
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const css = readFileSync('src/index.css', 'utf8')
const tagsCss = readFileSync('src/mediatags.css', 'utf8')
const timeline = readFileSync('src/ui/Timeline.tsx', 'utf8')
const reactions = readFileSync('src/ui/Reactions.tsx', 'utf8')
const lightbox = readFileSync('src/ui/Lightbox.tsx', 'utf8')
const block = (src: string, sel: string) =>
  new RegExp(`(?:^|\\n)${sel.replace(/[.[\]()]/g, (c) => '\\' + c)}\\s*\\{([^}]*)\\}`).exec(src)?.[1] ?? ''
const px = (v: string | undefined) => Number(/(\d+)px/.exec(v ?? '')?.[1] ?? NaN)
const token = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim()

console.log('\n-- L5: the tags are UNDER the picture, and never wider than it --')
{
  check('the timeline stacks the picture and its tags in one column',
    /<div className="mtags-stack">\s*\n\s*<div className="mtags-media">/.test(timeline))
  check('the lightbox does too', /<div className="mtags-stack">/.test(lightbox))
  const stack = block(tagsCss, '.mtags-stack')
  check('the column is block-level flex (inline-flex added 7px under every picture)',
    /display:\s*flex/.test(stack) && /flex-direction:\s*column/.test(stack), stack)
  const bubble = block(tagsCss, '.mtags-bubble')
  check('the line is out of the width calculation and then as wide as the picture',
    /width:\s*0/.test(bubble) && /min-width:\s*100%/.test(bubble), bubble)
  check('one line, never wrapping', /flex-wrap:\s*nowrap/.test(bubble), bubble)
  check('a FIXED height, so an empty, a filled and a control-only line are the same row',
    /\n\s*height:\s*[\d.]+rem/.test(bubble), bubble)
  check('cut at the picture\'s edge, not painted over the time and reactions beside it',
    /overflow:\s*clip/.test(bubble), bubble)
  const expose = block(tagsCss, '.mtags-expose')
  check('the control can shrink under a narrow picture', /flex:\s*0 1 auto/.test(expose) && /min-width:\s*0/.test(expose), expose)
  check('and its words give way before its count',
    /text-overflow:\s*ellipsis/.test(block(tagsCss, '.mtags-expose-label')) && /flex:\s*none/.test(block(tagsCss, '.mtags-expose-n')))
  const tags = readFileSync('src/ui/MediaTags.tsx', 'utf8')
  check('before the set arrives, a reserved empty line holds the space (no-forced-reflow)',
    /variant === 'bubble' && reserve \? <div className="mtags-bubble" aria-hidden="true" \/>/.test(tags))
  check('the timeline reserves it only in rooms that carry tags',
    /reserve=\{roomCarriesTags\(client\?\.getRoom\(roomId\)\)\}/.test(timeline))
  check('an edit refused after the popup closed is still shown, on the line',
    /data-error=\{editError \? 'true' : undefined\}/.test(tags) && !/const \[error, setError\] = useState/.test(tags))
  // Declarations only: the file's own comment explains the rule it replaced.
  const rules = tagsCss.replace(/\/\*[\s\S]*?\*\//g, '')
  check('nothing positions a tag panel beside the picture any more',
    !/\.mtags-panel\b/.test(rules) && !/\.mtags-row\b/.test(rules) && !/left:\s*100%/.test(rules))
}

console.log('\n-- L6: the reactions are the first column right of the picture --')
{
  // The line is [picture+tags][rail][time]: the rail directly follows the
  // body, with nothing reserved between them.
  const line = /<div style=\{\{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 \}\}>\s*\n\s*<div style=\{\{ minWidth: 0 \}\}>\{body\}<\/div>\s*\n\s*<ReactionRail /.test(timeline)
  check('the rail is the next thing after the picture column', line)
  check('the unfurled list is a popup over the page, so it may cover the rail',
    /\.tc-anchored-pop \{[^}]*position:\s*fixed/.test(css))
  check('its unfurl does not leave a clip-path behind that cuts its own shadow',
    /\.tc-anchored-pop \{[^}]*animation:[^;]*\bbackwards;/.test(css) && !/\.tc-anchored-pop \{[^}]*animation:[^;]*\bboth;/.test(css))
}

console.log('\n-- L7: twice as big, from one set of sizes --')
{
  const h = px(token('--tc-react-h'))
  const box = px(token('--tc-react-emoji'))
  const glyph = px(token('--tc-react-glyph'))
  check('the glyph is twice the old 13px', glyph === 26, glyph)
  check('its box is twice the old 16px', box === 32, box)
  check('the pill holds the box', h >= box + 2, [h, box])
  const pill = block(css, '.tc-reaction')
  check('the pill takes its height from the token', /height:\s*var\(--tc-react-h\)/.test(pill), pill)
  check('exactly one rule for the emoji box (there were two, disagreeing)',
    (css.match(/\n\.tc-reaction-key\s*\{/g) ?? []).length === 1)
  const key = block(css, '.tc-reaction-key')
  check('the emoji reads the glyph and box tokens',
    /font-size:\s*var\(--tc-react-glyph\)/.test(key) && /height:\s*var\(--tc-react-emoji\)/.test(key), key)
  const img = block(css, '.tc-reaction-img')
  check('a custom emoji is in a box of definite size (it rendered at its natural size)',
    /width:\s*var\(--tc-react-emoji\)/.test(img) && /height:\s*var\(--tc-react-emoji\)/.test(img), img)
  check('and the pill wraps its picture in that box',
    /<span className="tc-reaction-img">\s*\n\s*<AuthedImage/.test(reactions))
  check('contained, not cropped: a wide emoji shows whole',
    /\.tc-reaction-img img \{\s*object-fit:\s*contain !important;/.test(css))
  const inline = block(css, '.tc-reaction-add-inline')
  check('the "+" inside a text line is taken out of the line box, so no message grows',
    /margin-block:\s*calc\(\(var\(--tc-react-add-inline-h\) - 16px\) \/ -2\)/.test(inline), inline)
  const inlineBtn = block(css, '.tc-reaction-add-inline .tc-reaction-add')
  check('and it keeps the small size: a control in a line of text, not an emoji',
    /height:\s*var\(--tc-react-add-inline-h\)/.test(inlineBtn) && px(token('--tc-react-add-inline-h')) <= 20, inlineBtn)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
