import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { accountDataEcho } from '../client/accountDataEcho'
import { DEFAULT_VIEWPORT, damagedByPhone, defaultSpace, deserialize, isMomentary, reflow, serialize, setViewport, type Space, type Viewport } from './space'
import { isMobileBrowser, startingCode, type LayoutStore } from './presets'
import { LAYOUT_ECHO } from './layoutEcho'

// The space, held in ACCOUNT DATA as its number, so it follows the user
// across devices and sessions and can be pasted into another client. Written
// through echoSync like the ticker's collapse state (tc.110); what is stored
// and what a failure means are in layoutEcho.ts.

declare module 'matrix-js-sdk' {
  interface AccountDataEvents {
    'net.41chan.tc.layout': Record<string, unknown>
  }
}

// Is this device phone-shaped? Asked of the browser, not of the window: a
// desktop with a narrow window is not a phone and must not silently adopt the
// Mobile preset (operator ruling 2026-09-06).
export function deviceIsMobile(): boolean {
  if (typeof window === 'undefined') return false
  const coarse = (() => {
    try { return window.matchMedia?.('(pointer: coarse)').matches ?? false } catch { return false }
  })()
  return isMobileBrowser({ ua: navigator?.userAgent, coarsePointer: coarse, width: window.innerWidth })
}

// The store as this tab holds it: what the server said, or what this tab has
// asked it to say and is waiting to hear back.
export function readLayoutStore(client: MatrixClient | null): LayoutStore {
  return client ? accountDataEcho(client, LAYOUT_ECHO).sync.snapshot() : LAYOUT_ECHO.empty
}

// The screen this tab is actually on. Minimums are pixels (space.ts), so a
// layout means nothing until it is read against a viewport.
export function currentViewport(): Viewport {
  if (typeof window === 'undefined') return DEFAULT_VIEWPORT
  return { w: window.innerWidth || DEFAULT_VIEWPORT.w, h: window.innerHeight || DEFAULT_VIEWPORT.h }
}

// The layout as the user designed it, untouched by this screen.
export function readStored(store: LayoutStore, vp: Viewport = currentViewport()): Space {
  // Which layout this device opens on: its own preset if one is pointed at it,
  // then the default preset, then the last live layout.
  const code = startingCode(store, deviceIsMobile())
  // A number that does not parse is treated as absent, never as a partial
  // layout: the default is a known-good screen and a corrupt code is not.
  // A v1 number (the earlier one-axis model) is refused by deserialize and
  // reads as the default, which is the honest answer to a superseded shape.
  const stored = typeof code === 'string' ? deserialize(code, vp) : null
  // One panel open means a phone saved its momentary view (space.ts
  // damagedByPhone, 2026-09-29): on a screen that holds more, open the
  // default instead. Not written back -- the next real edit saves over it.
  if (stored && damagedByPhone(stored)) return setViewport(defaultSpace(), vp)
  return stored || setViewport(defaultSpace(), vp)
}

// What THIS screen can show of it. A layout designed on a desktop routinely
// arrives on a phone; the stored number is never rewritten to match.
export function readSpace(store: LayoutStore, vp: Viewport = currentViewport()): Space {
  return reflow(readStored(store, vp))
}

export type SpaceUpdate = Space | ((prev: Space) => Space)

export interface StoredSpace {
  space: Space
  // A change to the layout. Saved -- unless it is only this screen's view
  // (space.ts isMomentary: a phone's one panel up, and back), which shows
  // and is never written.
  setSpace: (u: SpaceUpdate) => void
  adaptSpace: (u: SpaceUpdate) => void
  // A whole layout the user picked (import, preset, reset, revert): THAT is
  // saved, and this screen shows what it can of it. Saving the reflowed
  // result instead handed a phone's shed layout to every other device.
  chooseSpace: (s: Space) => void
  store: LayoutStore
  // Change the named layouts / device defaults / overflow mode. The live
  // layout's own number is filled in on save, so callers never touch `code`.
  setStore: (next: LayoutStore) => void
}

const noSubscribe = () => () => {}
const noStore = () => LAYOUT_ECHO.empty

