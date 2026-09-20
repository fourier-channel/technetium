// An INFINITE animation may touch transform and opacity, and nothing else.
//
// Org rule, paid for in fourier-sampling and recorded as
// infinite-animations-cost-a-core: its curation surface idled at 45% of a core
// per open tab -- a full style recalc and a layout on EVERY frame -- and the
// whole of it was one `infinite` animation of box-shadow on the health lamps.
// box-shadow is a paint property: it cannot be composited, so every frame is
// main-thread work for as long as the page is open. The same halo drawn as a
// static box-shadow on a pseudo-element whose OPACITY animates measured 5%.
//
// transform and opacity are the two properties a compositor can run without
// touching layout or paint. A FINITE animation may animate anything, because
// its cost is bounded by its duration -- which is why the bubble animators are
// allowed to move clip-path and background.
//
// Why a check and not a habit: the sampling incident hid for months because the
// animation only ran while a lamp was RED. The expensive state is the rare one,
// so nobody measures it, and a census of what is animating on a good day finds
// nothing. Reading the stylesheet finds it whether or not it is on screen.
//
// The parsing here is deliberately crude -- regex over the sources rather than
// a CSS parser -- and it is crude in the SAFE direction: it collects every
// @keyframes block it can see and every declaration mentioning `infinite`, and
// anything it cannot resolve is reported rather than skipped. A rule that
// silently covers less than it appears to is rule 1 of the doctrine violated by
// the tool meant to enforce it.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// The two a compositor can run on its own.
const COMPOSITABLE = new Set(['transform', 'opacity'])

// The named deviations, each with the reason it is one.
//
// An allowlist weakens a rule unless it is itself checked, so this one is: an
// entry that no longer corresponds to a real violation FAILS, which is what
// stops the list outliving the thing it excuses. The bar for adding an entry is
// not "this was hard to fix" -- it is that the animation's exposure is bounded
// by something other than the page being open, and the entry says by what.
const EXEMPT: Record<string, string> = {
  'uitransform-ants':
    'Marching ants on a selection outline: stroke-dashoffset is the only way to '
    + 'make a dash pattern travel along a path, and there is no transform or '
    + 'opacity equivalent. Bounded by the user being INSIDE the layout editor '
    + 'with something selected -- it does not exist on the ordinary surface, '
    + 'which is what the rule is about. One small SVG rect.',
}

// Declarations that are not animated properties: they steer the animation
// itself, or they are the custom properties a keyframe reads.
const IGNORED = (prop: string) => prop.startsWith('--') || prop === 'animation-timing-function'

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.(css|tsx|ts)$/.test(name)) out.push(p)
  }
  return out
}

const files = sources('src')
const text = new Map<string, string>()
for (const f of files) {
  // `${...}` inside a CSS-in-JS template puts braces in the middle of a
  // declaration, which no brace-counting matcher can nest through -- it is
  // what made @keyframes uitransform-ants invisible on the first run. The
  // value is never a property name, so blanking it loses nothing.
  text.set(f, readFileSync(f, 'utf8').replace(/\$\{[^{}]*\}/g, '0'))
}

// --- every @keyframes block anywhere in the tree --------------------------
interface Frames { name: string; file: string; props: Set<string> }
const frames = new Map<string, Frames>()
const dupes: string[] = []

for (const [file, src] of text) {
  // Non-greedy to the matching close of the LAST inner block. Keyframes are
  // one level deep (percent selectors), so counting one nesting level is
  // enough and is what keeps this from needing a parser.
  const re = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const name = m[1]
    // Comments are not declarations here either. Found by a keyframes block
    // whose comment read "Rotation only: the gradient ..." -- the colon made
    // `only` a property and the swirl was reported as animating it.
    const body = uncomment(m[2])
    const props = new Set<string>()
    const pre = /(^|[{;\s])([a-zA-Z-]+)\s*:/g
    let p: RegExpExecArray | null
    while ((p = pre.exec(body)) !== null) {
      const prop = p[2].toLowerCase()
      if (!IGNORED(prop)) props.add(prop)
    }
    if (frames.has(name)) dupes.push(name)
    frames.set(name, { name, file, props })
  }
}

// --- every place something is asked to run forever ------------------------
interface Use { name: string; file: string; line: number; snippet: string }
const infinite: Use[] = []
const unresolved: { file: string; line: number; snippet: string }[] = []

// Comments talk ABOUT the rule, at length, and a line of prose is not a
// declaration. Block comments are blanked ACROSS lines (newlines kept, so the
// reported line numbers still point at the source) rather than per line, which
// was the first version and read the middle of every paragraph as code.
function uncomment(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
}

for (const [file, src] of text) {
  const lines = uncomment(src).split('\n')
  lines.forEach((line, i) => {
    const stripped = line
    if (!/\binfinite\b/.test(stripped)) return
    // Which keyframes does this line name? Cross-file, because a component's
    // <style> block can drive a class defined in index.css and the reverse.
    const named = [...frames.keys()].filter((n) => new RegExp(`\\b${n}\\b`).test(stripped))
    if (named.length === 0) {
      unresolved.push({ file, line: i + 1, snippet: stripped.trim().slice(0, 100) })
      return
    }
    for (const n of named) infinite.push({ name: n, file, line: i + 1, snippet: stripped.trim().slice(0, 100) })
  })
}

console.log('\n-- the sources parsed at all --')
{
  check('there are stylesheets and components to read', files.length > 10, files.length)
  check('keyframes were found', frames.size > 10, frames.size)
  check('at least one infinite animation was found -- a parser that finds none proves nothing',
    infinite.length > 0, infinite.length)
  // A keyframes name defined twice means one of the two definitions is not the
  // one running, and this check would then be reading the wrong body.
  check('no keyframes name is defined twice', dupes.length === 0, dupes)
}

console.log('\n-- every infinite animation resolves to keyframes --')
{
  // An `infinite` this cannot tie to a keyframes block is NOT a pass. It is a
  // hole in the check, reported as one.
  check('no unresolved `infinite` declaration', unresolved.length === 0, unresolved)
}

console.log('\n-- an infinite animation touches transform and opacity only --')
const violating = new Set<string>()
{
  for (const use of infinite) {
    const f = frames.get(use.name)
    if (!f) continue
    const bad = [...f.props].filter((p) => !COMPOSITABLE.has(p))
    if (bad.length > 0) violating.add(use.name)
    if (EXEMPT[use.name]) {
      console.log(`  --   ${use.name} (${use.file}:${use.line}) EXEMPT: ${EXEMPT[use.name]}`)
      continue
    }
    check(
      `${use.name} (${use.file}:${use.line})`,
      bad.length === 0,
      bad.length ? `animates ${bad.join(', ')} -- see infinite-animations-cost-a-core` : '',
    )
  }
}

console.log('\n-- the exemptions are still real --')
{
  // A stale exemption is worse than no exemption: it reads as a known cost
  // that somebody weighed, when the thing it excuses may have been rewritten
  // or deleted years ago.
  for (const [name, why] of Object.entries(EXEMPT)) {
    check(`${name} is still an infinite animation that needs excusing`,
      violating.has(name),
      violating.has(name) ? '' : `no longer violates -- delete the entry. Reason on file: ${why}`)
  }
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
