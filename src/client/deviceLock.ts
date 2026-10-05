// ---------------------------------------------------------------------------
// One tab per device: the lock that lets encryption be on for everyone.
//
// WHY. Every tab of this browser resumes the same stored sign-in, so every tab
// is the same DEVICE and opens the same encryption store. Nothing in
// matrix-js-sdk 41.6 or its crypto engine stops two tabs running that engine
// at once (searched, 2026-10-05), and two engines writing one store overwrite
// each other's one-time keys and session state: messages sent to this device
// in that window can become unreadable for good. Element Web stops it with a
// one-tab lock; so does this (operator, 2026-10-05: "If the one-tab lock is
// the shape that works, we'll use it").
//
// A second tab cannot simply run WITHOUT encryption, either: the SDK attaches
// the to-device channel to sliding sync whatever else is configured
// (sliding-sync-sdk.js registers ExtensionToDevice unconditionally), and a tab
// with no engine would receive this device's room keys and throw them away.
// So the tab without the lock starts NO client at all, and says why.
//
// THE MECHANISM is the browser's Web Locks API, one exclusive lock per user
// and device:
//
//   - a tab asks with `ifAvailable`; held elsewhere, it is told at once
//     ('busy') and shows the busy screen with "Use it here";
//   - "Use it here" asks with `steal`: the browser hands this tab the lock and
//     REJECTS the holder's request with an AbortError, which is how the first
//     tab learns it lost it (onLost). The first tab stops its client, then
//     says so on a BroadcastChannel; the new tab waits for that word (up to
//     ackTimeoutMs -- a frozen or closed tab never sends it, and runs nothing)
//     before it starts its own engine, so the two never overlap;
//   - logging out releases it.
//
// A browser without Web Locks ('unsupported') runs as before, unguarded, and
// the caller says so in the console with the remedy. Every browser this site
// supports has them (Chrome 69, Firefox 96, Safari 15.4).
//
// Pure apart from the LockManager and channel handed in, so the checks drive
// it with a model of the API, and tools/visual/devicelock.html drives it with
// the real one.
// ---------------------------------------------------------------------------

export const DEVICE_LOCK_CHANNEL = 'tc-device-lock'
export const ACK_TIMEOUT_MS = 2000

export function deviceLockName(userId: string, deviceId: string): string {
  return `tc-device::${userId}::${deviceId}`
}

export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>
  query?(): Promise<{ held?: { name?: string }[] }>
}

export interface ChannelLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
  close(): void
}

export type DeviceLockOutcome =
  | { kind: 'held'; release: () => void }
  | { kind: 'busy' }
  | { kind: 'unsupported'; why: string }

export interface AcquireOptions {
  locks: LockManagerLike | undefined
  name: string
  // "Use it here": take the lock from whichever tab holds it.
  steal: boolean
  // The lock was taken by another tab. Stop everything that uses the device,
  // synchronously; the stop is announced as soon as this returns.
  onLost: () => void
  openChannel?: () => ChannelLike | null
  ackTimeoutMs?: number
  // For the checks: a timer they can run instantly.
  wait?: (ms: number, until: Promise<void>) => Promise<void>
}

const stoppedMessage = (name: string) => ({ type: 'stopped', name })
const isStopped = (data: unknown, name: string) =>
  !!data && typeof data === 'object' && (data as { type?: unknown }).type === 'stopped' && (data as { name?: unknown }).name === name

function defaultWait(ms: number, until: Promise<void>): Promise<void> {
  return Promise.race([until, new Promise<void>((r) => setTimeout(r, ms))])
}

export async function acquireDeviceLock(o: AcquireOptions): Promise<DeviceLockOutcome> {
  if (!o.locks || typeof o.locks.request !== 'function') return { kind: 'unsupported', why: 'this browser has no Web Locks' }

  // Who holds it now, before stealing: only then is there a tab whose stop
  // is worth waiting for.
  let heldElsewhere = true
  if (o.steal && o.locks.query) {
    try {
      const q = await o.locks.query()
      heldElsewhere = !!q.held?.some((l) => l.name === o.name)
    } catch {
      heldElsewhere = true
    }
  }

  // Listen BEFORE stealing: the old tab's word can arrive within the same tick.
  let channel: ChannelLike | null = null
  let heardStop: () => void = () => {}
  const stopped = new Promise<void>((r) => { heardStop = r })
  const onMessage = (ev: { data: unknown }) => { if (isStopped(ev.data, o.name)) heardStop() }
  if (o.steal && heldElsewhere) {
    try {
      channel = o.openChannel?.() ?? null
      channel?.addEventListener('message', onMessage)
    } catch {
      channel = null
    }
  }

  let release: () => void = () => {}
  const released = new Promise<void>((r) => { release = r })
  let isHeld = false
  let isReleased = false
  let grant: (held: boolean) => void = () => {}
  const granted = new Promise<boolean>((r) => { grant = r })

  let request: Promise<unknown>
  try {
    request = o.locks.request(o.name, o.steal ? { steal: true } : { ifAvailable: true }, (lock) => {
      if (!lock) {
        grant(false)
        return undefined
      }
      isHeld = true
      grant(true)
      // Held for as long as this promise is pending: until logout releases
      // it, or another tab steals it.
      return released
    })
  } catch (err) {
    channel?.close()
    return { kind: 'unsupported', why: err instanceof Error ? err.message : String(err) }
  }
  request.then(
    () => {},
    (err: unknown) => {
      // Rejected while held and not released by us: stolen. Rejected before
      // it was ever granted: the request itself failed.
      if (isHeld && !isReleased) {
        isReleased = true
        o.onLost()
        try {
          const c = o.openChannel?.() ?? null
          c?.postMessage(stoppedMessage(o.name))
          c?.close()
        } catch {
          // Nobody to tell is no worse than a closed tab: the new holder
          // waits ackTimeoutMs and goes on.
        }
      } else if (!isHeld) {
        grant(false)
        void err
      }
    },
  )

  const held = await granted
  if (!held) {
    channel?.close()
    // A failed request is not "busy": nobody else is known to hold it.
    return o.steal ? { kind: 'unsupported', why: 'the browser refused the lock' } : { kind: 'busy' }
  }
  if (o.steal && heldElsewhere) {
    await (o.wait ?? defaultWait)(o.ackTimeoutMs ?? ACK_TIMEOUT_MS, stopped)
  }
  if (channel) {
    channel.removeEventListener('message', onMessage)
    channel.close()
  }
  return {
    kind: 'held',
    release: () => {
      if (isReleased) return
      isReleased = true
      release()
    },
  }
}

// What a tab without the lock says. Two cases, one shape: this tab never got
// the device ('busy'), or had it and gave it up to another ('taken').
export type DeviceElsewhere = 'busy' | 'taken'

export function deviceElsewhereCopy(state: DeviceElsewhere): { title: string; body: string; action: string } {
  return state === 'busy'
    ? {
        title: 'Technetium is open in another tab',
        body:
          'Another tab of this browser is using this device and its encryption keys, and only one tab can at a time -- two at once can leave messages unreadable. Use that tab, or use this one instead; the other tab stops.',
        action: 'Use it here',
      }
    : {
        title: 'Technetium moved to another tab',
        body:
          'Another tab of this browser took over this device and its encryption keys, so this tab stopped. Nothing was lost. Use that tab, or bring Technetium back to this one; the other tab stops.',
        action: 'Use it here',
      }
}
