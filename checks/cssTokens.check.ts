// Every --tc-* and --mod-* custom property the tree READS is defined somewhere.
//
// An undefined custom property is silent. `var(--tc-line, rgb(255 255 255 /
// 10%))` with no --tc-line anywhere renders its fallback, the page looks
// roughly right, and nothing in the console says so. That is how the thread
// cards, the DM notice and the layout editor drew a cool white hairline and a
// private mono stack against formant's warm ramp for weeks, and how Settings
// drew a #14171c panel before L21 (devlog 2026-09-30, draft-16). A fallback is
// not a definition; it is the thing that hides a missing one.
//
// What this proves: each name read by var(), or by getPropertyValue(), has at
// least one definition in the tree -- a declaration in a stylesheet or a
// CSS-in-JS template, a style-object key, or a setProperty() call. It does NOT
// prove the definition's selector reaches the element that reads it; a token
// defined only under .tc-settings and read outside it passes. Scope is a
// rendering fact, and tools/visual/render.sh is where it is seen.
//
// Crude on purpose, in the safe direction: regex over the sources, and a
// string that merely names a token (a getPropertyValue argument) counts as a
// READ, never as a definition.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const TOKEN = '--(?:tc|mod)-[a-z0-9-]+'

function reads(src: string): Set<string> {
  const out = new Set<string>()
  for (const m of src.matchAll(new RegExp(`var\\(\\s*(${TOKEN})`, 'g'))) out.add(m[1])
  for (const m of src.matchAll(new RegExp(`getPropertyValue\\(\\s*['"\`](${TOKEN})['"\`]`, 'g'))) out.add(m[1])
  return out
}

function definitions(src: string): Set<string> {
  const out = new Set<string>()
  // A declaration: `--x:` at the start of a declaration, in a stylesheet or a
  // template literal. The lookbehind keeps `var(--x)` and `'--x'` out.
  for (const m of src.matchAll(new RegExp(`(?<![\\w(\\-'"\`])(${TOKEN})\\s*:`, 'g'))) out.add(m[1])
  // A style-object key: `'--x': value`.
  for (const m of src.matchAll(new RegExp(`['"\`](${TOKEN})['"\`]\\s*:`, 'g'))) out.add(m[1])
  // An imperative write.
  for (const m of src.matchAll(new RegExp(`setProperty\\(\\s*['"\`](${TOKEN})['"\`]`, 'g'))) out.add(m[1])
  return out
}

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.(css|tsx|ts|js)$/.test(name)) out.push(p)
  }
  return out
}

// Comments name tokens in prose ("--tc-line is ...") and must not define them.
const uncommented = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// --- the scanner sees what it claims to see -------------------------------
{
  const css = `.a { color: var(--tc-ghost, #fff); border: 1px solid var(--mod-line); }
:root { --mod-line: #333; }`
  check('scanner: a read with a fallback is still a read', reads(css).has('--tc-ghost'))
  check('scanner: a fallback is not a definition', !definitions(css).has('--tc-ghost'))
  check('scanner: a :root declaration is a definition', definitions(css).has('--mod-line'))
  const tsx = `style={{ '--tc-q-spin': '3deg', color: 'var(--tc-ink)' }}
el.style.setProperty('--tc-ticker-ms', '9ms')
getComputedStyle(el).getPropertyValue('--mod-hype-grace')`
  check('scanner: a style-object key is a definition', definitions(tsx).has('--tc-q-spin'))
  check('scanner: setProperty is a definition', definitions(tsx).has('--tc-ticker-ms'))
  check('scanner: getPropertyValue is a read, not a definition',
    reads(tsx).has('--mod-hype-grace') && !definitions(tsx).has('--mod-hype-grace'))
  check('scanner: a var() in a string is a read, not a definition',
    reads(tsx).has('--tc-ink') && !definitions(tsx).has('--tc-ink'))
  check('scanner: prose in a comment defines nothing',
    !definitions(uncommented('/* --tc-line: the hairline */\n// --tc-mono: a stack\n')).size)
}

// --- the tree -------------------------------------------------------------
const files = sources('src')
const read = new Map<string, string[]>()
const defined = new Set<string>()
for (const f of files) {
  const s = uncommented(readFileSync(f, 'utf8'))
  for (const t of reads(s)) read.set(t, [...(read.get(t) ?? []), f])
  for (const t of definitions(s)) defined.add(t)
}

// Not vacuous: the scan found the tree's tokens at all, and the two this check
// was written for.
check('tree: the scan sees reads and definitions', read.size > 40 && defined.size > 100, { reads: read.size, defined: defined.size })
check('tree: --tc-line and --tc-mono are read and defined',
  read.has('--tc-line') && read.has('--tc-mono') && defined.has('--tc-line') && defined.has('--tc-mono'))

const missing = [...read.entries()].filter(([t]) => !defined.has(t))
check('tree: every --tc-*/--mod-* token read is defined somewhere',
  missing.length === 0,
  missing.map(([t, fs]) => `${t} (read in ${[...new Set(fs)].join(', ')})`).join('; '))

if (failures) {
  console.log(`\n${failures} failure(s)`)
  process.exit(1)
}
