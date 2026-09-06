// Checks for the space: the tiling, divider pushes, lock (translate), pin
// (warp about center), the wall, minimums, last-vector-wins, open/close, and
// the number.
import { defaultSpace, moveDivider, pushEdge, resizePanel, setFlag, setMin, openPanel, closePanel, validTiling, dividers, serialize, deserialize } from '../src/ui/space.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => { if (cond) console.log('  ok   ' + name); else { failures++; console.log('  FAIL ' + name, extra ?? '') } }
const near = (a: number, b: number, e = 1e-4) => Math.abs(a - b) < e
const w = (s: ReturnType<typeof defaultSpace>, id: 'sidebar'|'main'|'dock'|'thread'|'members'|'domain') => s.leaves[id].x1 - s.leaves[id].x0
const h = (s: ReturnType<typeof defaultSpace>, id: 'sidebar'|'main'|'dock'|'thread'|'members'|'domain') => s.leaves[id].y1 - s.leaves[id].y0

const S = defaultSpace()
check('preset tiles the space exactly', validTiling(S))
check('preset has two dividers (x=0.18, x=0.85)', dividers(S).length === 2 && dividers(S).every((d) => d.axis === 'x'))
check('preset dock is locked, not pinned (its neighbours stay draggable)', S.leaves.dock.locked && !S.leaves.dock.pinned)

// With the dock open, the sidebar divider still moves: the locked dock translates.
{
  const o = openPanel(S, 'dock', 'main', 'y', 0.28)
  const n = moveDivider(o, 'x', 0.18, 0.05)
  check('sidebar divider moves with a locked dock open', near(w(n, 'sidebar'), 0.23))
  check('locked dock kept its width and translated', near(w(n, 'dock'), w(o, 'dock')) && near(n.leaves.dock.x0, 0.23))
  check('members paid for it', near(w(n, 'members'), 0.10))
  check('still a tiling', validTiling(n))
}

// A drag is many pushes; pushEdge finds the divider where it now is.
{
  let d = S
  for (let i = 0; i < 5; i++) d = pushEdge(d, 'sidebar', 'x', 'hi', 0.01)
  check('five edge pushes accumulate (drag-safe)', near(w(d, 'sidebar'), 0.23))
}

// A divider push: sidebar grows, main shrinks, members untouched, still a tiling.
{
  const n = moveDivider(S, 'x', 0.18, 0.05)
  check('sidebar grew by the push', near(w(n, 'sidebar'), 0.23))
  check('main shrank by the push', near(w(n, 'main'), 0.62))
  check('members untouched', near(w(n, 'members'), 0.15))
  check('still a tiling', validTiling(n))
  check('sidebar remembers the vector (+x)', n.leaves.sidebar.last?.axis === 'x' && n.leaves.sidebar.last?.dir === 1)
}

// LOCKED main: pushing its left edge translates it and pushes members.
{
  const l = setFlag(S, 'main', 'locked', true)
  const n = moveDivider(l, 'x', 0.18, 0.05)
  check('locked panel keeps its width', near(w(n, 'main'), w(S, 'main')))
  check('locked panel translated', near(n.leaves.main.x0, 0.23) && near(n.leaves.main.x1, 0.90))
  check('the push carried on to members', near(w(n, 'members'), 0.10))
  check('still a tiling', validTiling(n))
}

// PINNED main: pushing its left edge warps it about its center.
{
  const p = setFlag(S, 'main', 'pinned', true)
  const cBefore = (S.leaves.main.x0 + S.leaves.main.x1) / 2
  const n = moveDivider(p, 'x', 0.18, 0.04)
  const cAfter = (n.leaves.main.x0 + n.leaves.main.x1) / 2
  check('pinned panel center did not move', near(cAfter, cBefore))
  check('pinned panel shrank by 2x the push', near(w(n, 'main'), w(S, 'main') - 0.08))
  check('the reflection grew members', near(w(n, 'members'), 0.19))
  check('still a tiling', validTiling(n))
}

// LOCKED + PINNED = a fixed object: the push is refused entirely.
{
  const f = setFlag(setFlag(S, 'main', 'locked', true), 'main', 'pinned', true)
  check('fixed object refuses the push', moveDivider(f, 'x', 0.18, 0.05) === f)
}

// The wall: a locked members panel cannot be pushed past x=1, so the push is
// clamped to what the unlocked space allows -- nothing, here.
{
  const l = setFlag(setFlag(S, 'main', 'locked', true), 'members', 'locked', true)
  check('two locked panels against the wall: no movement', moveDivider(l, 'x', 0.18, 0.05) === l)
}

// Minimums: a push runs up to the neighbour's minimum and stops there.
{
  const n = moveDivider(S, 'x', 0.18, 0.9)
  check('main stopped at its minimum', near(w(n, 'main'), 0.1, 1e-3))
  check('sidebar got the rest', near(w(n, 'sidebar'), 0.85 - 0.1, 1e-3))
  const tight = setMin(S, 'main', 0.3)
  const n2 = moveDivider(tight, 'x', 0.18, 0.9)
  check('a larger minimum is honoured', near(w(n2, 'main'), 0.3, 1e-3))
}

// Last vector wins: resizing the PANEL uses its last drag's edge.
{
  const dragged = moveDivider(S, 'x', 0.85, -0.05) // members' left edge pulled left: last on main = -x, members = -x
  const grown = resizePanel(dragged, 'members', 0.05)
  check('panel resize followed its last vector (grew leftward)', near(w(grown, 'members'), 0.25) && near(grown.leaves.members.x1, 1))
  const fresh = resizePanel(S, 'sidebar', 0.05)
  check('no history: sidebar grows toward the middle', near(w(fresh, 'sidebar'), 0.23))
}

// Open the dock out of main; close it back.
{
  const o = openPanel(S, 'dock', 'main', 'y', 0.28)
  check('dock opened over main', o.leaves.dock.open && near(h(o, 'dock'), 0.28) && near(o.leaves.main.y0, 0.28))
  check('opened space still tiles', validTiling(o))
  const c = closePanel(o, 'dock')
  check('closing gives the space back to main', !c.leaves.dock.open && near(c.leaves.main.y0, 0))
  check('closed space still tiles', validTiling(c))
}

// The number round-trips and rejects junk.
{
  let s = openPanel(S, 'dock', 'main', 'y', 0.3)
  s = moveDivider(s, 'x', 0.18, 0.031)
  s = setFlag(s, 'members', 'locked', true)
  const code = serialize(s)
  check('digits only', /^\d+$/.test(code))
  check('pasteable (<= 100 digits)', code.length <= 100, code.length)
  const back = deserialize(code)
  check('round-trip: tiling valid', !!back && validTiling(back))
  check('round-trip: sizes within quantisation', !!back && near(w(back, 'sidebar'), w(s, 'sidebar'), 2 / 1023))
  check('round-trip: flags and open state', !!back && back.leaves.members.locked && back.leaves.dock.open)
  check('round-trip: identical number', !!back && serialize(back) === code)
  check('bad checksum rejected', deserialize(code.slice(0, -1) + ((Number(code.slice(-1)) + 1) % 10)) === null)
  check('junk rejected', deserialize('abc') === null && deserialize('') === null)
  check('v1-shaped number rejected', deserialize(serialize(S).slice(2)) === null)
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
