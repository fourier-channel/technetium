import { useCallback, useEffect, useRef, useState } from 'react'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import { useDomainBackground } from '../client/useDomainBackground'
import {
  IDENTITY_TRANSFORM,
  nudge,
  scaleBy,
  transformToStyle,
  type Transform,
} from './uitransform/transform'

// ---------------------------------------------------------------------------
// Background edit mode (Step 4a): the whole domain becomes an image drop-box.
// Pick/drop an image, then move it (drag), scale it (wheel), and nudge it
// (arrows) in real time -- it sits BEHIND the grid (z0) while a transparent
// capture layer (z60) takes the input. Bottom-right: Cancel / Set Background.
// "Press T to transform" is wired in Step 4b (the portable Transform editor).
// ---------------------------------------------------------------------------

const NUDGE_STEP = 0.01 // normalized per arrow press
const WHEEL_FACTOR = 1.08 // per wheel notch

export function DomainBackgroundEditor({
  client,
  room,
  onExit,
  onOpenTransform,
}: {
  client: MatrixClient
  room: Room
  onExit: () => void
  onOpenTransform?: (t: Transform, img: string) => void
}) {
  const { setBackground } = useDomainBackground(client, room)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const fileRef = useRef<File | null>(null)
  const [transform, setTransform] = useState<Transform>(IDENTITY_TRANSFORM)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const captureRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Latest transform for window key handlers that close over stale state.
  const tRef = useRef(transform)
  useEffect(() => {
    tRef.current = transform
  }, [transform])

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    fileRef.current = file
    setImgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
    setTransform(IDENTITY_TRANSFORM)
  }, [])

  // Revoke the object URL on unmount.
  useEffect(() => {
    return () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl)
    }
  }, [imgUrl])

  // Keyboard: arrows nudge, Escape cancels, T opens the transform editor (4b).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onExit()
        return
      }
      if (!imgUrl) return
      if (e.key === 't' || e.key === 'T') {
        if (onOpenTransform) onOpenTransform(tRef.current, imgUrl)
        e.preventDefault()
        return
      }
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -NUDGE_STEP
      else if (e.key === 'ArrowRight') dx = NUDGE_STEP
      else if (e.key === 'ArrowUp') dy = -NUDGE_STEP
      else if (e.key === 'ArrowDown') dy = NUDGE_STEP
      else return
      e.preventDefault()
      setTransform((t) => nudge(t, dx, dy))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [imgUrl, onExit, onOpenTransform])

  const onWheel = (e: React.WheelEvent) => {
    if (!imgUrl) return
    e.preventDefault()
    setTransform((t) => scaleBy(t, e.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR))
  }

  // Drag-to-move via window listeners (no pointer-capture, so control clicks
  // are never swallowed -- cf. G-bf01).
  const onPointerDown = (e: React.PointerEvent) => {
    if (!imgUrl || e.button !== 0) return
    const el = captureRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY, t: tRef.current }
    const onMove = (me: PointerEvent) => {
      const dx = (me.clientX - start.x) / rect.width
      const dy = (me.clientY - start.y) / rect.height
      setTransform({ ...start.t, tx: clamp01(start.t.tx + dx), ty: clamp01(start.t.ty + dy) })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const commit = async () => {
    const file = fileRef.current
    if (!file || busy) return
    setBusy(true)
    try {
      const { content_uri } = await client.uploadContent(file, { name: file.name, type: file.type })
      await setBackground(content_uri, tRef.current)
      onExit()
    } catch {
      setBusy(false) // leave the editor open so the user can retry
    }
  }

  return (
    <>
      {/* Image preview, behind the grid (z0). */}
      {imgUrl && (
        <img src={imgUrl} alt="" draggable={false} style={{ ...transformToStyle(transform), zIndex: 0, pointerEvents: 'none', userSelect: 'none' }} />
      )}

      {/* Transparent capture + controls layer, above everything (z60). */}
      <div
        ref={captureRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) loadFile(f)
        }}
        onClick={() => {
          if (!imgUrl) fileInputRef.current?.click()
        }}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 60,
          cursor: imgUrl ? 'grab' : 'copy',
          background: dragOver ? 'rgba(51,144,255,0.12)' : 'transparent',
          outline: dragOver ? '2px dashed var(--cpd-color-bg-accent-rest, #3390ff)' : 'none',
          outlineOffset: -8,
          fontFamily: 'var(--tc-ui-font, inherit)',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) loadFile(f)
            e.target.value = ''
          }}
        />

        {!imgUrl && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              pointerEvents: 'none',
              textAlign: 'center',
              color: 'var(--cpd-color-text-secondary)',
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Drop an image here</div>
              <div style={{ fontSize: 12 }}>or click to choose a background</div>
            </div>
          </div>
        )}

        {imgUrl && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              fontSize: 11,
              color: 'var(--cpd-color-text-secondary)',
              background: 'rgba(0,0,0,0.35)',
              padding: '3px 10px',
              borderRadius: 999,
            }}
          >
            Drag to move {'·'} scroll to scale {'·'} arrows to nudge {'·'} T to transform
          </div>
        )}

        {/* Bottom-right: Cancel / Set Background. */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', gap: 8 }}
        >
          <FloatBtn onClick={onExit} disabled={busy}>
            Cancel
          </FloatBtn>
          <FloatBtn onClick={commit} disabled={!imgUrl || busy} accent>
            {busy ? 'Setting…' : 'Set Background'}
          </FloatBtn>
        </div>
      </div>
    </>
  )
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function FloatBtn({
  children,
  onClick,
  disabled,
  accent,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  accent?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid rgba(128,128,128,0.4)',
        background: accent ? 'var(--cpd-color-bg-accent-rest, #3390ff)' : 'var(--cpd-color-bg-canvas-default)',
        color: accent ? '#fff' : 'var(--cpd-color-text-primary)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
      }}
    >
      {children}
    </button>
  )
}
