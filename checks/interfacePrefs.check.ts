// The interface options' stored shape (INTERFACE_OPTIONS IO7-IO11,
// client/interfacePrefs.ts).
//
// The stored event is written by other clients too and reaches CSS, so the
// claims that matter are: only the exact shapes this client writes are
// admitted (one bad field makes the whole value unreadable, never half-read);
// what is written round-trips and says nothing that is a default, so a reset
// is a removal; and the custom properties are built from admitted values
// only, with every one of them in the list App clears.
import {
  DEFAULT_PREFS,
  INTERFACE_VAR_NAMES,
  SPACING_DEFAULT,
  SPACING_MAX,
  SPACING_MIN,
  TONES,
  TONE_ALPHA,
  TONE_DEFAULT_HEX,
  clampSpacing,
  interfaceVars,
  normalizeHex,
  parseInterfacePrefs,
  samePrefs,
  serializeInterfacePrefs,
  shownTone,
  type InterfacePrefs,
} from '../src/client/interfacePrefs.ts'
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('== parse: only what this client writes')
check('an empty object is the defaults', samePrefs(parseInterfacePrefs({})!, DEFAULT_PREFS))
check('a full value is read', (() => {
  const p = parseInterfacePrefs({ mode: 'irc', styled: false, spacing: 3, colors: { yelling: '#ff0000', thinking: '#00ff00' } })
  return !!p && p.mode === 'irc' && !p.styled && p.spacing === 3 && p.colors.yelling === '#ff0000' && p.colors.thinking === '#00ff00'
})())
const refused: [string, unknown][] = [
  ['not an object', 'irc'],
  ['an array', []],
  ['null', null],
  ['an unknown mode', { mode: 'compact' }],
  ['a styled that is not a boolean', { styled: 'yes' }],
  ['a fractional spacing', { spacing: 4.5 }],
  ['a spacing below range', { spacing: SPACING_MIN - 1 }],
  ['a spacing above range', { spacing: SPACING_MAX + 1 }],
  ['a spacing as a string', { spacing: '8' }],
  ['colours as an array', { colors: ['#ffffff'] }],
  ['a colour for an unknown tone', { colors: { shouting: '#ffffff' } }],
  ['a short hex', { colors: { yelling: '#fff' } }],
  ['an upper-case hex', { colors: { yelling: '#FFFFFF' } }],
  ['a named colour', { colors: { yelling: 'red' } }],
  ['a CSS expression', { colors: { yelling: 'red; background: url(x)' } }],
  ['a var()', { colors: { yelling: 'var(--x)' } }],
  ['a hex with a tail', { colors: { yelling: '#ffffff;' } }],
  ['a prototype key', JSON.parse('{"colors": {"__proto__": "#ffffff"}}')],
]
for (const [what, content] of refused) check(`refused whole: ${what}`, parseInterfacePrefs(content) === null, content)
check('an unknown extra field is ignored, not refused (a later client may add one)',
  parseInterfacePrefs({ futureThing: 1, spacing: 2 })?.spacing === 2)

console.log('== serialize: only what differs, and it round-trips')
check('the defaults write nothing, so a reset is a removal', Object.keys(serializeInterfacePrefs(DEFAULT_PREFS)).length === 0)
{
  const samples: InterfacePrefs[] = []
  for (const mode of ['bubbles', 'irc'] as const)
    for (const styled of [true, false])
      for (const spacing of [SPACING_MIN, SPACING_DEFAULT, 13, SPACING_MAX])
        for (const k of [0, 1, 4]) {
          const colors: InterfacePrefs['colors'] = {}
          TONES.slice(0, k).forEach((t, i) => { colors[t] = `#${(0x102030 * (i + 1)).toString(16).padStart(6, '0')}` })
          samples.push({ mode, styled, spacing, colors })
        }
  const bad = samples.filter((p) => {
    const back = parseInterfacePrefs(JSON.parse(JSON.stringify(serializeInterfacePrefs(p))))
    return !back || !samePrefs(back, p)
  })
  check(`every one of ${samples.length} values survives a write and a read`, bad.length === 0, bad[0])
  check('a default field is never written', samples.every((p) => {
    const s = serializeInterfacePrefs(p)
    return (p.mode === DEFAULT_PREFS.mode) === !('mode' in s) &&
      (p.styled === DEFAULT_PREFS.styled) === !('styled' in s) &&
      (p.spacing === DEFAULT_PREFS.spacing) === !('spacing' in s)
  }))
}
check('samePrefs treats a missing colour and no colour alike, and a different one as different',
  samePrefs({ ...DEFAULT_PREFS, colors: {} }, DEFAULT_PREFS) &&
  !samePrefs({ ...DEFAULT_PREFS, colors: { standard: '#000000' } }, DEFAULT_PREFS))

