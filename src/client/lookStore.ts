import type { MatrixClient } from 'matrix-js-sdk'
import { createLimiter } from './concurrency'
import { DEFAULT_LOOK, LOOK_FIELD, parseLook, sameLook, serializeLook, type Look } from './look'
import { reportIgnored } from './report'

// ---------------------------------------------------------------------------
// Everyone's look, as this client knows it (launch-polish L24).
//
// A look is read from the person's profile the first time they are drawn and
// kept for LOOK_TTL_MS; drawn again after that, it is read again. There is no
// push for a profile field, so that is how somebody else's change reaches this
// screen -- and opening their profile preview re-reads it at once.
//
// What this never does: guess. A person whose profile cannot be read, or who
// set nothing, is drawn with the default look. A server that does not share
// profile fields is recorded as such, the store stops asking, and the Profile
// panel says so rather than saving somewhere nobody else can see (no silent
// fallback -- memory fail-loudly-no-fallbacks).
//
// Pure apart from the IO handed in, so the check suite drives it with a stand-
// in server and a stand-in clock.
// ---------------------------------------------------------------------------

export const LOOK_TTL_MS = 10 * 60_000
// Profile reads in flight at once. A member list draws everyone in it, and
// this keeps that from being a burst.
export const LOOK_READS_AT_ONCE = 3
// After a read that failed for no stated reason (the network, a 500), how long
// before it is asked again: soon enough to recover, not so soon as to hammer.
export const LOOK_RETRY_MS = 60_000

export interface LookIO {
  // Whether the homeserver shares custom profile fields at all.
  supported(): Promise<boolean>
  // The raw field for one person, undefined when they have none.
  read(userId: string): Promise<unknown>
  // Write your own.
  write(value: Record<string, unknown>): Promise<void>
}

export type LookSupport = 'unknown' | 'yes' | 'no'

interface Entry {
  look: Look
  at: number
}

export interface LookStore {
  // The look to draw now: known, or the default. Stable identity until it
  // changes, so it can be a useSyncExternalStore snapshot.
  peek(userId: string): Look
  // Read it if it has never been read or has gone stale. Deduped; limited.
  want(userId: string): void
  // Read it now, whatever its age.
  refresh(userId: string): Promise<void>
  // Publish your own. Resolves when the server has it; rejects, having put
  // nothing in the cache, when it does not.
  publish(look: Look): Promise<void>
  support(): LookSupport
  subscribe(listener: () => void): () => void
  version(): number
}

function errcode(err: unknown): string | undefined {
  return (err as { errcode?: string } | null)?.errcode
}

export function createLookStore(
  io: LookIO,
  me: string | null,
  now: () => number = Date.now,
): LookStore {
  const known = new Map<string, Entry>()
  const inFlight = new Set<string>()
  const listeners = new Set<() => void>()
  const limiter = createLimiter(LOOK_READS_AT_ONCE)
  let support: LookSupport = 'unknown'
  let v = 0
  const changed = () => {
    v++
    for (const l of listeners) l()
  }

  const asked = io.supported().then(
    (yes) => {
      support = yes ? 'yes' : 'no'
      changed()
    },
    (err) => {
      // Not asked is not "no": reads are still attempted, and a read that
      // fails for this reason flips it below.
      reportIgnored('look: server support could not be asked', err)
    },
  )

  const remember = (userId: string, look: Look) => {
    const prev = known.get(userId)
    // Same look: keep the old object, so nothing redraws for a re-read that
    // changed nothing.
    known.set(userId, { look: prev && sameLook(prev.look, look) ? prev.look : look, at: now() })
    if (!prev || !sameLook(prev.look, look)) changed()
  }

  const read = async (userId: string) => {
    await asked
    if (support === 'no' || inFlight.has(userId)) return
    inFlight.add(userId)
    try {
      const raw = await limiter.run(() => io.read(userId))
      remember(userId, parseLook(raw))
    } catch (err) {
      const code = errcode(err)
      if (code === 'M_NOT_FOUND' || code === 'M_FORBIDDEN') {
        // No profile, or not one this account may read: the default, and that
        // is an answer, so it is remembered like one.
        remember(userId, DEFAULT_LOOK)
      } else if (err instanceof Error && /does not support extended profiles/i.test(err.message)) {
        support = 'no'
        changed()
      } else {
        // A failed read is not a look: whatever was drawn before stays drawn
        // (the default if nothing was), and it is asked again LOOK_RETRY_MS
        // from now rather than a whole TTL.
        reportIgnored('look: profile read', err)
        known.set(userId, { look: known.get(userId)?.look ?? DEFAULT_LOOK, at: now() - LOOK_TTL_MS + LOOK_RETRY_MS })
      }
    } finally {
      inFlight.delete(userId)
    }
  }

  return {
    peek: (userId) => known.get(userId)?.look ?? DEFAULT_LOOK,
    want(userId) {
      const e = known.get(userId)
      if (e && now() - e.at < LOOK_TTL_MS) return
      void read(userId)
    },
    refresh: (userId) => read(userId),
    async publish(look) {
      await asked
      if (support === 'no') throw new Error('This server does not share profile fields, so a look saved here would be seen by nobody.')
      await io.write(serializeLook(look))
      if (me) remember(me, look)
    },
    support: () => support,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    version: () => v,
  }
}

// The SDK's profile-field calls. Only the client's TYPE is imported, so a
// check can hand this a stand-in.
export function lookIO(client: MatrixClient): LookIO {
  return {
    supported: () => client.doesServerSupportExtendedProfiles(),
    async read(userId) {
      // The whole profile rather than the one field: the SDK caches a single
      // field read in its store and never asks again, which would freeze
      // somebody's look at whatever it was first seen as.
      const profile = await client.getExtendedProfile(userId)
      return (profile as Record<string, unknown>)[LOOK_FIELD]
    },
    write: (value) => client.setExtendedProfileProperty(LOOK_FIELD, value),
  }
}
