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
// The scanner -- which sources, which keyframes, which lines run forever -- is
// checks/_cssAnim.ts, shared with reducedMotionAudit.check.ts.
import { readSources, scanInfinite, scanKeyframes } from './_cssAnim.ts'

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

const text = readSources('src')
const files = [...text.keys()]
const { frames, dupes } = scanKeyframes(text)
const { infinite, unresolved } = scanInfinite(text, frames)

// The scanner on sources made for it: on a clean tree its failure paths never
// run, so a scanner that stopped reporting dupes or unresolved lines would
// still pass every check below (found by mutation, tc.113).
console.log('\n-- the scanner, on made-up sources --')
{
  const t = new Map([
    ['a.css', '@keyframes k { to { transform: none; } }\n@keyframes k { to { opacity: 0; } }\n.x { animation: nosuch 1s infinite; }'],
    ['b.tsx', '// animation: k 1s infinite\nconst u = { animation: `k 0ms infinite` }'],
  ])
  const sk = scanKeyframes(t)
  check('a name defined twice is reported', sk.dupes.join() === 'k', sk.dupes)
  const si = scanInfinite(t, sk.frames)
  check('an infinite naming no keyframes is unresolved, not skipped',
    si.unresolved.length === 1 && si.unresolved[0].file === 'a.css', si.unresolved)
  check('a commented-out infinite is not a use; a template one is',
    si.infinite.length === 1 && si.infinite[0].file === 'b.tsx' && si.infinite[0].line === 2, si.infinite)
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
