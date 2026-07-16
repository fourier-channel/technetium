import { useEffect, useRef, useState } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { DomainCanvas } from './DomainCanvas'
import { Timeline } from './Timeline'
import { Composer } from './Composer'
import { useDomainSettings } from './domainSettings'
import { DomainOptions } from './DomainOptions'
import { useDomainBackground } from '../client/useDomainBackground'

// ---------------------------------------------------------------------------
// Domain mode for a room: a header (room name -> right-click to change
// backdrop, plus an exit button), the domain canvas (the big area), and BELOW
// it the normal chat log + composer -- so the familiar chat window still exists
// as a sizeable panel above the text input.
// ---------------------------------------------------------------------------

export function DomainView({ room, onExit }: { room: Room; onExit: () => void }) {
  const { client } = useClient()
  const settings = useDomainSettings()
  const [backdropMenu, setBackdropMenu] = useState<{ x: number; y: number } | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [bgEditing, setBgEditing] = useState(false)
  const { background, clearBackground } = useDomainBackground(client, room)
  const hasBackground = background !== null || settings.getBackdrop(room.roomId) !== undefined

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
            void clearBackground()
            settings.clearBackdrop(room.roomId)
          }}
          onClose={() => setOptionsOpen(false)}
        />
      )}

      <DomainCanvas
        client={client}
        room={room}
        settings={settings}
        bgEditing={bgEditing}
        onExitBgEdit={() => setBgEditing(false)}
      />

      {/* The normal chat log, unchanged, as a sizeable panel above the composer. */}
      <div
        style={{
          height: 260,
          flexShrink: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          borderTop: '1px solid rgba(128,128,128,0.25)',
        }}
      >
        <Timeline room={room} />
      </div>
      <Composer room={room} />

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
