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
  // Inside means between the body's opening tag and ITS closing tag: the
  // first version only held that each tab came after the opening, so closing
  // the body early (one tab outside the scroll box, clipped) stayed green.
  let depth = 0
  let bodyEnd = -1
  for (const m of dialog.slice(body).matchAll(/<div\b[^>]*?(\/?)>|<\/div>/g)) {
    if (m[0] === '</div>') depth--
    else if (m[1] !== '/') depth++
    if (depth === 0) { bodyEnd = body + m.index!; break }
  }
  // Encryption is not a tab any more: it moved to Manage session
  // (2026-10-05, checks/manageSession.check.ts).
  const tabs = ["{tab === 'server' &&", "{tab === 'features' &&"]
  check('every tab renders inside it -- after it opens and before it closes',
    bodyEnd > body && tabs.every((t) => dialog.indexOf(t) > body && dialog.indexOf(t) < bodyEnd), { body, bodyEnd, at: tabs.map((t) => dialog.indexOf(t)) })

  // The size is the base rule's ALONE. Any other rule, anywhere in the sheet
  // -- inside an @media block, on a [data-*] variant, in a selector list --
  // that sizes the box would make it change with the tab or the window.
  const sizing = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ sel: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: m[2], at: m.index! }))
    .filter((b) => b.sel.split(',').some((s) => /^\.tc-settings(?![\w-])/.test(s.trim())))
    .filter((b) => /(^|[\s;])(width|height|min-width|min-height|max-width|max-height|inline-size|block-size)\s*:/.test(b.body))
  check('exactly one rule sizes the dialog, and it is the base rule', sizing.length === 1 && sizing[0].sel === '.tc-settings', sizing.map((b) => b.sel))
  check('and nothing sizes it inline', !/className="tc-settings[^"]*"[^>]*style=\{\{[^}]*(width|height)/.test(dialog))
}

