import { useSyncExternalStore } from 'react'

// ---------------------------------------------------------------------------
// What a squirt leaves behind.
//
// Droplets live ON THE ROW (D-in10), keyed by the event id of the message that
// was hit. Not on the interaction overlay: that layer resolves its anchors ONCE
// and holds them, deliberately, so a persistent mark there would have to
// re-resolve on every scroll -- which is the exact cost the overlay exists to
// avoid. On the row, they scroll with it for free and cannot drift.
//
// D-in08 amends "ephemeral means ephemeral": nothing is ever reconstructed from
// history. A live effect may outlive its animation, but once it is gone it never
// comes back -- so a room's scrollback never rains on anyone, and joining a room
// never replays a week of water.
//
// The primary target stays wet about three times as long as a bystander, then
// both dry by breaking up and drifting off rather than blinking out.
// ---------------------------------------------------------------------------

export type DrenchLevel = 'primary' | 'secondary'

export interface Drench {
  level: DrenchLevel
  /** In its final moments: the droplets are rising and fading. */
  drying: boolean
}

const SOAK_MS: Record<DrenchLevel, number> = {
  primary: 10_000,
  secondary: 3_500,
}
/** How long the breaking-up animation runs. Must match the CSS. */
export const DRY_MS = 1_200

// Objects are replaced only when the state actually changes, never rebuilt on
// read: useSyncExternalStore compares snapshots by identity, and a fresh object
// per read is an infinite render loop.
const wet = new Map<string, Drench>()
const timers = new Map<string, ReturnType<typeof setTimeout>[]>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const cb of listeners) cb()
}

function clearTimers(rowId: string): void {
  for (const t of timers.get(rowId) ?? []) clearTimeout(t)
  timers.delete(rowId)
}

export function clearDrench(rowId: string): void {
  if (!wet.has(rowId) && !timers.has(rowId)) return
  clearTimers(rowId)
  wet.delete(rowId)
  emit()
}

export function soak(rowId: string, level: DrenchLevel): void {
  const existing = wet.get(rowId)
  // A bystander caught twice does not get drier, and a bystander who is then
  // hit properly is upgraded. Never downgrade: being splashed after being
  // soaked should not cut the soaking short.
  if (existing?.level === 'primary' && level === 'secondary') return

  clearTimers(rowId)
  wet.set(rowId, { level, drying: false })

  const soakMs = SOAK_MS[level]
  const t1 = setTimeout(() => {
    const cur = wet.get(rowId)
    if (!cur) return
    wet.set(rowId, { level: cur.level, drying: true })
    emit()
  }, soakMs)
  const t2 = setTimeout(() => {
    clearTimers(rowId)
    wet.delete(rowId)
    emit()
  }, soakMs + DRY_MS)
  timers.set(rowId, [t1, t2])
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useDrench(rowId: string): Drench | null {
  return useSyncExternalStore(
    subscribe,
    () => wet.get(rowId) ?? null,
    () => null,
  )
}

/** For diagnostics and checks: how many rows are currently wet. */
export function drenchCount(): number {
  return wet.size
}
