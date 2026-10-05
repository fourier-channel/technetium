import { useSyncExternalStore } from 'react'

// ---------------------------------------------------------------------------
// A clock that components may read.
//
// `Date.now()` during render is impure: the same render can produce different
// output on a re-render nobody asked for, which is the rule the compiler
// enforces. But a card showing "4h 25m" genuinely needs the time, and needs it
// to tick.
//
// So the clock lives outside React and is read through a store. ONE interval
// for the whole app, started on the first subscriber and stopped after the
// last -- a timer per card would be dozens of them all firing to say the same
// thing.
//
// A minute, because the smallest unit any caller renders is a minute. Ticking
// faster would re-render every card to change nothing.
// ---------------------------------------------------------------------------

const TICK_MS = 60_000

let current = Date.now()
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (timer === undefined) {
    // Refreshed on the way in as well as on each tick: the module may have been
    // imported long before anything read the clock, and the first subscriber
    // should not be handed an hour-old value to look at for a minute.
    current = Date.now()
    timer = setInterval(() => {
      current = Date.now()
      for (const f of listeners) f()
    }, TICK_MS)
  }
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

function snapshot(): number {
  return current
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

// ---------------------------------------------------------------------------
// The same clock at one-second resolution, for the one surface that counts
// down in seconds: Manage session's token lives, where the access token lives
// five minutes and a minute's tick would show "4m" for a whole minute and
// then jump. Its own interval, started only while something reads it -- the
// panel is open -- so the minute clock's readers are never re-rendered every
// second for its sake.
// ---------------------------------------------------------------------------

let currentSecond = Date.now()
let secondTimer: ReturnType<typeof setInterval> | undefined
const secondListeners = new Set<() => void>()

function subscribeSecond(cb: () => void): () => void {
  secondListeners.add(cb)
  if (secondTimer === undefined) {
    currentSecond = Date.now()
    secondTimer = setInterval(() => {
      currentSecond = Date.now()
      for (const f of secondListeners) f()
    }, 1000)
  }
  return () => {
    secondListeners.delete(cb)
    if (secondListeners.size === 0 && secondTimer !== undefined) {
      clearInterval(secondTimer)
      secondTimer = undefined
    }
  }
}

function secondSnapshot(): number {
  return currentSecond
}

export function useNowEverySecond(): number {
  return useSyncExternalStore(subscribeSecond, secondSnapshot, secondSnapshot)
}