console.log('== L20 formant throughout')
{
  // Operator, 2026-09-30: "bring the entire settings menu into formant
  // compliance." Formant's rule: names, not values, cross a boundary -- a
  // colour is a --mod-* NAME, never the hex it holds today.
  //
  // Every rule whose selector names a piece of the dialog, or of the two
  // modals it opens, or of the pill and field it is built from.
  const SCOPE = /\.tc-(settings|perm|bulk|verify|reset|device|trust|tone|modal|picker|pill|input|prof|manage-session|token-life)\b/
  const blocks: { sel: string; body: string; line: number }[] = []
  {
    // Flat walk over the stylesheet: nested @media blocks keep their inner
    // rules' selectors, which is all this needs.
    const re = /([^{}]+)\{([^{}]*)\}/g
    for (const m of css.matchAll(re)) {
      const sel = m[1].trim().split('\n').filter((l) => !/^\s*(\/\*|\*)/.test(l)).join(' ').replace(/\/\*[\s\S]*?\*\//g, '').trim()
      blocks.push({ sel, body: m[2], line: css.slice(0, m.index).split('\n').length })
    }
  }
  const scoped = blocks.filter((b) => SCOPE.test(b.sel) && !/^:root$/.test(b.sel))
  check('the scope is found (not an empty pass)', scoped.length > 60, scoped.length)
  const bad = (re: RegExp) =>
    scoped.flatMap((b) => b.body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')
      .filter((decl) => re.test(decl)).map((decl) => `${b.line}: ${b.sel.slice(0, 50)} { ${decl.trim()} }`))
  const literals = bad(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/)
  check('no literal colour in any of them', literals.length === 0, literals)
  const fallbacks = bad(/var\(--[\w-]+,\s*(#|rgb|hsl|\d)/)
  check('no var() carrying a literal fallback -- a fallback is a copy of a value', fallbacks.length === 0, fallbacks)
  // The value, not the declaration: `border-radius:\s*(?!var\()` lets the
  // space before a var() satisfy the lookahead and passes everything.
  const radii = bad(/border-radius:/).filter((d) => !/border-radius:\s*(var\(|0\b|50%)/.test(d))
  check('every radius is a formant (or the pill\'s) radius', radii.length === 0, radii)
  const mono = bad(/font-family:[^;]*monospace/)
  check('monospace is --mod-mono', mono.length === 0, mono)
  const cpd = bad(/--cpd-/)
  check('no Compound names: formant names directly', cpd.length === 0, cpd)
  check('the two names that were defined nowhere are gone from it',
    !scoped.some((b) => /var\(--tc-(panel|line|mono)\b/.test(b.body.replace(/\/\*[\s\S]*?\*\//g, ''))))
  check('the box is formant surface, line, radius and lift',
    /background: var\(--mod-surface\);/.test(rules('.tc-settings')) && /border: 1px solid var\(--mod-line-strong\);/.test(rules('.tc-settings')) &&
    /border-radius: var\(--mod-radius\);/.test(rules('.tc-settings')) && /box-shadow: var\(--mod-raise-lift\);/.test(rules('.tc-settings')))
  check('tones are formant semantics: green ok, amber warn, the alarm\'s readable ink for bad, orange for work',
    /color: var\(--mod-ok-fg\)/.test(rules('.tc-tone-ok')) && /color: var\(--mod-warn-fg\)/.test(rules('.tc-tone-warn')) &&
    /color: var\(--mod-alarm-ink\)/.test(rules('.tc-tone-bad')) && /color: var\(--mod-active-fg\)/.test(rules('.tc-tone-active')))
  // A toned note must take the tone: the note rule sets a colour too, so the
  // tones have to come after it in the file.
  // A box fixed to the window must fit the window: border-box, so padding
  // and border are inside its width, and a width capped by 100vw. The
  // incoming-verification prompt was 340px content-box -- 370px on screen,
  // 28px off the left edge of a 360px phone.
  const fixedWide = scoped.filter((b) => /position:\s*fixed/.test(b.body) && /(^|[\s;])width:/.test(b.body))
  const unfit = fixedWide.filter((b) => !/box-sizing:\s*border-box/.test(b.body) || !/(^|[\s;])width:[^;]*100vw/.test(b.body)).map((b) => `${b.line}: ${b.sel}`)
  // (A selector here can carry the tail of the comment above it; its end is
  // the selector.)
  check('the fixed boxes are found', fixedWide.some((b) => b.sel.endsWith('.tc-verify--incoming')) && fixedWide.some((b) => /(^|\s)\.tc-settings$/.test(b.sel)), fixedWide.map((b) => b.sel.slice(-40)))
  check('every fixed box fits the window it is fixed to', unfit.length === 0, unfit)

  const note = css.indexOf('.tc-settings-note {')
  for (const tone of ['ok', 'warn', 'bad', 'active']) {
    const at = css.indexOf(`.tc-tone-${tone} {`)
    check(`a note toned ${tone} takes its tone (the tone rule comes after the note's)`, note > 0 && at > note, { note, at })
  }

  // The markup: no control drawn by the browser ("Windows 3.1", operator
  // 2026-09-25), and no colour written into an inline style.
  const FILES = ['src/ui/SettingsDialog.tsx', 'src/ui/EncryptionOptions.tsx', 'src/ui/ManageSession.tsx',
    'src/ui/ServerPermissions.tsx', 'src/ui/BulkLevels.tsx',
    'src/ui/CreateRoomDialog.tsx', 'src/ui/UserPicker.tsx', 'src/ui/IncomingVerification.tsx',
    // The Profile panel is the Settings box's sibling (L24) and held to it.
    'src/ui/ProfilePanel.tsx']
  for (const f of FILES) {
    const src = read(f)
    // A tag ends at a > that is not an arrow's: onChange={(e) => ...} would
    // otherwise end the tag at its first handler.
    const tags = [...src.matchAll(/<(button|input|select|textarea)\b([\s\S]*?)(?<!=)(\/>|>)/g)]
    const loose = tags.filter((m) => {
      const attrs = m[2]
      if (/type="checkbox"/.test(attrs)) return false
      if (m[1] === 'button' && /role="tab"/.test(attrs)) return false
      return !/className=|\{\.\.\.field\}/.test(attrs)
    }).map((m) => `${src.slice(0, m.index).split('\n').length}: <${m[1]}`)
    check(`${f}: every control wears a class`, loose.length === 0, loose)
    const inline = [...src.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|var\(--cpd-/g)].map((m) => `${src.slice(0, m.index).split('\n').length}: ${m[0]}`)
    check(`${f}: no literal colour or Compound name`, inline.length === 0, inline)
  }
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nsettings dialog: all checks passed')
