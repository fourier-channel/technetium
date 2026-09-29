import { useEffect, useRef } from 'react'

// ---------------------------------------------------------------------------
// The browser's Back button (operator, 2026-09-29): "someone hitting 'back'
// on their phone will go back to auth.41chan.net and error out"; "Back should
// not leave"; "Back should function as 'back' does in any other application."
//
// So Back walks back through where the user has BEEN in the client -- the
// room before this one (the booru counts as a place), a thread they opened, a
// list or DM that filled a phone's screen -- and at the first place it
// stays. It never reaches the page before the client, which in a signed-in
// tab is MAS's login or consent page for a grant already spent.
//
// Each place is a VIEW. The client keeps its own stack of them, and each
// history entry it pushes carries only its index ({ tc: 'view', i }). Moving
// to a new view pushes; moving to the view just behind this one (a panel put
// away by its tab, the Back tab on a phone) is a history.back(), exactly as
// if Back had been pressed, so the next Back does not reopen it. Landing
// below the first view -- the base entry the OIDC callback left -- puts the
// first entry straight back and stays.
//
// The first entry is pushed on the first tap: Chromium skips entries pushed
// without a user gesture. A re-push from Back itself has no gesture, so every
// later tap re-arms it as well.
// ---------------------------------------------------------------------------

export interface View {
  /** The room in the main pane; null is the booru. */
  room: string | null
  /** The panel filling a phone's screen (not the thread), or null. */
  panel: string | null
  /** The open thread, as "roomId rootId", or null. */
  thread: string | null
}

export interface Nav {
  stack: View[]
  /** Index of the current view in `stack`; -1 before the first tap. */
  i: number
}

export const sameView = (a: View, b: View) => a.room === b.room && a.panel === b.panel && a.thread === b.thread

export type Step = { kind: 'none' } | { kind: 'back'; nav: Nav } | { kind: 'push'; nav: Nav }

/** Moving to `v`: nothing, a step back, or a new entry. Pure. */
export function navigate(nav: Nav, v: View): Step {
  if (nav.i < 0) return { kind: 'none' }
  if (sameView(nav.stack[nav.i], v)) return { kind: 'none' }
  if (nav.i > 0 && sameView(nav.stack[nav.i - 1], v)) return { kind: 'back', nav: { stack: nav.stack, i: nav.i - 1 } }
  const stack = [...nav.stack.slice(0, nav.i + 1), v]
  return { kind: 'push', nav: { stack, i: stack.length - 1 } }
}

/**
 * Back (or Forward) landed on an entry. Its index, or null for an entry that
 * is not ours -- the base below the first view. Returns the view to show
 * (null: nothing to change) and whether to put the first entry back. Pure.
 */
export function landOn(nav: Nav, index: number | null): { nav: Nav; show: View | null; rearm: boolean } {
  if (index === null || index < 0 || index >= nav.stack.length) {
    return { nav, show: null, rearm: nav.i >= 0 }
  }
  return { nav: { stack: nav.stack, i: index }, show: nav.stack[index], rearm: false }
}

function entryIndex(): number | null {
  const s = history.state as { tc?: unknown; i?: unknown } | null
  return s && s.tc === 'view' && typeof s.i === 'number' ? s.i : null
}

/** Wire Back for a signed-in client: `view` is where the user is now. */
export function useBackButton(active: boolean, view: View, apply: (v: View) => void): void {
  const nav = useRef<Nav>({ stack: [], i: -1 })
  const current = useRef(view)
  const applyRef = useRef(apply)
  // While Back is restoring a view, the intermediate renders on the way are
  // not navigation.
  const restoring = useRef<{ to: View; until: number } | null>(null)

  useEffect(() => {
    applyRef.current = apply
  }, [apply])

  // The first entry, on a gesture -- and again after Back used it up.
  useEffect(() => {
    if (!active) return
    const arm = () => {
      if (nav.current.i < 0) nav.current = { stack: [current.current], i: 0 }
      if (entryIndex() === null) history.pushState({ tc: 'view', i: nav.current.i }, '')
    }
    window.addEventListener('pointerdown', arm, { capture: true })
    window.addEventListener('keydown', arm, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', arm, { capture: true })
      window.removeEventListener('keydown', arm, { capture: true })
    }
  }, [active])

  const key = `${view.room}\u0000${view.panel}\u0000${view.thread}`
  useEffect(() => {
    current.current = view
    if (!active) return
    const r = restoring.current
    if (r) {
      if (sameView(r.to, view) || performance.now() > r.until) restoring.current = null
      return
    }
    const step = navigate(nav.current, view)
    if (step.kind === 'none') return
    nav.current = step.nav
    if (step.kind === 'back') history.back()
    else history.pushState({ tc: 'view', i: step.nav.i }, '')
    // `view` is read through `key`; the object is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key])

  useEffect(() => {
    if (!active) return
    const onPop = () => {
      const r = landOn(nav.current, entryIndex())
      nav.current = r.nav
      if (r.rearm) history.pushState({ tc: 'view', i: nav.current.i }, '')
      if (r.show && !sameView(r.show, current.current)) {
        restoring.current = { to: r.show, until: performance.now() + 1000 }
        applyRef.current(r.show)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [active])
}
