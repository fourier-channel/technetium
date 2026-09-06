// Fuzz: random sequences of the operations the UI performs, from the preset.
// After every step the space must be a valid tiling, and closing an OPEN tile
// must always succeed -- "the close button did nothing" is what the operator
// hit, and it is the model refusing an infeasible result somewhere upstream.
import { defaultSpace, openInColumn, closeInColumn, openDomain, closeDomain, openThreadView, closeThreadView, moveDivider, dividers, validTiling, openLeaves, type Space } from '../src/ui/space.ts'

let seed = 20260906
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]

type Op = { name: string; run: (s: Space) => Space; expectChange?: (s: Space) => boolean }
const ops: Op[] = [
  { name: 'openDock', run: (s) => openInColumn(s, 'dock', 0.28) },
  { name: 'closeDock', run: (s) => closeInColumn(s, 'dock'), expectChange: (s) => s.leaves.dock.open },
  { name: 'openList', run: (s) => openInColumn(s, 'threads', 0.22) },
  { name: 'closeList', run: (s) => closeInColumn(s, 'threads'), expectChange: (s) => s.leaves.threads.open },
  { name: 'openDomain', run: (s) => openDomain(s, 0.45) },
  { name: 'closeDomain', run: (s) => closeDomain(s), expectChange: (s) => s.leaves.domain.open },
  { name: 'openThreadView', run: (s) => openThreadView(s, 0.38) },
  { name: 'closeThreadView', run: (s) => closeThreadView(s), expectChange: (s) => s.leaves.thread.open },
  { name: 'drag', run: (s) => { const d = dividers(s); if (!d.length) return s; const x = pick(d); return moveDivider(s, x.axis, x.at, (rnd() - 0.5) * 0.2) } },
]

let failures = 0
const runs = 3000, steps = 14
for (let r = 0; r < runs && failures < 5; r++) {
  let s = defaultSpace()
  const trace: string[] = []
  for (let i = 0; i < steps; i++) {
    const op = pick(ops)
    const before = s
    const after = op.run(s)
    trace.push(op.name)
    if (!validTiling(after)) {
      failures++
      console.log(`  FAIL invalid tiling after: ${trace.join(' > ')}`)
      for (const l of openLeaves(after)) console.log(`       ${l.id} x=${l.x0.toFixed(3)}..${l.x1.toFixed(3)} y=${l.y0.toFixed(3)}..${l.y1.toFixed(3)}`)
      break
    }
    if (op.expectChange && op.expectChange(before) && after === before) {
      failures++
      console.log(`  FAIL ${op.name} REFUSED after: ${trace.join(' > ')}`)
      for (const l of openLeaves(before)) console.log(`       ${l.id} x=${l.x0.toFixed(3)}..${l.x1.toFixed(3)} y=${l.y0.toFixed(3)}..${l.y1.toFixed(3)} min=${l.min}`)
      break
    }
    s = after
  }
}
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log(`  ok   ${runs} random sequences of ${steps} ops: always a tiling, closes always succeed`)
console.log('\nALL CHECKS PASSED')
