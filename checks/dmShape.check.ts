// The Direct Messages section's shape (operator, 2026-10-05: "the DM window,
// shape is wrong"). It took the pill radius (999px), which a browser clamps
// to half of whatever height the box has: shut, a stadium as intended; open,
// a taller stadium whose ends cut into the faces at the corners. The radius
// is now FIXED at half the COLLAPSED height, so shut it is the same stadium
// and open it is a rounded rectangle. The value lives in index.css and is
// used in DmList.tsx (the user list's section since launch-polish L30; it
// was NavTree.tsx's); this reads both (D-tc01). The look is rendered in
// tools/visual/dmshape.html, before and after, shut and open at 1-3 rows.
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const css = read('src/index.css')
const nav = read('src/ui/DmList.tsx')

const head = /--tc-dm-head-h:\s*(\d+)px;/.exec(css)
check('the header height is defined once, in pixels', !!head && css.match(/--tc-dm-head-h:/g)?.length === 1, head?.[0])
check('the radius is half the collapsed OUTER height: header plus the 1px border above and below',
  /--tc-dm-radius:\s*calc\(\(var\(--tc-dm-head-h\) \+ 2px\) \/ 2\);/.test(css) && css.match(/--tc-dm-radius:/g)?.length === 1)

const sectionAt = nav.indexOf('Direct Messages: a top pill')
const section = nav.slice(sectionAt, nav.indexOf('</button>', sectionAt))
check('the section takes that radius, not the pill\'s', /borderRadius: 'var\(--tc-dm-radius\)'/.test(section) && !/borderRadius: 'var\(--tc-pill-radius\)'/.test(section), section.slice(0, 300))
check('with the 1px border the radius assumes', /border: '1px solid var\(--tc-pill-line\)'/.test(section))
check('the header row is that fixed height, border-box, no vertical padding to add to it',
  /boxSizing: 'border-box',\s*\n\s*height: 'var\(--tc-dm-head-h\)',\s*\n\s*padding: '0 10px'/.test(section))
check('and the comment that called the open section "a rounded container" while it was a stadium is gone',
  !/expanded\s*\n?\s*\/\/\s*it stays a rounded container/.test(nav) && !/it stays a rounded container/.test(nav))

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\ndm shape: all checks passed')
