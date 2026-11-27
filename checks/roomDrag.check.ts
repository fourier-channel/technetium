// Checks for tc.36: the room list's drag reorders, autoscrolls the sidebar's
// scroll box near its edges, and has a keyboard alternative that writes
// through the same path.
//
// Two halves. The arithmetic (src/ui/dragMath.ts) is proven over its inputs
// here. The wiring -- which element scrolls, which rows get the handlers, what
// a key press calls -- lives in React components the suite cannot render, so
// it is asserted on the source with comments stripped (a comment naming the
// right call is not the call). Neither half proves a browser does it; the
// drag itself is seen in Playwright Chromium and recorded with the commit.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EDGE_PX, MAX_SCROLL_SPEED, autoscrollStep, dropOrder, moveBy, type Scroller } from '../src/ui/dragMath.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Line and block comments out, strings kept: what remains is what runs.
const code = (path: string) =>
  readFileSync(join(root, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// A scroll box as the browser reports it: top/bottom on screen, content taller
// than the box, scrollTop clamped by the caller.
function box(top: number, height: number, content: number, scrollTop = 0): Scroller {
  return {
    scrollTop,
    scrollHeight: content,
    clientHeight: height,
    getBoundingClientRect: () => ({ top, bottom: top + height }),
  }
}

console.log('\n-- autoscrollStep: the sidebar scrolls, the group does not need to --')
{
  // The sidebar box: 400px tall at y=100, 1200px of rooms.
  const sidebar = box(100, 400, 1200, 200)
  // A space's group: as tall as its content, so it can never scroll.
  const group = box(-100, 900, 900, 0)
  const d = autoscrollStep(sidebar, 100 + 400 - 1) // pointer one px inside the bottom edge
  check('near the bottom edge the sidebar scrolls down', d > 0 && sidebar.scrollTop === 200 + d, { d, top: sidebar.scrollTop })
  check('at the very edge it scrolls at nearly full speed', d > MAX_SCROLL_SPEED * 0.9, d)
  // The W3.4 bug, kept as a fact: the group has no room to scroll.
  const g = autoscrollStep(group, 100 + 400 - 1)
  check('the group, driven instead, cannot move (the lost autoscroll)', g === 0 && group.scrollTop === 0, { g })
  const up = autoscrollStep(sidebar, 100 + 1)
  check('near the top edge the sidebar scrolls up', up < 0, up)
  const mid = autoscrollStep(sidebar, 300)
  check('clear of both edges nothing moves', mid === 0)
  const atEnd = box(100, 400, 1200, 800)
  check('at the bottom already, a bottom-edge step moves 0', autoscrollStep(atEnd, 499) === 0 && atEnd.scrollTop === 800)
  const atTop = box(100, 400, 1200, 0)
  check('at the top already, a top-edge step moves 0', autoscrollStep(atTop, 101) === 0 && atTop.scrollTop === 0)
  const short = box(100, 400, 300, 0)
  check('content shorter than the box never scrolls', autoscrollStep(short, 499) === 0 && short.scrollTop === 0)
  // Speed rises toward the edge and never passes the cap.
  let last = 0
  let monotone = true
  for (let y = 100 + 400 - EDGE_PX; y <= 100 + 400 + 50; y += 4) {
    const s = box(100, 400, 5000, 1000)
    const step = autoscrollStep(s, y)
    if (step < last || step > MAX_SCROLL_SPEED) monotone = false
    last = step
  }
  check('speed rises toward the bottom edge and is capped', monotone && last === MAX_SCROLL_SPEED, last)
}

console.log('\n-- dropOrder and moveBy agree (D-tc01) --')
{
  const ids = ['!a', '!b', '!c', '!d']
  // Cards 30px apart, centres at 15, 45, 75, 105.
  const cards = ids.map((id, i) => ({ id, center: 15 + 30 * i }))
  check('a drop past the next card\'s centre is a move down by one',
    dropOrder(cards, 1, 76).join() === moveBy(ids, '!b', 1)?.join())
  check('a drop above the previous card\'s centre is a move up by one',
    dropOrder(cards, 2, 44).join() === moveBy(ids, '!c', -1)?.join())
  check('a drop short of the next centre leaves the order', dropOrder(cards, 1, 74).join() === ids.join())
  check('a drop back in place leaves the order', dropOrder(cards, 1, 45).join() === ids.join())
  // Every one-step move, both ways, from every position.
  let agree = true
  for (let i = 0; i < ids.length; i++) {
    for (const delta of [-1, 1]) {
      const byKey = moveBy(ids, ids[i], delta)
      const j = i + delta
      if (j < 0 || j >= ids.length) { if (byKey !== null) agree = false; continue }
      const byDrag = dropOrder(cards, i, cards[j].center + delta)
      if (byKey?.join() !== byDrag.join()) agree = false
    }
  }
  check('every one-place move by key equals the drag that means it', agree)
  check('moveBy refuses past the top', moveBy(ids, '!a', -1) === null)
  check('moveBy refuses past the bottom', moveBy(ids, '!d', 1) === null)
  check('moveBy refuses an id not in the group', moveBy(ids, '!z', 1) === null)
  check('moveBy refuses a zero move', moveBy(ids, '!b', 0) === null)
  check('moveBy keeps every id exactly once', (moveBy(ids, '!a', 3) ?? []).slice().sort().join() === ids.join())
  check('moveBy leaves its input alone', (moveBy(ids, '!a', 1), ids.join() === '!a,!b,!c,!d'))
}

console.log('\n-- threadDrag: scrolls the scroller, measures the members --')
{
  const td = code('src/ui/threadDrag.ts')
  check('options take a scrollRef', /scrollRef\?: RefObject<HTMLElement \| null>/.test(td))
  check('the tick scrolls scrollRef before the container',
    /const scroller = scrollRef\?\.current \?\? containerRef\.current/.test(td) && /autoscrollStep\(scroller, s\.pointerY\)/.test(td))
  check('the follow delta is the scroller\'s', /scrollDelta = scroller \? scroller\.scrollTop - s\.startScrollTop/.test(td))
  check('engage records the scroller\'s start', /startScrollTop = \(scrollRef\?\.current \?\? container\)\.scrollTop/.test(td))
  check('no local autoscroll arithmetic is left', !/EDGE_PX|MAX_SCROLL_SPEED/.test(td))
  check('engage measures only the ordered ids', /measureCards\(container, orderedRef\.current\)/.test(td))
  check('a drop decides through dropOrder', /const finalIds = dropOrder\(s\.cards, s\.dragIndex, draggedCenter\)/.test(td))
  check('a key move decides through moveBy and writes through onReorder',
    /const next = moveBy\(orderedRef\.current, id, delta\)\s*\n\s*if \(next\) onReorderRef\.current\(next\)/.test(td))
  check('a key move waits out a live drag', /if \(sessionRef\.current\?\.engaged\) return null/.test(td))
  check('the hook returns move', /return \{ getCardHandlers, consumeClickSuppressed, move \}/.test(td))
}

console.log('\n-- NavTree and Sidebar: the rows get the handlers, the sidebar is the scroller --')
{
  const nt = code('src/ui/NavTree.tsx')
  const sb = code('src/ui/Sidebar.tsx')
  check('the sidebar hands its scroll box to the tree',
    /ref=\{navScrollRef\}/.test(sb) && /<NavTree[^>]*scrollRef=\{navScrollRef\}/.test(sb))
  check('the group passes the scroll box to the drag', /scrollRef: nav\?\.scrollRef/.test(nt))
  check('the group provides its drag to its rows', /<SiblingDragContext\.Provider value=\{value\}>/.test(nt))
  check('only members get handlers', /handlersFor: \(id\) => \(members\.has\(id\) \? getCardHandlers\(id\) : undefined\)/.test(nt))
  check('a row reads its group and spreads the handlers',
    /const group = useContext\(SiblingDragContext\)/.test(nt) &&
      /const dragHandlers = group\?\.handlersFor\(node\.roomId\)/.test(nt) &&
      /data-flip-id=\{node\.roomId\}\s*\n\s*\{\.\.\.dragHandlers\}/.test(nt))
  check('a drag that ends on a row does not click it', /if \(group\?\.suppressed\(node\.roomId\)\) return/.test(nt))
  check('a row is focusable', /tabIndex=\{0\}\s*\n\s*role="button"/.test(nt))
  check('Alt+Up / Alt+Down moves the row through its group',
    /e\.altKey && \(e\.key === 'ArrowUp' \|\| e\.key === 'ArrowDown'\) && group\?\.has\(node\.roomId\)/.test(nt) &&
      /group\.move\(node\.roomId, e\.key === 'ArrowUp' \? -1 : 1, label\)/.test(nt))
  check('the group\'s move is the hook\'s move', /const next = move\(id, delta\)/.test(nt))
  check('a keyboard move is spoken', /aria-live="polite"/.test(nt) && /announce\(`Moved \$\{label\} to position/.test(nt))
  // No second write path: one onReorder in the tree, and nothing else in the
  // client writes a room order.
  check('the tree writes room order in exactly one place', (nt.match(/setRoomOrder\(/g) ?? []).length === 1)
  check('that place is the group\'s onReorder', /\(finalIds: string\[\]\) => settings\.setRoomOrder\(scope, finalIds\)/.test(nt))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
