import { useState, type ReactNode } from 'react'
import type { UiTransformConfig } from './config'

// ---------------------------------------------------------------------------
// The transform action strip: momentary buttons (Oops / H-mirror / V-mirror),
// a lit/dim toggle (maintain-aspect), and round Cancel / Apply. Every look is
// config-driven; the button behaviours (depress-and-return vs. sticky toggle)
// are the reusable "UI implements" the operator described. Portable.
// ---------------------------------------------------------------------------

export function TransformButtons({
  config,
  aspectLocked,
  onOops,
  onOopsReset,
  onMirrorH,
  onMirrorV,
  onToggleAspect,
  onCancel,
  onApply,
}: {
  config: UiTransformConfig
  aspectLocked: boolean
  onOops: () => void
  onOopsReset: () => void
  onMirrorH: () => void
  onMirrorV: () => void
  onToggleAspect: () => void
  onCancel: () => void
  onApply: () => void
}) {
  const { button: b } = config
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: b.gap }}>
      <Momentary config={config} onClick={onOops} onDoubleClick={onOopsReset} title="Undo one step (double-click: reset)">
        Oops
      </Momentary>
      <Momentary config={config} onClick={onMirrorH} title="Mirror horizontally">
        H | H
      </Momentary>
      <Momentary config={config} onClick={onMirrorV} title="Mirror vertically">
        V / V
      </Momentary>
      <Toggle config={config} on={aspectLocked} onClick={onToggleAspect} title="Maintain aspect ratio">
        4:3&#8594;4:3
      </Toggle>

      <span style={{ width: b.gap * 2 }} />

      <RoundButton config={config} onClick={onCancel} title="Cancel transformation" color="#e5484d">
        {/* red circle with a slash */}
        <svg width="16" height="16" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="#e5484d" strokeWidth="1.6" />
          <line x1="3.9" y1="12.1" x2="12.1" y2="3.9" stroke="#e5484d" strokeWidth="1.6" />
        </svg>
      </RoundButton>
      <RoundButton config={config} onClick={onApply} title="Apply transformation" color="#30a46c">
        {/* green check */}
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" fill="none" stroke="#30a46c" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </RoundButton>
    </div>
  )
}

// Depress-and-return button: darkens while held, fires on click.
function Momentary({
  config,
  children,
  onClick,
  onDoubleClick,
  title,
}: {
  config: UiTransformConfig
  children: ReactNode
  onClick: () => void
  onDoubleClick?: () => void
  title?: string
}) {
  const { button: b } = config
  const [pressed, setPressed] = useState(false)
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        height: b.height,
        padding: `0 ${b.paddingX}px`,
        borderRadius: b.radius,
        fontSize: b.fontSize,
        fontWeight: 600,
        border: `1px solid ${b.border}`,
        background: pressed ? b.pressedBg : b.bg,
        color: b.fg,
        cursor: 'pointer',
        transform: pressed ? 'translateY(1px)' : 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

// Sticky toggle: lit when on, greyed when off.
function Toggle({
  config,
  on,
  children,
  onClick,
  title,
}: {
  config: UiTransformConfig
  on: boolean
  children: ReactNode
  onClick: () => void
  title?: string
}) {
  const { button: b } = config
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      style={{
        height: b.height,
        padding: `0 ${b.paddingX}px`,
        borderRadius: b.radius,
        fontSize: b.fontSize,
        fontWeight: 600,
        border: `1px solid ${on ? b.litBg : b.border}`,
        background: on ? b.litBg : b.dimBg,
        color: on ? b.litFg : b.dimFg,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

function RoundButton({
  config,
  children,
  onClick,
  title,
  color,
}: {
  config: UiTransformConfig
  children: ReactNode
  onClick: () => void
  title?: string
  color: string
}) {
  const { button: b } = config
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        width: b.height,
        height: b.height,
        display: 'grid',
        placeItems: 'center',
        borderRadius: '50%',
        border: `1px solid ${color}`,
        background: b.bg,
        cursor: 'pointer',
        padding: 0,
      }}
    >
      {children}
    </button>
  )
}