export function useStoredSpace(client: MatrixClient | null): StoredSpace {
  const echo = client ? accountDataEcho(client, LAYOUT_ECHO) : null
  // The store -- presets, device defaults, overflow, the live number -- is
  // echoSync's: what the server holds, or what this tab asked for and has not
  // yet heard back.
  const store = useSyncExternalStore(
    echo ? echo.subscribe : noSubscribe,
    echo ? echo.sync.snapshot : noStore,
    echo ? echo.sync.snapshot : noStore,
  )
  const [layout, setLayoutState] = useState<Space>(() => readSpace(store))
  // The latest layout, for updaters: a drag fires many deltas between renders,
  // and each must apply to the result of the last, not to a stale closure.
  const latest = useRef(layout)
  useEffect(() => {
    latest.current = layout
  }, [layout])

  // The live number this tab last asked the server for, or last took from it.
  // A stored number equal to it is not news. Without this, a drag -- many
  // changes, each saved -- had earlier saves' echoes landing mid-drag and
  // overwriting local state with a stale, quantised value; the next step then
  // applied to that base, and the drag lost ground at random (measured: the
  // same 120 px drag moved 69 px in one run and 20 px in the next). Any other
  // number is news: another device, or this tab's own failed save, which
  // echoSync has undone and reported, so the layout goes back with it.
  const known = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // What the USER chose, as distinct from what this screen can show of it.
  // Only this is ever saved. Without the split, opening the app on a phone
  // would shed panels to fit, save the shed result, and destroy the layout
  // the user built on their desktop -- the account data is one code shared by
  // every device. (Per-form-factor presets are the next piece of work; until
  // they land, a user EDIT made on a small screen does still save, because
  // that is a choice rather than an adaptation.)
  const chosen = useRef<Space>(readStored(store))

  useEffect(() => {
    if (!client) return
    const live = accountDataEcho(client, LAYOUT_ECHO)
    const take = (always: boolean) => {
      const s = live.sync.snapshot()
      if (!always && s.code === known.current) return
      known.current = s.code
      chosen.current = readStored(s)
      const l = reflow(chosen.current)
      latest.current = l
      setLayoutState(l)
    }
    const off = live.subscribe(() => take(false))
    // Re-seed once mounted: the first render may have run before the client
    // (or its first sync) existed. Deferred, per the no-sync-setState-in-effect
    // rule.
    queueMicrotask(() => take(true))
    return off
  }, [client])

  const setLayout = (u: SpaceUpdate) => {
    const prev = latest.current
    const l = typeof u === 'function' ? u(prev) : u
    latest.current = l
    setLayoutState(l)
    // A phone's view of the layout, not a change to it: shown, never saved,
    // and the layout the user chose stays what it was.
    if (isMomentary(prev, l)) return
    chosen.current = l
    save()
  }
  const chooseLayout = (s: Space) => {
    chosen.current = s
    const l = reflow(setViewport(s, currentViewport()))
    latest.current = l
    setLayoutState(l)
    save()
  }
  const save = () => {
    if (!echo) return
    // Saved once the changes stop, not on every step of a drag: a drag is
    // dozens of changes a second and one number at the end. echoSync then
    // keeps one write in flight and sends the latest number when it can.
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      const code = serialize(chosen.current)
      known.current = code
      echo.sync.update((cur) => ({ ...cur, code }))
    }, 400)
  }
  // Adapt to this screen WITHOUT writing back: the viewport changed, or a
  // stored layout arrived that this screen cannot show whole.
  const adaptLayout = (u: SpaceUpdate) => {
    const l = typeof u === 'function' ? u(latest.current) : u
    latest.current = l
    setLayoutState(l)
  }

  // The screen. Minimums are pixels (space.ts), so what fits changes with the
  // window and the rendered layout is re-derived from what the user CHOSE --
  // never from the last adapted one. Deriving from the adapted layout would
  // make shedding one-way: narrow the window and widen it again, and the
  // panels would be gone for the rest of the session even though the layout
  // they came from is still sitting in account data, intact.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const apply = () => {
      const l = reflow(setViewport(chosen.current, currentViewport()))
      latest.current = l
      setLayoutState(l)
    }
    const onResize = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(apply, 150)
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // Presets and settings save at once: they are deliberate acts, not the
  // dozens-per-second stream a drag produces, and losing one to a debounce
  // that never fired would be silent. They carry the live number with them.
  const setStore = (next: LayoutStore) => {
    if (!echo) return
    const code = serialize(chosen.current)
    known.current = code
    echo.sync.update(() => ({ ...next, code }))
  }

  return { space: layout, setSpace: setLayout, adaptSpace: adaptLayout, chooseSpace: chooseLayout, store, setStore }
}
