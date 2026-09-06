// Checks for the space: the tiling, divider pushes, lock (translate), pin
// (warp about center), the wall, minimums, last-vector-wins, open/close, and
// the number.
import { defaultSpace, moveDivider, pushEdge, resizePanel, setFlag, setMin, openPanel, closePanel, openInColumn, closeInColumn, openDomain, closeDomain, openThreadView, closeThreadView, validTiling, dividers, serialize, deserialize } from '../src/ui/space.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => { if (cond) console.log('  ok   ' + name); else { failures++; console.log('  FAIL ' + name, extra ?? '') } }
const near = (a: number, b: number, e = 1e-4) => Math.abs(a - b) < e
const w = (s: ReturnType<typeof defaultSpace>, id: 'sidebar'|'main'|'dock'|'threads'|'thread'|'members'|'domain') => s.leaves[id].x1 - s.leaves[id].x0
const h = (s: ReturnType<typeof defaultSpace>, id: 'sidebar'|'main'|'dock'|'threads'|'thread'|'members'|'domain') => s.leaves[id].y1 - s.leaves[id].y0

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
  check('pasteable (<= 120 digits; seven tiles is ~113)', code.length <= 120, code.length)
  const back = deserialize(code)
  check('round-trip: tiling valid', !!back && validTiling(back))
  check('round-trip: sizes within quantisation', !!back && near(w(back, 'sidebar'), w(s, 'sidebar'), 2 / 1023))
  check('round-trip: flags and open state', !!back && back.leaves.members.locked && back.leaves.dock.open)
  check('round-trip: identical number', !!back && serialize(back) === code)
  check('bad checksum rejected', deserialize(code.slice(0, -1) + ((Number(code.slice(-1)) + 1) % 10)) === null)
  check('junk rejected', deserialize('abc') === null && deserialize('') === null)
  check('older-version number rejected', deserialize(serialize(S).slice(2)) === null)
}

// The column stack: dock over thread list over chat (operator ruling).
{
  const t = openInColumn(S, 'threads', 0.22)
  check('thread list opens at the top of the column when no dock', near(t.leaves.threads.y0, 0) && near(h(t, 'threads'), 0.22))
  check('chat gave up the height', near(t.leaves.main.y0, 0.22))
  const d = openInColumn(t, 'dock', 0.28)
  check('dock inserts ABOVE the thread list', near(d.leaves.dock.y0, 0) && near(d.leaves.dock.y1, 0.28))
  check('thread list stays attached to the dock bottom', near(d.leaves.threads.y0, 0.28) && near(h(d, 'threads'), 0.22))
  check('chat shrank, not the thread list', near(d.leaves.main.y0, 0.50))
  check('column tiles the space', validTiling(d))
  const c = closeInColumn(d, 'dock')
  check('closing the dock lifts the thread list back to the top', near(c.leaves.threads.y0, 0) && near(c.leaves.main.y0, 0.22))
  const c2 = closeInColumn(d, 'threads')
  check('closing the thread list gives its height to the chat, dock untouched', near(c2.leaves.main.y0, 0.28) && near(c2.leaves.dock.y1, 0.28))
  // Opening the dock first, then the list: the list goes under the dock.
  const d2 = openInColumn(openInColumn(S, 'dock', 0.28), 'threads', 0.22)
  check('list opened after the dock sits under it (fraction is of the whole column)', near(d2.leaves.threads.y0, 0.28) && near(d2.leaves.main.y0, 0.50))
  // setMin caps at 0.5; a 0.3 list under a 0.28 dock leaves the chat 0.42.
  const starved = setMin(openInColumn(S, 'dock', 0.28), 'main', 0.5)
  check('a list that would starve the chat is refused', openInColumn(starved, 'threads', 0.3) === starved)
}

// Attachment points (operator ruling): the domain takes width from the chat
// column BELOW the dock; the thread view takes width from everything at full
// height; closing the thread list with both open gives its height to the chat
// and touches neither.
{
  let x = openInColumn(S, 'dock', 0.28)
  x = openInColumn(x, 'threads', 0.22)
  const dom = openDomain(x, 0.45)
  check('domain opened: top is the dock bottom', near(dom.leaves.domain.y0, 0.28) && near(dom.leaves.domain.y1, 1))
  check('domain took width from thread list and chat, not the dock', near(dom.leaves.main.x1, dom.leaves.domain.x0) && near(dom.leaves.threads.x1, dom.leaves.domain.x0) && near(dom.leaves.dock.x1, 0.85))
  check('domain: still a tiling', validTiling(dom))
  const tv = openThreadView(dom, 0.38)
  check('thread view is full height', near(tv.leaves.thread.y0, 0) && near(tv.leaves.thread.y1, 1))
  check('thread view took width from the dock AND the domain', near(tv.leaves.dock.x1, tv.leaves.thread.x0) && near(tv.leaves.domain.x1, tv.leaves.thread.x0))
  check('thread view: still a tiling', validTiling(tv))
  // The operator's example.
  const closedList = closeInColumn(tv, 'threads')
  check('closing the thread list: chat expands into its height', near(closedList.leaves.main.y0, 0.28))
  check('closing the thread list: domain unaffected', near(closedList.leaves.domain.y0, 0.28) && near(closedList.leaves.domain.x0, tv.leaves.domain.x0) && near(closedList.leaves.domain.x1, tv.leaves.domain.x1))
  check('closing the thread list: thread view unaffected', near(closedList.leaves.thread.x0, tv.leaves.thread.x0) && near(closedList.leaves.thread.y0, 0) && near(closedList.leaves.thread.y1, 1))
  check('closing the thread list: still a tiling', validTiling(closedList))
  const backDom = closeDomain(closedList)
  check('closing the domain hands its width back to the chat', near(backDom.leaves.main.x1, tv.leaves.domain.x1))
  const backAll = closeThreadView(backDom)
  check('closing the thread view hands its width back to dock and chat', near(backAll.leaves.dock.x1, 0.85) && near(backAll.leaves.main.x1, 0.85) && validTiling(backAll))
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
