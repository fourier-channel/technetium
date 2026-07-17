import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { SelectionOverlay } from './SelectionOverlay'
import { TransformButtons } from './TransformButtons'
import { defaultUiTransformConfig, type UiTransformConfig } from './config'
import {
  boxToTransform,
  clampTransform,
  mirrorH,
  mirrorV,
  resizeBox,
  snapAspect,
  transformToBox,
  type Box,
  type HandleId,
  type Transform,
} from './transform'

// ---------------------------------------------------------------------------
// TransformEditor: the portable "manipulate this element" harness. It is a
// CONTROLLED chrome layer -- the host owns the Transform and renders the target;
// this draws the selection + handles + action strip over the target's projected
// box and reports transform changes back via onChange. Handle-drags, mirrors and
// aspect-snap flow through an internal undo history (Oops). Cancel restores the
// transform captured at entry; Apply keeps the current one. Rotation is modelled
// but has no handle in v1 (resize math assumes rotation 0).
// ---------------------------------------------------------------------------

export function TransformEditor({
  transform,
  onChange,
  naturalAspect,
  getRect,
  onCancel,
  onApply,
  config = defaultUiTransformConfig,
}: {
  transform: Transform
  onChange: (t: Transform) => void
  naturalAspect: number
  // Host-provided accessor for the target's rect (keeps the module free of any
  // React ref / element-type coupling -- portable for fourier-transform).
  getRect: () => DOMRect | null
  onCancel: () => void
  onApply: () => void
  config?: UiTransformConfig
}) {
  const entryRef = useRef(transform)
  const historyRef = useRef<Transform[]>([])
  const tRef = useRef(transform)
  useEffect(() => {
    tRef.current = transform
  }, [transform])

  const [aspectLocked, setAspectLocked] = useState(false)
  const aspectLockedRef = useRef(aspectLocked)
  useEffect(() => {
    aspectLockedRef.current = aspectLocked
  }, [aspectLocked])

  // Project the transform onto a pixel box for the chrome (recomputed on change
  // and on host resize). One-frame lag behind onChange is imperceptible.
  const [box, setBox] = useState<Box | null>(null)
  useEffect(() => {
    const recompute = () => {
      const r = getRect()
      if (!r) return
      setBox(transformToBox(tRef.current, r.width, r.height, naturalAspect))
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [transform, naturalAspect, getRect])

  const apply = (next: Transform) => {
    historyRef.current.push(tRef.current)
    onChange(clampTransform(next))
  }
  const undo = () => {
    const prev = historyRef.current.pop()
    if (prev) onChange(prev)
  }
  const reset = () => {
    historyRef.current = []
    onChange(entryRef.current)
  }

  const onToggleAspect = () => {
    const next = !aspectLocked
    setAspectLocked(next)
    if (next) apply(snapAspect(tRef.current)) // enabling snaps back to natural
  }

  const onHandleDown = (id: HandleId, e: ReactPointerEvent) => {
    const rect = getRect()
    if (!rect) return
    const base = tRef.current
    const startBox = transformToBox(base, rect.width, rect.height, naturalAspect)
    historyRef.current.push(base) // whole drag == one undo step
    e.preventDefault()
    const onMove = (me: PointerEvent) => {
      const px = me.clientX - rect.left
      const py = me.clientY - rect.top
      const nb = resizeBox(startBox, id, px, py, aspectLockedRef.current, naturalAspect)
      onChange(boxToTransform(nb, base, rect.width, rect.height))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <>
      {box && <SelectionOverlay box={box} config={config} onHandleDown={onHandleDown} />}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 72 }}
      >
        <TransformButtons
          config={config}
          aspectLocked={aspectLocked}
          onOops={undo}
          onOopsReset={reset}
          onMirrorH={() => apply(mirrorH(tRef.current))}
          onMirrorV={() => apply(mirrorV(tRef.current))}
          onToggleAspect={onToggleAspect}
          onCancel={() => {
            onChange(entryRef.current)
            onCancel()
          }}
          onApply={onApply}
        />
      </div>
    </>
  )
}
