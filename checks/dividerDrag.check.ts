// Dragging a divider (launch-polish L29).
//
// Operator, 2026-10-08: "the grab-and-drag bars between panels are kinda
// janky, it looks like all the dynamic resizing from the profile/settings/etc
// buttons." Three causes, each held here:
//   1. a drag was a stream of deltas, and a delta the model refused at a wall
//      was lost -- the divider and the pointer came apart;
//   2. the panels that come and go eased their size on every drag step;
//   3. the name card's four pills went from one row to two at 300px, so the
//      room list jumped whenever its wall crossed that width.
import { readFileSync } from 'node:fs'
import { defaultSpace, dragEdgeTo, edgeAt, pushEdge, type Space } from '../src/ui/space.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

console.log('\n-- a drag is a target, not a stream of steps --')
{
  // The member list's wall, dragged hard right into its minimum and back.
  const s0: Space = defaultSpace()
  const start = edgeAt(s0, 'members', 'x', 'lo')
  const path = [0.02, 0.1, 0.3, 0.5, 0.3, 0.1, 0.02] // pointer travel from pointerdown, as fractions
  // The old gesture: each move pushes by that move's delta.
  let old = s0
  let last = 0
  for (const p of path) { old = pushEdge(old, 'members', 'x', 'lo', p - last); last = p }
  // The new one: each move asks for start + travel.
  let now = s0
  for (const p of path) now = dragEdgeTo(now, 'members', 'x', 'lo', start + p)
  const wall = (() => { let w = s0; w = dragEdgeTo(w, 'members', 'x', 'lo', 2); return edgeAt(w, 'members', 'x', 'lo') })()
  check('the wall exists inside the path (the drag really is refused part of the way)', wall < start + 0.5, { start, wall })
  check('back at +0.02, the new drag puts the divider exactly under the pointer',
    near(edgeAt(now, 'members', 'x', 'lo'), start + 0.02), edgeAt(now, 'members', 'x', 'lo'))
  check('the old drag left it a wall away from the pointer (the bug, reproduced)',
    !near(edgeAt(old, 'members', 'x', 'lo'), start + 0.02), edgeAt(old, 'members', 'x', 'lo'))
  // Mid-drag the layout can change under the hand (an account-data echo, a
  // reflow): the target still wins.
  let moved = pushEdge(s0, 'members', 'x', 'lo', -0.05)
  moved = dragEdgeTo(moved, 'members', 'x', 'lo', start + 0.03)
  check('a change under the hand mid-drag does not offset the divider from the pointer',
    near(edgeAt(moved, 'members', 'x', 'lo'), start + 0.03))
  check('a closed panel ignores a drag', dragEdgeTo({ ...s0, leaves: { ...s0.leaves, domain: { ...s0.leaves.domain, open: false } } }, 'domain', 'x', 'lo', 0.5).leaves.domain.open === false)
}

console.log('\n-- one gesture for every divider --')
{
  const app = readFileSync('src/App.tsx', 'utf8')
  const dock = readFileSync('src/ui/DmDock.tsx', 'utf8')
  const sidebar = readFileSync('src/ui/Sidebar.tsx', 'utf8')
  const handle = readFileSync('src/ui/ResizeHandle.tsx', 'utf8')
  const drag = readFileSync('src/ui/edgeDrag.ts', 'utf8')
  check('no divider pushes deltas any more', !/onDrag=/.test(app + dock) && !/pushEdge\('sidebar', 'x', 'hi', dx/.test(sidebar))
  check('every ResizeHandle names its edge',
    (app.match(/<ResizeHandle\s+edge=\{\{/g) ?? []).length === 3 && /<ResizeHandle\s+edge=\{\{ id: 'dock'/.test(dock))
  check('the room list\'s own grip uses the same gesture', /useEdgeDrag\(\{ id: 'sidebar', axis: 'x', side: 'hi' \}, !panelLocked\)/.test(sidebar))
  check('ResizeHandle is the gesture and nothing of its own', /useEdgeDrag\(edge\)/.test(handle) && !/onPointerMove=/.test(handle))
  check('the gesture asks for start + travel', /dragEdgeTo\(edge\.id, edge\.axis, edge\.side, s\.at \+ \(pointerOf\(e\) - s\.pointer\) \/ s\.extent\)/.test(drag))
  check('and marks the root while held, clearing it however the drag ends',
    /dataset\[ATTR\] = axis/.test(drag) && /onPointerUp: finish/.test(drag) && /onPointerCancel: finish/.test(drag) && /onLostPointerCapture: finish/.test(drag))
}

console.log('\n-- nothing eases while a divider is held --')
{
  const css = readFileSync('src/index.css', 'utf8')
  check('every transition is off under the attribute',
    /:root\[data-tc-resizing\] \*,\s*:root\[data-tc-resizing\] \*::before,\s*:root\[data-tc-resizing\] \*::after \{\s*transition-duration: 0s !important;/.test(css))
  // The panels that do ease, and must not during a drag. Each one's size
  // transition exists (so the rule above is needed) -- if one is renamed the
  // universal rule still covers it, which is why it is universal.
  for (const sel of ['.tc-dmdock', '.tc-threads-tile', '.tc-domain-tile, .tc-threadview-tile'])
    check(`${sel} still eases on arrival (and is covered while dragging)`,
      new RegExp(sel.replace(/[.]/g, '\\.') + '\\s*\\{[^}]*transition:\\s*(height|width)').test(css))
}

console.log('\n-- the room list does not jump when its wall crosses a width --')
{
  const css = readFileSync('src/index.css', 'utf8')
  check('the name card\'s pills are two by two at every width',
    /\.tc-me-actions \{\s*display: grid;\s*grid-template-columns: 1fr 1fr;/.test(css))
  check('no width rule changes the header\'s shape', !/@container tc-me\b/.test(css))
  // Any other container query inside a panel header must not change its
  // HEIGHT; the thread strip's only hide words in a fixed-height row.
  const queries = [...css.matchAll(/@container [\w-]+ \([^)]*\) \{([^}]*)\}/g)].map((m) => m[1])
  check('every remaining container query only hides something (display: none)',
    queries.every((q) => /^\s*[^{]+\{\s*display: none;\s*\}?\s*$/.test(q.trim() + '}')), queries)
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
