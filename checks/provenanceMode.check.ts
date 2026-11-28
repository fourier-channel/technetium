// Checks for provenance mode (tc.154; src/client/provenanceMode.ts, drawn by
// src/ui/ProvenanceLayer.tsx).
//
// Proven here, with no DOM: the mode exists on the preview host and dev only
// (P2), whatever a browser stored; the dwell setting's default, range and
// refusal of a broken stored value (P1); which key a hover and each widen
// pick; what the box says for a recorded, inferred and unrecorded element;
// that a bad highlight span marks nothing rather than the wrong words; and
// that a horizon link is the roadmap id verbatim (P8). On source: the layer
// is mounted, the settings block is shown, and the sheen animation ends.
//
// WHAT THIS CANNOT SEE: the box opening under a real pointer (the Firefox
// harness, tools/visual/provenance-react.html), or anything against the live
// preview site (operator verification).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  DWELL_DEFAULT_MS, DWELL_MAX_MS, DWELL_MIN_MS, PROVENANCE_HOST,
  clampDwell, highlightRuns, horizonHref, keyChain, parseDwell, pickKey,
  provenanceAvailable, provenanceFor, provenanceOn, validProvKey, validSpans,
  type ProvenanceMap,
} from '../src/client/provenanceMode.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const code = (path: string) =>
  readFileSync(join(root, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

console.log('provenance mode: where it exists (P2)')
check('the preview host offers it', provenanceAvailable(PROVENANCE_HOST, false))
check('the preview host is build.tc', PROVENANCE_HOST === 'build.tc.41chan.net')
check('production does not', !provenanceAvailable('tc.41chan.net', false))
for (const h of ['build.tc.41chan.net.evil.example', 'xbuild.tc.41chan.net', 'BUILD.TC.41CHAN.NET', '', null, undefined, 42]) {
  check(`host ${JSON.stringify(h)} does not`, !provenanceAvailable(h, false))
}
check('a dev server does, on any host', provenanceAvailable('127.0.0.1', true))
check('a truthy non-true dev flag does not', !provenanceAvailable('tc.41chan.net', 'true'))

console.log('provenance mode: the switch and the dwell (P1)')
check('only "1" is on', provenanceOn('1') && !provenanceOn('true') && !provenanceOn('01') && !provenanceOn('') && !provenanceOn(null))
check('default dwell is 800 ms', DWELL_DEFAULT_MS === 800 && parseDwell(null) === 800)
check('a stored dwell in range is kept', parseDwell('1200') === 1200 && parseDwell(String(DWELL_MIN_MS)) === DWELL_MIN_MS && parseDwell(String(DWELL_MAX_MS)) === DWELL_MAX_MS)
for (const raw of ['0', '50', '199', '5001', '99999', '-300', '1e3', '800.5', ' 800', 'abc', '']) {
  check(`a stored dwell ${JSON.stringify(raw)} falls back to the default`, parseDwell(raw) === DWELL_DEFAULT_MS, parseDwell(raw))
}
check('clamp rounds to the step', clampDwell(849) === 800 && clampDwell(851) === 900)
check('clamp holds the range', clampDwell(0) === DWELL_MIN_MS && clampDwell(1e9) === DWELL_MAX_MS && clampDwell(-5) === DWELL_MIN_MS)
check('clamp of NaN is the default', clampDwell(Number.NaN) === DWELL_DEFAULT_MS && clampDwell(Infinity) === DWELL_DEFAULT_MS)
// Every value the setting can hold round-trips through storage unchanged.
let roundTrip = true
for (let n = DWELL_MIN_MS; n <= DWELL_MAX_MS; n += 100) if (parseDwell(String(clampDwell(n))) !== n) roundTrip = false
check('every slider value survives storage', roundTrip)

console.log('provenance mode: which element')
check('a dotted key is valid', validProvKey('room-list.row') && validProvKey('ticker'))
for (const k of ['Ticker', '1room', 'room..row', 'room.', '.room', 'room list', 'a'.repeat(65), '', null, 7]) {
  check(`key ${JSON.stringify(k)} is refused`, !validProvKey(k))
}
check('the chain skips missing and invalid keys', JSON.stringify(keyChain(['row', null, 'Bad Key', 'room-list'])) === '["row","room-list"]')
check('the innermost wins with no widen', pickKey(['row', 'room-list'], 0)?.key === 'row')
check('one widen steps one out', pickKey(['row', 'room-list'], 1)?.key === 'room-list')
check('widening stops at the outermost', pickKey(['row', 'room-list'], 9)?.depth === 1)
check('a negative or fractional widen is clamped', pickKey(['a', 'b'], -3)?.depth === 0 && pickKey(['a', 'b'], 0.9)?.depth === 0)
check('no keys, no pick', pickKey([], 0) === null)

console.log('provenance mode: what the box says')
const map: ProvenanceMap = {
  ticker: {
    origin: { id: 'tc.155', date: '2026-11-27', text: 'A goal ticker' },
    decisions: [
      { id: 'tc.160', date: '2026-11-28', text: 'later' },
      { id: 'tc.159', date: '2026-11-01', text: 'earlier' },
    ],
    fixes: [
      { id: 'tc.170', date: '2026-10-01', text: 'old fix', bug: 'bug-a' },
      { id: 'tc.171', date: '2026-11-20', text: 'new fix', bug: 'bug-b' },
    ],
    description: 'The strip. It crawls. It is above the chat box.',
  },
  'ticker.item': { inheritsFrom: 'ticker', highlight: [[11, 21]] },
  'ticker.orphan': { inheritsFrom: 'nowhere' },
}
const rec = provenanceFor(map, 'ticker')
check('a recorded element is recorded', rec.kind === 'recorded')
if (rec.kind === 'recorded') {
  check('decisions oldest first', rec.decisions.map((l) => l.text).join() === 'earlier,later')
  check('fixes newest first', rec.fixes.map((l) => l.text).join() === 'new fix,old fix')
  check('the bug id is carried (P7)', rec.fixes[0].bug === 'bug-b')
  check('the origin is carried', rec.origin?.id === 'tc.155')
}
const inf = provenanceFor(map, 'ticker.item')
check('an element with no row of its own is an inference', inf.kind === 'inferred' && inf.from === 'ticker')
if (inf.kind === 'inferred') {
  const marked = highlightRuns(inf.description, inf.highlight).filter((r) => r.mark).map((r) => r.text)
  check('the inference marks the sentence named', JSON.stringify(marked) === '["It crawls."]', marked)
}
check('an inheritance from a missing piece is nothing', provenanceFor(map, 'ticker.orphan').kind === 'none')
const none = provenanceFor(map, 'composer')
check('an unrecorded element says so', none.kind === 'none' && !none.mapEmpty)
const empty = provenanceFor({}, 'composer')
check('an empty map says the map is empty', empty.kind === 'none' && empty.mapEmpty)
check('a key named like an Object builtin is nothing', provenanceFor(map, 'constructor').kind === 'none' && provenanceFor(map, '__proto__').kind === 'none')

console.log('provenance mode: highlight spans')
check('good spans pass', JSON.stringify(validSpans([[0, 2], [3, 5]], 10)) === '[[0,2],[3,5]]')
check('an overlap is dropped', JSON.stringify(validSpans([[0, 4], [3, 5]], 10)) === '[[0,4]]')
check('an out-of-order span is dropped', JSON.stringify(validSpans([[5, 6], [1, 2]], 10)) === '[[5,6]]')
check('an empty, reversed, past-the-end or fractional span is dropped',
  validSpans([[2, 2], [4, 3], [8, 11], [1.5, 3], [-1, 1]], 10).length === 0)
const runs = highlightRuns('abcdefghij', [[2, 4], [6, 7]])
check('runs rebuild the text exactly', runs.map((r) => r.text).join('') === 'abcdefghij')
check('runs alternate as cut', runs.map((r) => (r.mark ? 'M' : 'p') + r.text).join('|') === 'pab|Mcd|pef|Mg|phij')
check('no spans is one plain run', JSON.stringify(highlightRuns('abc', [])) === '[{"text":"abc","mark":false}]')

console.log('provenance mode: horizon links (P8)')
check('a roadmap id anchors verbatim', horizonHref('tc.154') === 'https://41chan.net/horizon/#tc.154')
for (const id of ['TC.154', 'tc-154', 'tc.154a', 'tc.', '.154', 'tc.154#x', 'javascript:alert(1)', '']) {
  check(`id ${JSON.stringify(id)} gets no link`, horizonHref(id) === null)
}

console.log('provenance mode: on source')
const app = code('src/App.tsx')
check('App mounts the layer', /<ProvenanceLayer\s*\/>/.test(app))
check('the settings tab shows the block', /<ProvenanceSettings\s*\/>/.test(code('src/ui/SettingsDialog.tsx')))
const layer = code('src/ui/ProvenanceLayer.tsx')
check('the layer renders nothing unless available and on', /if \(!prov\.available \|\| !prov\.on\) return null/.test(layer))
check('the settings block renders nothing unless available', /if \(!prov\.available\) return null/.test(code('src/ui/ProvenanceSettings.tsx')))
check('the stored switch is read only where the host allows', /if \(!AVAILABLE\) return \{ available: false, on: false/.test(code('src/ui/provenancePref.ts')))
const css = code('src/ui/provenance.css')
const sheenAnims = [...css.matchAll(/animation:\s*tc-prov-sheen[^;]*;/g)].map((m) => m[0])
check('the sheen runs once', sheenAnims.length > 0 && sheenAnims.every((a) => !/infinite/.test(a)), sheenAnims)
check('done is orange, in progress green (formant activity rule)',
  /\[data-prov-goal="done"\][\s\S]*?--mod-active-fg/.test(css) && /\[data-prov-goal="active"\][\s\S]*?--mod-ok-fg/.test(css))
for (const [file, key] of [['src/ui/Ticker.tsx', 'ticker'], ['src/ui/NavTree.tsx', 'room-list'], ['src/ui/DmList.tsx', 'dm-strip'], ['src/ui/Composer.tsx', 'composer']]) {
  check(`${file} carries data-prov="${key}"`, code(file).includes(`data-prov="${key}"`))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
