import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Room } from 'matrix-js-sdk'
import { NavTree } from './NavTree'
import { useRoomListSettings } from './roomListSettings'

// ---------------------------------------------------------------------------
// The room-list sidebar: header + NavTree in a resizable, persisted panel.
// Width defaults to the widest-room-name fit (NavTree reports it) until the user
// drags the right-edge handle -- after which their width sticks (localStorage
// via roomListSettings). Right-clicking the edge (by the scrollbar) offers Lock
// (freeze the width) and Reset (back to the computed default).
// ---------------------------------------------------------------------------

const MIN_W = 190
const MAX_W = 480
const FALLBACK_W = 260

export function Sidebar({
  header,
  selectedRoomId,
  onSelectRoom,
}: {
  header: ReactNode
  selectedRoomId?: string
  onSelectRoom?: (room: Room) => void
}) {
  const { panelWidth, setPanelWidth, panelLocked, setPanelLocked } = useRoomListSettings()
  const [defaultWidth, setDefaultWidth] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const width = panelWidth ?? defaultWidth ?? FALLBACK_W

  const onDefaultWidth = useCallback((w: number) => setDefaultWidth(w), [])

  const startResize = (e: React.PointerEvent) => {
    if (panelLocked || e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const onMove = (me: PointerEvent) => {
      setPanelWidth(Math.max(MIN_W, Math.min(MAX_W, startW + (me.clientX - startX))))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

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
        <NavTree selectedRoomId={selectedRoomId} onSelectRoom={onSelectRoom} onDefaultWidth={onDefaultWidth} />
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