console.log('== the picker and the slider')
check('the picker\'s colour is admitted, lower-cased', normalizeHex(' #A0B1C2 ') === '#a0b1c2')
check('anything else is not', [ '#abc', 'abcdef', '#abcdefg', '', 'rgb(1,2,3)' ].every((v) => normalizeHex(v) === null))
check('the slider is clamped to whole pixels in range',
  clampSpacing(-5) === SPACING_MIN && clampSpacing(99) === SPACING_MAX && clampSpacing(7.6) === 8 && clampSpacing(NaN) === SPACING_DEFAULT)
check('every default colour is one the parser admits',
  TONES.every((t) => parseInterfacePrefs({ colors: { [t]: TONE_DEFAULT_HEX[t] } }) !== null))

console.log('== the custom properties')
check('the defaults set only the gap', (() => {
  const v = interfaceVars(DEFAULT_PREFS)
  return Object.keys(v).length === 1 && v['--tc-row-gap'] === `${SPACING_DEFAULT}px`
})())
{
  const all: InterfacePrefs = { ...DEFAULT_PREFS, colors: Object.fromEntries(TONES.map((t) => [t, '#0a141e'])) }
  const v = interfaceVars(all)
  check('every property it can set is in the list App clears', Object.keys(v).every((k) => INTERFACE_VAR_NAMES.includes(k)), Object.keys(v))
  check('and every listed property is one it can set', INTERFACE_VAR_NAMES.every((k) => k in v))
  check('a picked colour is drawn at that tone\'s own strengths',
    TONES.every((t) => v[`--tc-user-${t}-bg`] === `rgba(10, 20, 30, ${TONE_ALPHA[t].bg})` &&
      v[`--tc-user-${t}-line`] === `rgba(10, 20, 30, ${TONE_ALPHA[t].line})`))
  check('every value is numbers in a fixed frame', Object.values(v).every((s) => /^(\d+px|rgba?\(\d+, \d+, \d+(, [\d.]+)?\))$/.test(s)), v)
  const forged = { ...DEFAULT_PREFS, colors: { yelling: 'red; x: y' } } as InterfacePrefs
  check('a colour that skipped the parser still never reaches CSS', !('--tc-user-yelling-bg' in interfaceVars(forged)))
}

console.log('== the stylesheet\'s defaults are the picker\'s defaults (D-tc01)')
{
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  const block = css.match(/:root \{\s*\/\* The bubble colours each tone is drawn in[\s\S]*?\n\}/)?.[0] ?? ''
  const declared = new Map([...block.matchAll(/(--tc-user-[a-z-]+): ([^;]+);/g)].map((m) => [m[1], m[2]]))
  const colourNames = INTERFACE_VAR_NAMES.filter((n) => n !== '--tc-row-gap')
  check('every colour property App can set has a default in the stylesheet, and no other',
    declared.size === colourNames.length && colourNames.every((n) => declared.has(n)), [...declared.keys()])
  // A tone whose default fill is a plain rgba: picking its default hex draws
  // exactly what is there before anything is picked. (Plain's fill follows
  // the theme's own subtle colour, with this hex as the theme-less fallback.)
  const bad = TONES.filter((t) => {
    const name = `--tc-user-${t}-bg`
    const want = interfaceVars({ ...DEFAULT_PREFS, colors: { [t]: TONE_DEFAULT_HEX[t] } })[name]
    const got = declared.get(name) ?? ''
    return !(got === want || got.endsWith(`, ${want})`))
  })
  check('the picker opens on the colour each tone is already drawn in', bad.length === 0, bad)
}

console.log('== styled off')
check('every tone is drawn plain when styles are off, and nothing is invented for a line with none',
  TONES.every((t) => shownTone(t, { ...DEFAULT_PREFS, styled: false }) === 'standard' && shownTone(t, DEFAULT_PREFS) === t) &&
  shownTone(null, DEFAULT_PREFS) === null)

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\ninterface prefs: all checks passed')
