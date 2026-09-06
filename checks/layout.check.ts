// Checks for the real-estate model: proportional sharing, lock, pin, the
// flex remainder, and that the number round-trips exactly and rejects junk.
import { defaultLayout, resize, setFlag, move, serialize, deserialize, panelsIn } from '../src/ui/layout.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const L = defaultLayout()

// Growing a panel is paid for by unlocked partners in proportion.
{
  // With main LOCKED there is no flex absorber, so the partners must pay.
  let l = setFlag(L, 'thread', 'open', true)
  l = setFlag(l, 'main', 'locked', true)
  const before = { sidebar: l.panels.sidebar.size, thread: l.panels.thread.size, members: l.panels.members.size }
  const grown = resize(l, 'sidebar', 100)
  check('grown panel takes the delta', grown.panels.sidebar.size === before.sidebar + 100)
  const paid = (before.thread - grown.panels.thread.size) + (before.members - grown.panels.members.size)
  check('partners paid exactly the delta', paid === 100, paid)
  const ratio = (before.thread - grown.panels.thread.size) / (before.members - grown.panels.members.size)
  check('shares are proportional to size (380:220)', Math.abs(ratio - 380 / 220) < 0.1, ratio)
}

// A locked partner pays nothing.
{
  let l = setFlag(L, 'thread', 'open', true)
  l = setFlag(l, 'members', 'locked', true)
  l = setFlag(l, 'main', 'locked', true)
  const grown = resize(l, 'sidebar', 60)
  check('locked partner untouched', grown.panels.members.size === L.panels.members.size)
  check('unlocked partner paid it all', grown.panels.thread.size === L.panels.thread.size - 60)
}

// Dragging a locked panel does nothing at all.
{
  const l = setFlag(L, 'sidebar', 'locked', true)
  check('locked panel cannot be resized', resize(l, 'sidebar', 50) === l)
}

// Minimums hold; the delta is clamped to what partners can pay.
{
  let l = setFlag(L, 'thread', 'open', false)
  l = setFlag(l, 'main', 'locked', true)
  const grown = resize(l, 'sidebar', 10000)
  check('partner stops at its minimum', grown.panels.members.size === grown.panels.members.min)
  check('delta clamped to capacity', grown.panels.sidebar.size === L.panels.sidebar.size + (L.panels.members.size - L.panels.members.min))
}

// With a flex panel present, the flex absorbs and partners are untouched.
{
  const grown = resize(L, 'sidebar', 80)
  check('flex domain: partners untouched', grown.panels.members.size === L.panels.members.size)
  check('flex domain: grown panel took delta', grown.panels.sidebar.size === L.panels.sidebar.size + 80)
}

// The DM dock wins by default.
check('dmDock locked by default', L.panels.dmDock.locked)
check('dmDock pinned by default', L.panels.dmDock.pinned)
check('dmDock first in its column', panelsIn(setFlag(L, 'dmDock', 'open', true), 'column')[0].id === 'dmDock')

// Pin: a pinned panel does not move, and nothing crosses it.
{
  check('pinned panel does not move', move(L, 'dmDock', 3) === L)
  const l = setFlag(L, 'dmDock', 'open', true)
  check('nothing may cross a pinned panel', move(l, 'composer', 0) === l)
  const l2 = setFlag(l, 'dmDock', 'pinned', false)
  const moved = move(l2, 'composer', 0)
  check('unpinned: reorder works', panelsIn(moved, 'column')[0].id === 'composer')
}

// The number round-trips exactly and rejects junk.
{
  let l = setFlag(L, 'thread', 'open', true)
  l = resize(l, 'sidebar', 37)
  l = setFlag(l, 'members', 'locked', true)
  l = setFlag(l, 'dmDock', 'open', true)
  const code = serialize(l)
  check('code is digits only', /^\d+$/.test(code), code)
  check('code is pasteable (<= 60 digits)', code.length <= 60, code.length)
  const back = deserialize(code)
  check('round-trip: sizes', !!back && back.panels.sidebar.size === l.panels.sidebar.size)
  check('round-trip: flags', !!back && back.panels.members.locked && back.panels.dmDock.open && back.panels.thread.open)
  check('round-trip: identical code', !!back && serialize(back) === code)
  check('bad checksum rejected', deserialize(code.slice(0, -1) + ((Number(code.slice(-1)) + 1) % 10)) === null)
  check('junk rejected', deserialize('hello') === null && deserialize('') === null)
  check('default is its own number', serialize(deserialize(serialize(L))!) === serialize(L))
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
