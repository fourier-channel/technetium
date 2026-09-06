import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Room } from 'matrix-js-sdk'
import { NavTree } from './NavTree'
import { useSpace } from './spaceContext'
import { PanelChrome } from './PanelChrome'

// ---------------------------------------------------------------------------
// The room-list sidebar: header + NavTree in a resizable, persisted panel.
// Width defaults to the widest-room-name fit (NavTree reports it) until the user
// drags the right-edge handle -- after which their width sticks (localStorage
// via roomListSettings). Right-clicking the edge (by the scrollbar) offers Lock
// (freeze the width) and Reset (back to the computed default).
// ---------------------------------------------------------------------------

// Bounds now live in the layout model (panel min sizes); see layout.ts.
const FALLBACK_W = 260

export function Sidebar({
  header,
  selectedRoomId,
  onSelectRoom,
  booruActive,
  onSelectBooru,
}: {
  header: ReactNode
  selectedRoomId?: string
  onSelectRoom?: (room: Room) => void
  booruActive?: boolean
  onSelectBooru?: () => void
}) {
  // Width and lock come from the LAYOUT (account data, one number for the
  // whole screen) rather than this panel's own localStorage entry, so the
  // sidebar obeys the same real-estate rules as every other panel.
  const { space, pushEdge, setPanelFlag, editMode } = useSpace()
  const [defaultWidth, setDefaultWidth] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // The sidebar's share of the space, as pixels of the viewport.
  const leaf = space.leaves.sidebar
  const width = Math.round((leaf.x1 - leaf.x0) * window.innerWidth) || defaultWidth || FALLBACK_W
  const panelLocked = leaf.locked
  const setPanelLocked = (v: boolean) => setPanelFlag('sidebar', 'locked', v)
  // Reset = push the divider back to where the computed default width puts it.
  const setPanelWidth = (w: number | null) => pushEdge('sidebar', 'x', 'hi', ((w ?? defaultWidth ?? FALLBACK_W) - width) / window.innerWidth)

  const onDefaultWidth = useCallback((w: number) => setDefaultWidth(w), [])

  const startResize = (e: React.PointerEvent) => {
    if (panelLocked || e.button !== 0) return
    e.preventDefault()
    // Capture the pointer, as ResizeHandle already does. Without it, dragging
    // RIGHTWARD takes the cursor over the chanbooru IFRAME that fills the dead
    // space, and an iframe swallows the pointer stream: the window listeners
    // below simply stop hearing from it and the drag dies mid-gesture, while
    // dragging left over ordinary DOM worked fine. Capture routes every later
    // event to this element whatever it passes over.
    const grip = e.currentTarget as HTMLElement
    try { grip.setPointerCapture(e.pointerId) } catch { /* not fatal; the drag just stays interruptible */ }
    let lastX = e.clientX
    const onMove = (me: PointerEvent) => {
      // Deltas, applied to the latest layout: a drag fires faster than React
      // renders, so an absolute width from a stale closure would jump.
      const dx = me.clientX - lastX
      lastX = me.clientX
      if (dx !== 0) pushEdge('sidebar', 'x', 'hi', dx / window.innerWidth)
    }
    const onUp = () => {
      try { grip.releasePointerCapture(e.pointerId) } catch { /* already gone */ }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // The model can CLOSE this panel when the screen cannot hold it (space.ts,
  // reflow). Honouring that is the difference between a minimum that means
  // something and a number nobody reads: without this the sidebar keeps
  // drawing at its last width on a phone and the chat never gets its 320px.
  if (!leaf.open) return null

  return (
    <div style={{ position: 'relative', width, flexShrink: 0, height: '100%' }}>
      <aside
        className="tc-scroll"
        style={{
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          boxSizing: 'border-box',
          borderRight: '1px solid rgba(128,128,128,0.25)',
          padding: '8px 4px',
        }}
      >
        {header}
      {editMode && <div style={{ padding: '0 8px 6px' }}><PanelChrome id="sidebar" /></div>}
        {/* No "New room or space" here (operator ruling 2026-09-05): users do
            not create rooms or spaces on this server. DMs are unaffected --
            they are created through the people pickers, never through this
            entry. Client-side removal only; the server itself still honours
            createRoom for any logged-in user (Synapse has no vanilla switch
            for "rooms no, DMs yes" -- that would take a small module -- so
            this is presentation, not enforcement, and is recorded as such). */}
        <NavTree selectedRoomId={selectedRoomId} onSelectRoom={onSelectRoom} onDefaultWidth={onDefaultWidth} booruActive={booruActive} onSelectBooru={onSelectBooru} />
      </aside>

      {/* Right-edge strip (by the scrollbar): drag to resize, right-click for Lock/Reset. */}
      <div
        onPointerDown={startResize}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title={panelLocked ? 'Width locked -- right-click for options' : 'Drag to resize -- right-click for options'}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 7,
          height: '100%',
          zIndex: 5,
          cursor: panelLocked ? 'default' : 'col-resize',
        }}
      />

      {menu && (
        <ResizeMenu
          x={menu.x}
          y={menu.y}
          locked={panelLocked}
          onToggleLock={() => {
            setPanelLocked(!panelLocked)
            setMenu(null)
          }}
          onReset={() => {
            setPanelWidth(null)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function ResizeMenu({
  x,
  y,
  locked,
  onToggleLock,
  onReset,
  onClose,
}: {
  x: number
  y: number
  locked: boolean
  onToggleLock: () => void
  onReset: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const left = Math.max(6, Math.min(x, window.innerWidth - 170))
  const top = Math.max(6, Math.min(y, window.innerHeight - 90))

  return createPortal(
    <div
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left,
        top,
        width: 160,
        zIndex: 1000,
        padding: 4,
        borderRadius: 8,
        fontFamily: 'var(--tc-ui-font)',
        fontSize: 13,
        color: 'var(--cpd-color-text-primary)',
        background: 'var(--cpd-color-bg-canvas-default)',
        border: '1px solid rgba(128,128,128,0.35)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        userSelect: 'none',
      }}
    >
      <MenuItem onClick={onToggleLock}>{locked ? '🔓 Unlock width' : '🔒 Lock width'}</MenuItem>
      <MenuItem onClick={onReset}>↺ Reset to default</MenuItem>
    </div>,
    document.body,
  )
}

function MenuItem({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  const base: CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    fontSize: 13,
    padding: '6px 8px',
    borderRadius: 5,
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      style={base}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  )
}
