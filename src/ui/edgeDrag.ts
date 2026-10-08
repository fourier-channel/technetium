import { useRef } from 'react'
import { useSpace } from './spaceContext'
import { edgeAt, type Axis, type PanelId, type Side } from './space'

// ---------------------------------------------------------------------------
// Dragging a divider (launch-polish L29, operator 2026-10-08: "the
// grab-and-drag bars between panels are kinda janky, it looks like all the
// dynamic resizing from the profile/settings/etc buttons").
//
// ONE gesture for every divider -- the room list's own grip and every
// ResizeHandle -- because the two had been written separately and each
// carried the same two faults:
//
//  - STEPS, NOT A TARGET. Each pointer move pushed the edge by that move's
//    delta. The model refuses what a minimum or a lock forbids, and a refused
//    delta was simply lost: the divider stopped at the wall while the pointer
//    went on, and on the way back moved at once, a wall's width from the hand
//    dragging it. Now every move asks for the edge at its start plus the
//    pointer's whole travel (space.ts dragEdgeTo), so it waits at a wall and
//    picks the pointer up where it is.
//
//  - EASED. The panels that come and go -- the DM dock, the thread strip, the
//    thread view, the domain -- transition their size over ~400ms, which is
//    how they arrive. The same transition ran on every drag step, so those
//    panels trailed the pointer and settled after it stopped. While a divider
//    is held the root carries data-tc-resizing and the stylesheet turns every
//    transition off; the panels follow the pointer exactly and arrive the way
//    they always did once it is let go.
// ---------------------------------------------------------------------------

export interface EdgeRef {
  id: PanelId
  axis: Axis
  side: Side
}

const ATTR = 'tcResizing'

function beginResizing(axis: Axis) {
  document.documentElement.dataset[ATTR] = axis
}
function endResizing() {
  delete document.documentElement.dataset[ATTR]
}

// Pointer handlers for an element that drags `edge`. `enabled` false (a
// locked panel) makes it inert.
export function useEdgeDrag(edge: EdgeRef, enabled = true) {
  const { space, dragEdgeTo } = useSpace()
  const start = useRef<{ pointer: number; at: number; extent: number } | null>(null)
  const pointerOf = (e: React.PointerEvent) => (edge.axis === 'y' ? e.clientY : e.clientX)

  const finish = (e: React.PointerEvent<HTMLElement>) => {
    if (!start.current) return
    start.current = null
    endResizing()
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    } catch { /* already released */ }
  }

  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled || e.button !== 0 || !space.leaves[edge.id].open) return
      e.preventDefault()
      start.current = {
        pointer: pointerOf(e),
        at: edgeAt(space, edge.id, edge.axis, edge.side),
        extent: Math.max(1, edge.axis === 'y' ? window.innerHeight : window.innerWidth),
      }
      // Capture, so a drag that crosses the booru's iframe keeps its pointer
      // stream (an iframe swallows it otherwise -- memory drag-across-an-iframe).
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not fatal; the drag just stays interruptible */ }
      beginResizing(edge.axis)
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = start.current
      if (!s) return
      dragEdgeTo(edge.id, edge.axis, edge.side, s.at + (pointerOf(e) - s.pointer) / s.extent)
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
  }
}
