// The Settings dialog (launch-polish L20, L21).
//
// L21, operator 2026-09-30: "give it a standard size that doesn't change when
// you flip between menus." It was 380px wide for Encryption and 880px for
// Server permissions (a data-wide attribute), and its height followed the tab.
//
// These read the source, so they prove the text and not the rendering; the
// rendering is looked at in tools/visual/settings.html, which stands the three
// tabs one above the other at their real size.
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const css = read('src/index.css')
const dialog = read('src/ui/SettingsDialog.tsx')

// Every block for a selector, joined -- a rule split over two blocks is still
// one rule, and reading only the first is how a check goes green on half.
function rules(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|\\n|,\\s*)${esc}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'g')
  return [...css.matchAll(re)].map((m) => m[3]).join('\n')
}

console.log('== L21 one size for every tab')
{
  const box = rules('.tc-settings')
  check('the dialog has a fixed width', /\n\s*width: min\(\d+px, calc\(100vw - \d+px\)\);/.test(box), box)
  check('and a fixed HEIGHT, not a max-height that follows the tab',
    /\n\s*height: min\(\d+px, calc\(100dvh - \d+px\)\);/.test(box) && !/max-height/.test(box), box)
  check('it does not scroll as a whole: the body does', /overflow: hidden;/.test(box) && /overflow-y: auto;/.test(rules('.tc-settings-body')))
  check('nothing widens it for one tab any more',
    !/data-wide/.test(dialog) && !/\.tc-settings\[data-wide/.test(css))
  // Every tab's content sits in the one scrolling body; the header and the tab
  // strip stay outside it and hold still.
  const body = dialog.indexOf('<div className="tc-settings-body">')
  check('the body opens after the tab strip and before the first tab',
    body > dialog.indexOf('className="tc-settings-tabs"') && body < dialog.indexOf("{tab === 'server' &&"))
  check('every tab renders inside it',
    ["{tab === 'server' &&", "{tab === 'features' &&", "{tab === 'encryption' &&"].every((t) => dialog.indexOf(t) > body))
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nsettings dialog: all checks passed')
