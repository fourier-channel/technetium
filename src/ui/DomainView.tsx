import { useEffect, useRef, useState } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { DomainCanvas } from './DomainCanvas'
import { useDomainSettings } from './domainSettings'
import { DomainOptions } from './DomainOptions'
import { describeBackgroundError, useDomainBackground } from '../client/useDomainBackground'

// ---------------------------------------------------------------------------
// Domain mode for a room: a header (room name -> right-click to change
// backdrop, plus an exit button) and the domain canvas filling everything below
// it.
//
// IT NO LONGER CARRIES A CHAT. It used to: domain mode REPLACED the timeline,
// so it had to bring a log and a composer along or there was no conversation at
// all. Now it opens as a panel beside the real chat, and bringing its own meant
// two timelines and two composers on screen at once, one of them a copy.
//
// The time-to-die control stays here -- it belongs to the canvas, which is what
// it applies to -- but its VALUE is owned by the caller and handed to the one
// real composer, so a post typed while the domain is open still lands with a
// lifetime. That is the one thing the embedded composer was doing that nothing
// else could.
// ---------------------------------------------------------------------------

const MIN_CANVAS = 160

export function DomainView({
  room,
  onExit,
  ttd,
  onTtdChange,
}: {
  room: Room
  onExit: () => void
  ttd: number
  onTtdChange: (ttd: number) => void
}) {
  const { client } = useClient()
  const settings = useDomainSettings()
  const [backdropMenu, setBackdropMenu] = useState<{ x: number; y: number } | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [bgEditing, setBgEditing] = useState(false)
  const [bgError, setBgError] = useState<string | null>(null)
  const { background, clearBackground } = useDomainBackground(client, room)
  const hasBackground = background !== null || settings.getBackdrop(room.roomId) !== undefined

  // Measured height of the canvas-viewport + handle + chat area, so we can hold
  // the canvas CONTENT at a fixed size while the viewport (the window into it)
  // resizes. areaH depends only on the window, never on the drag.
  const areaRef = useRef<HTMLDivElement>(null)
  const [areaH, setAreaH] = useState<number | null>(null)

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setAreaH(el.clientHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The canvas now gets the whole panel. Falls back to filling the viewport
  // until first measured.
  const canvasContentHeight: number | string =
    areaH != null ? Math.max(MIN_CANVAS, areaH) : '100%'

  if (!client) return null

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid rgba(128,128,128,0.25)',
          flexShrink: 0,
        }}
      >
        <span
          onContextMenu={(e) => {
            e.preventDefault()
            setBackdropMenu({ x: e.clientX, y: e.clientY })
          }}
          title="Right-click to change the backdrop"
          style={{
            fontFamily: 'var(--tc-ui-font, inherit)',
            fontWeight: 600,
            fontSize: 14,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'context-menu',
          }}
        >
          {room.name || room.roomId} {'·'} domain
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setOptionsOpen((o) => !o)}
            title="Domain Options"
            aria-label="Domain Options"
            style={{
              fontSize: 13,
              lineHeight: 1,
              padding: '4px 9px',
              borderRadius: 8,
              border: '1px solid rgba(128,128,128,0.35)',
              background: optionsOpen ? 'var(--cpd-color-bg-subtle-secondary)' : 'transparent',
              color: 'var(--cpd-color-text-primary)',
              cursor: 'pointer',
            }}
          >
            {'⚙'} Options
          </button>
          <button
            type="button"
            onClick={onExit}
            style={{
              fontSize: 12,
              padding: '3px 10px',
              borderRadius: 8,
              border: '1px solid rgba(128,128,128,0.35)',
              background: 'transparent',
              color: 'var(--cpd-color-text-primary)',
              cursor: 'pointer',
            }}
          >
            Collapse Domain
          </button>
        </div>
      </div>

      {bgError && (
        <div
          role="alert"
          style={{
            flexShrink: 0,
            fontSize: 12,
            padding: '6px 12px',
            background: 'var(--cpd-color-bg-subtle-secondary)',
            color: 'var(--cpd-color-text-critical-primary, #ff6b6b)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>{bgError}</span>
          <button
            type="button"
            onClick={() => setBgError(null)}
            aria-label="Dismiss"
            style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
          >
            {'×'}
          </button>
        </div>
      )}

      {optionsOpen && (
        <DomainOptions
          client={client}
          room={room}
          settings={settings}
          hasBackground={hasBackground}
          onSetBackground={() => {
            setOptionsOpen(false)
            setBgEditing(true)
          }}
          onRemoveBackground={() => {
            // Rejects on failure now; an unhandled rejection here would be a
            // silent no-op, which is the bug this change exists to remove.
            setBgError(null)
            void clearBackground().catch((err) => setBgError(describeBackgroundError(err)))
            settings.clearBackdrop(room.roomId)
          }}
          onClose={() => setOptionsOpen(false)}
        />
      )}

      <div ref={areaRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Canvas VIEWPORT: a clipping window into the domain. The resize bar
            changes THIS height (how much you see); the canvas content below
            keeps a fixed size, so the domain's shape never changes on drag. */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
          <div style={{ height: canvasContentHeight, display: 'flex', flexDirection: 'column' }}>
            <DomainCanvas
              client={client}
              room={room}
              settings={settings}
              bgEditing={bgEditing}
              onExitBgEdit={() => setBgEditing(false)}
              ttd={ttd}
              onTtdChange={onTtdChange}
            />
          </div>
        </div>

      </div>

      {backdropMenu && (
        <BackdropMenu
          x={backdropMenu.x}
          y={backdropMenu.y}
          current={settings.getBackdrop(room.roomId)}
          onSet={(url) => {
            if (url.trim()) settings.setBackdrop(room.roomId, url.trim())
            setBackdropMenu(null)
          }}
          onClear={() => {
            settings.clearBackdrop(room.roomId)
            setBackdropMenu(null)
          }}
          onClose={() => setBackdropMenu(null)}
        />
      )}
    </div>
  )
}

function BackdropMenu({
  x,
  y,
  current,
  onSet,
  onClear,
  onClose,
}: {
  x: number
  y: number
  current: string | undefined
  onSet: (url: string) => void
  onClear: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(current ?? '')
  const ref = useRef<HTMLDivElement>(null)
  const left = Math.max(6, Math.min(x, window.innerWidth - 280))
  const top = Math.max(6, Math.min(y, window.innerHeight - 150))

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

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        top,
        width: 268,
        zIndex: 1000,
        padding: 10,
        borderRadius: 8,
        fontFamily: 'var(--tc-ui-font, inherit)',
        color: 'var(--cpd-color-text-primary)',
        background: 'var(--cpd-color-bg-canvas-default)',
        border: '1px solid rgba(128,128,128,0.35)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--cpd-color-text-secondary)', marginBottom: 6 }}>
        Backdrop image URL
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSet(draft)
        }}
        placeholder="https://…"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontSize: 13,
          padding: '4px 6px',
          marginBottom: 8,
          color: 'var(--cpd-color-text-primary)',
          background: 'transparent',
          border: '1px solid rgba(128,128,128,0.35)',
          borderRadius: 5,
        }}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {current !== undefined && (
          <button
            type="button"
            onClick={onClear}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid rgba(128,128,128,0.35)',
              background: 'transparent',
              color: 'var(--cpd-color-text-primary)',
              cursor: 'pointer',
            }}
          >
            Remove
          </button>
        )}
        <button
          type="button"
          onClick={() => onSet(draft)}
          style={{
            fontSize: 12,
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid rgba(128,128,128,0.35)',
            background: 'var(--cpd-color-bg-subtle-primary)',
            color: 'var(--cpd-color-text-primary)',
            cursor: 'pointer',
          }}
        >
          Set
        </button>
      </div>
    </div>
  )
}
