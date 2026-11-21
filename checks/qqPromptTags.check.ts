// QuickQueue's prompt parser (src/qq/promptTags.ts) is a port of
// fourier-tunnel's prompt-tags.js, and the tags a user searches their library
// by must be the tags the booru reads from the same file. So this check holds
// the port to the ORIGINAL'S OWN OUTPUT: qqPromptTags.expected.json is what
// prompt-tags.js returned for every fixture in qqPromptTags.fixtures.ts, and
// any difference is a failure, whichever side looks more right. A rule change
// is made in the original first; then the fixtures are re-run through it.
//
// The fixtures are synthetic. How the two parsers agree on a real library is
// measured separately (canon's parity tool, counts only).
import { readFileSync } from 'node:fs'
import {
  embeddedChunks, expandTerm, extractPromptTags, normalizeTerm, promptToTags, rawPrompt, QUALITY_META,
} from '../src/qq/promptTags.ts'
import { FIXTURES, PROMPTS, TERMS } from './qqPromptTags.fixtures.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

interface Expected {
  files: Record<string, { keys: string[]; raw: string; tags: unknown }>
  terms: Record<string, { norm: string; expand: string[] }>
  prompts: unknown[]
}
const want = JSON.parse(readFileSync(new URL('./qqPromptTags.expected.json', import.meta.url), 'utf8')) as Expected

console.log('== every fixture has a recorded answer, and only those')
check('the fixture names and the recorded names are the same set',
  same(FIXTURES.map((f) => f.name).sort(), Object.keys(want.files).sort()))
check('the terms are the same set', same([...TERMS].sort(), Object.keys(want.terms).sort()))
check('the prompts are the same count', PROMPTS.length === want.prompts.length)

console.log('== files: the chunks found, the prompt, the tags')
for (const f of FIXTURES) {
  const w = want.files[f.name]
  if (!w) continue
  const chunks = await embeddedChunks(await f.bytes())
  check(`${f.name}: keys in order`, same(Object.keys(chunks), w.keys), [Object.keys(chunks), w.keys])
  const raw = rawPrompt(chunks)
  check(`${f.name}: prompt`, raw === w.raw, [raw, w.raw])
  check(`${f.name}: tags`, same(promptToTags(raw), w.tags), [promptToTags(raw), w.tags])
}

console.log('== terms')
for (const t of TERMS) {
  const w = want.terms[t]
  if (!w) continue
  check(`${JSON.stringify(t)} normalises as the original`, normalizeTerm(t) === w.norm, [normalizeTerm(t), w.norm])
  check(`${JSON.stringify(t)} splits as the original`, same(expandTerm(t), w.expand), [expandTerm(t), w.expand])
}

console.log('== prompts, with max and owner')
PROMPTS.forEach((p, k) => {
  const got = promptToTags(p.prompt, p.opts)
  check(`prompt ${k} (${JSON.stringify(p.opts ?? {})})`, same(got, want.prompts[k]), [got, want.prompts[k]])
})

console.log('== standing rules the original guards')
for (const word of ['photorealistic', 'realistic', 'photorealism', 'photo_(medium)']) {
  check(`${word} is never a quality term (operator 2026-11-01)`, !QUALITY_META.has(word))
}

console.log('== fail soft')
const empty = { tags: [], meta: [], characters: [] }
for (const [name, bytes] of [
  ['empty', new Uint8Array(0)],
  ['png signature alone', Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0)],
  ['png chunk claiming 4 GB', Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 255, 255, 255, 255, 116, 69, 88, 116)],
  ['jpeg markers only', Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0, 1, 0, 0, 0, 0, 0, 0)],
  ['riff webp, chunk past the end', Uint8Array.of(82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 69, 88, 73, 70, 255, 0, 0, 0)],
] as [string, Uint8Array][]) {
  let got: unknown
  try { got = await extractPromptTags(bytes) } catch (e) { got = e }
  check(`${name}: no tags, no throw`, same(got, empty), got)
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall ok')
