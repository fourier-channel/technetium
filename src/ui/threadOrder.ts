import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, UIEvent as ReactUIEvent, WheelEvent } from 'react'
import type { ThreadListItem } from '../client/useThreadList'
import { flipIdOf } from './flip'

// ---------------------------------------------------------------------------
// Auto-resort etiquette (D3): never reorder cards out from under the pointer.
//
// While the user is interacting with the list (pointer over it -- even parked
// and still -- or scrolling), the on-screen ORDER is frozen; only stats/pops
// update in place. After ~1.5s of idle the live data order is adopted, which
// the FLIP layer animates as a single shuffle.
//
// The freeze snapshot and its release are driven from EVENT HANDLERS and a
// timeout, never from an effect -- so no setState-in-effect and no ref reads
// during render (React Compiler lint discipline). The latest data order is
// mirrored into a ref by an effect (ref writes in effects are allowed) so the
// freeze handler can snapshot it without touching a ref during render.
// ---------------------------------------------------------------------------

const IDLE_MS = 1500

export interface IdleHandlers {
  onPointerEnter: (e: ReactPointerEvent) => void
  onPointerLeave: (e: ReactPointerEvent) => void
  onPointerMove: (e: ReactPointerEvent) => void
  onPointerDown: (e: ReactPointerEvent) => void
  onScroll: (e: ReactUIEvent) => void
  onWheel: (e: WheelEvent) => void
}

// Imperative interaction detector. Calls onActivate on the idle->active edge and
// onIdle on the active->idle edge. Holds no React state -- callers react through
// the callbacks (which must be stable). A parked pointer keeps it active until
// pointerleave starts the idle countdown.
function useInteractionIdle(
  onActivate: () => void,
  onIdle: () => void,
  idleMs = IDLE_MS,
): IdleHandlers {
  const hoveringRef = useRef(false)
  const activeRef = useRef(false)
  const timerRef = useRef<number | undefined>(undefined)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  const goActive = useCallback(() => {
    if (!activeRef.current) {
      activeRef.current = true
      onActivate()
    }
  }, [onActivate])

  const goIdle = useCallback(() => {
    if (activeRef.current) {
      activeRef.current = false
      onIdle()
    }
  }, [onIdle])

  const kick = useCallback(() => {
    goActive()
    clearTimer()
    if (!hoveringRef.current) {
      timerRef.current = window.setTimeout(goIdle, idleMs)
    }
  }, [goActive, goIdle, clearTimer, idleMs])

  useEffect(() => clearTimer, [clearTimer])

  return {
    onPointerEnter: () => {
      hoveringRef.current = true
      clearTimer()
      goActive()
    },
    onPointerLeave: () => {
      hoveringRef.current = false
      kick()
    },
    onPointerMove: kick,
    onPointerDown: kick,
    onScroll: kick,
    onWheel: kick,
  }
}

// Reorder `items` into the frozen order: known ids keep their captured slots
// (rebound to the latest item so stats/pops stay live), removed ids drop out,
// newly-arrived ids append at the end (repositioned once hold releases).
function applyFrozenOrder(items: ThreadListItem[], frozen: string[]): ThreadListItem[] {
  const byId = new Map<string, ThreadListItem>()
  for (const it of items) byId.set(flipIdOf(it.roomId, it.rootId), it)

  const result: ThreadListItem[] = []
  const placed = new Set<string>()
  for (const id of frozen) {
    const it = byId.get(id)
    if (it) {
      result.push(it)
      placed.add(id)
    }
  }
  for (const it of items) {
    if (!placed.has(flipIdOf(it.roomId, it.rootId))) result.push(it)
  }
  return result
}

// Arrange items by a user-defined custom order (drag-to-reorder). Ids present in
// `order` keep their arranged position; items NOT in `order` (newly-arrived
// threads) are placed at the TOP and reported as `newIds` so the UI can mark
// them "new" (O3). They stop being new once the user drags (which re-saves the
// order to include them).
export function arrangeByCustom(
  items: ThreadListItem[],
  order: string[],
): { items: ThreadListItem[]; newIds: Set<string> } {
  const byId = new Map<string, ThreadListItem>()
  for (const it of items) byId.set(flipIdOf(it.roomId, it.rootId), it)

  const known: ThreadListItem[] = []
  const placed = new Set<string>()
  for (const id of order) {
    const it = byId.get(id)
    if (it) {
      known.push(it)
      placed.add(id)
    }
  }
  const fresh: ThreadListItem[] = []
  const newIds = new Set<string>()
  for (const it of items) {
    const id = flipIdOf(it.roomId, it.rootId)
    if (!placed.has(id)) {
      fresh.push(it)
      newIds.add(id)
    }
  }
  return { items: [...fresh, ...known], newIds }
}

// Public hook: takes the live (data-order) items and returns the items to
// render plus the handlers to spread on the scroll container. Freezes order
// while interacting, releases (adopts live order) on idle.
export function useDeferredThreadOrder(items: ThreadListItem[]): {
  entries: ThreadListItem[]
  handlers: IdleHandlers
} {
  const [frozen, setFrozen] = useState<string[] | null>(null)
  const dataRef = useRef(items)
  useEffect(() => {
    dataRef.current = items
  })

  const freeze = useCallback(() => {
    setFrozen((prev) => prev ?? dataRef.current.map((it) => flipIdOf(it.roomId, it.rootId)))
  }, [])
  const release = useCallback(() => setFrozen(null), [])

  const handlers = useInteractionIdle(freeze, release)

  const entries = useMemo(
    () => (frozen === null ? items : applyFrozenOrder(items, frozen)),
    [items, frozen],
  )

  return { entries, handlers }
}
