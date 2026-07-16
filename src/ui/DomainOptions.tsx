import { useEffect, useRef, type ReactNode } from 'react'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import type { DomainSettingsApi } from './domainSettings'
import { isDomainAdmin } from './domainRoles'

// ---------------------------------------------------------------------------
// Domain Options panel: user-level display prefs plus admin-only domain
// controls. Gated by the caller's power level in THIS room (>= 50 == mod/op,
// matching the state-write threshold an admin needs to actually change the
// domain for everyone). Closes on outside-click / Escape.
//
// v1 background controls act on the LOCAL per-room backdrop; Step 4 (upload +
// transform) replaces "Set background" with the interactive placement flow and
// promotes it to shared room state.
// ---------------------------------------------------------------------------

export function DomainOptions({
  client,
  room,
  settings,
  onSetBackground,
  onClose,
}: {
  client: MatrixClient
  room: Room
  settings: DomainSettingsApi
  onSetBackground: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const isAdmin = isDomainAdmin(client, room)
  const hasBackground = settings.getBackdrop(room.roomId) !== undefined

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
        position: 'absolute',
        top: 42,
        right: 12,
        width: 250,
        zIndex: 1000,
        padding: 10,
        borderRadius: 10,
        fontFamily: 'var(--tc-ui-font, inherit)',
        color: 'var(--cpd-color-text-primary)',
        background: 'var(--cpd-color-bg-canvas-default)',
        border: '1px solid rgba(128,128,128,0.35)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
      }}
    >
      <SectionLabel>Domain Options</SectionLabel>

      <ToggleRow
        label="Show backgrounds"
        hint="On your screen only"
        checked={settings.showBackgrounds}
        onChange={settings.setShowBackgrounds}
      />

      {isAdmin && (
        <>
          <Divider label="Admin" />
          <MenuButton onClick={onSetBackground}>Set background…</MenuButton>
          {hasBackground && (
            <MenuButton
              onClick={() => {
                settings.clearBackdrop(room.roomId)
                onClose()
              }}
            >
              Remove background
            </MenuButton>
          )}
        </>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cpd-color-text-secondary)', marginBottom: 8 }}>
      {children}
    </div>
  )
}

function Divider({ label }: { label?: string }) {
  return (
    <div
      style={{
        margin: '8px 0 4px',
        paddingTop: 6,
        borderTop: '1px solid rgba(128,128,128,0.22)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: 'var(--cpd-color-text-secondary)',
      }}
    >
      {label ?? ''}
    </div>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        width: '100%',
        padding: '6px 4px',
        background: 'transparent',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 13, color: 'var(--cpd-color-text-primary)' }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)' }}>{hint}</span>}
      </span>
      <span
        style={{
          flexShrink: 0,
          width: 34,
          height: 20,
          borderRadius: 999,
          padding: 2,
          background: checked ? 'var(--cpd-color-bg-accent-rest, #3390ff)' : 'rgba(128,128,128,0.4)',
          transition: 'background 140ms ease',
          display: 'flex',
          justifyContent: checked ? 'flex-end' : 'flex-start',
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          }}
        />
      </span>
    </button>
  )
}

function MenuButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        fontSize: 13,
        padding: '6px 6px',
        borderRadius: 6,
        border: 'none',
        background: 'transparent',
        color: 'var(--cpd-color-text-primary)',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  )
}
