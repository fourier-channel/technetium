import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { PullTab } from '../ui/PullTab'
import { TabRail } from '../ui/TabRail'
import { tabAttach } from '../ui/tabRide'
import { useReveal } from '../ui/useReveal'
import { panelHeight } from './qqGrid'
import { storedPanelHeight, storePanelHeight } from './panelPrefs'

// ---------------------------------------------------------------------------
// QuickQueue's drawer (tc.152 step 1; master reference sec 22.1): a panel
// pulled up from the chat box, above the ticker, resized by its top edge.
//
// This file is the only QuickQueue code every page load carries, and it is
// small on purpose: the panel itself (QuickQueuePanel.tsx, with the folder
// store and the thumbnailer) is fetched the first time the drawer is opened,
// so a user who never opens it never downloads it.
//
// Once opened the panel stays mounted when the drawer is pushed back down, so
// reopening it finds the same folder at the same scroll. Pushed down, it is
// zero tall and its grid mounts no rows, so keeping it costs nothing.
//
// It is a tile that TAKES its height from the chat above it, never one drawn
// over it (memory no-forced-reflow-law: the chat shrinks smoothly, it is not
// covered), and it may never take so much that the chat is gone (qqGrid.ts
// panelHeight).
// ---------------------------------------------------------------------------

const QuickQueuePanel = lazy(() => import('./QuickQueuePanel'))

const REVEAL_MS = 380

// How far above the drawer's top edge the tab's clip reaches: room for the
// closed tab (16 px, 24 on touch) and its tooltip above it.
const TAB_HEADROOM_PX = 64

export function QuickQueueDrawer() {
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  const reveal = useReveal(open, REVEAL_MS)
  const shell = useRef<HTMLDivElement | null>(null)
  // The height the panel and the chat share: the column this drawer sits in.
  const [room, setRoom] = useState(0)
  const [wanted, setWanted] = useState<number | null>(storedPanelHeight)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ pointer: number; startY: number; startH: number } | null>(null)

  useEffect(() => {
    const column = shell.current?.parentElement
    if (!column) return
    const measure = () => setRoom(column.clientHeight)
    queueMicrotask(measure)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(column)
    return () => ro.disconnect()
  }, [])

  const height = room > 0 ? panelHeight(wanted, room) : 0

  const toggle = () => {
    if (!open) setEverOpened(true)
    setOpen(!open)
  }

  // The top edge is the grip. Pointer capture keeps the drag alive when the
  // cursor crosses the booru iframe (memory drag-across-an-iframe).
  const onGripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { pointer: e.pointerId, startY: e.clientY, startH: height }
    setDragging(true)
  }
  const onGripMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId) return
    setWanted(panelHeight(d.startH + (d.startY - e.clientY), room))
  }
  const onGripUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId) return
    drag.current = null
    setDragging(false)
    const final = panelHeight(d.startH + (d.startY - e.clientY), room)
    setWanted(final)
    storePanelHeight(final)
  }

  return (
    <div className="tc-qq-drawer" ref={shell}>
      {/* ONE tab, riding the panel's top edge (tabRide.ts), as every other
          drawer's does. The drawer's top IS that edge -- the tile below it
          grows the drawer -- so layout carries the tab and no rail offset is
          needed. Closed, it hangs above the edge, outside the panel; open, it
          sits below the edge, inside it. The clip ends at the drawer's
          bottom, so the moment it changes sides (at the click, while the
          edge is still on the ticker) the inside tab is out of sight below
          it, and the edge brings it into view. */}
      <TabRail axis="y" offset="0px" durationMs={reveal.durationMs} clip={{ top: -TAB_HEADROOM_PX, bottom: 0, left: 0, right: 0 }}>
        <PullTab
          pull={open ? 'down' : 'up'}
          open={open}
          // Inverted from the drawers that come DOWN: for a panel coming up,
          // inside it is below the anchor (PullTab's base rule, 'start') and
          // outside is above it ('above').
          attach={tabAttach(open, reveal.mounted) === 'end' ? 'start' : 'above'}
          target="quickqueue"
          label={open ? 'Hide QuickQueue' : 'QuickQueue'}
          onClick={toggle}
          style={{ top: TAB_HEADROOM_PX, left: '50%' }}
        />
      </TabRail>
      {everOpened && (
        <div
          className="tc-qq-tile"
          data-dragging={dragging ? 'true' : 'false'}
          aria-hidden={!reveal.shown}
          inert={!open}
          style={{
            height: reveal.shown ? height : 0,
            transitionDuration: dragging ? '0ms' : `${reveal.durationMs}ms`,
          }}
        >
          <div
            className="tc-qq-grip"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize QuickQueue"
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
          />
          <Suspense fallback={<p className="tc-qq-note">Opening QuickQueue...</p>}>
            <QuickQueuePanel />
          </Suspense>
        </div>
      )}
    </div>
  )
}
