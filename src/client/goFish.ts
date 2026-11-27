// ---------------------------------------------------------------------------
// Go-fish (CD-10): how this client degrades.
//
//   Ask the primary. If it fails, ask the single next likeliest. If that fails
//   too, fall back to a CATEGORICAL answer -- the safe, plain state the caller
//   names ("[image unavailable]", "not an admin", the caption text) -- log it
//   ONCE, and stop asking.
//
// Never a dead state (stuck forever with no retry and no fallback), never a
// loop (asking again until something gives), never a silent give-up (G-tc05:
// the fallback is reported at the moment it is taken).
//
// What lives here is the part that is the SAME wherever it appears:
//
//   withRetry   a bounded retry: an attempt, a few more after a growing wait,
//               then onGiveUp exactly once. Cancellable, so an effect cleanup
//               stops it.
//   asString    read a field that should be a string; anything else is the
//   asBool      caller's fallback / false. A malformed value is discarded,
//               never coerced and never thrown over.
//
// What does NOT live here, on purpose (D-tc01 shares FACTS, and these are
// different facts that happen to rhyme):
//
//   - serverAdmin.ts readAdminBody: three verdicts with a reason each, not a
//     value-or-fallback; the narrowing ("not saying" is not "admin") is the
//     point of the function.
//   - onboarding/assets.ts hasImage: a type guard over one slot. Its fallback
//     is the slot's own text, chosen by the caller's render.
//   - the 401 rule (media.ts, serverAdmin.ts, masSessions.ts, booruWrite.ts):
//     refresh the token ONCE and ask once more. One refresh is not a backoff,
//     and a second 401 is an answer, not a transient.
//   - withheldMedia.ts recheckDelay: rechecks a withheld picture forever at a
//     capped doubling. It has no give-up because "still withheld" is a state,
//     not a failure.
//   - lookStore.ts LOOK_RETRY_MS, useMediaTags' TTL: a cache that asks again
//     later is a freshness rule, not a retry.
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Attempts in all, the first included. 1 means no retry. */
  readonly maxAttempts: number
  /** The wait before the second attempt. */
  readonly baseDelayMs: number
  /** Each later wait is the previous one times this. Default 2; 1 is a fixed interval. */
  readonly factor?: number
}

/** The timer pair withRetry uses; injected by the check. */
export interface RetryTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const globalTimers: RetryTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/** The wait after the `failed`th failed attempt (1-based), or null when the budget is spent. */
export function retryDelay(failed: number, policy: RetryPolicy): number | null {
  if (failed >= policy.maxAttempts) return null
  return policy.baseDelayMs * (policy.factor ?? 2) ** (failed - 1)
}

export interface RetryRun<T> {
  /**
   * Resolves with the first attempt that succeeds. After a give-up, or after
   * cancel with nothing in flight, it never settles -- and it never rejects,
   * so nothing here can raise an unhandled rejection (G-tc04). An attempt
   * already in flight when cancel is called still resolves it: the caller is
   * the one who knows how to release what it holds (an object URL), so the
   * caller checks its own cancelled flag in `.then`.
   */
  readonly value: Promise<T>
  /** Stop: no further attempt, no onGiveUp. */
  cancel(): void
}

/**
 * Run `attempt`, and on failure run it again after retryDelay, up to
 * policy.maxAttempts in all. When the last one fails, call onGiveUp with its
 * error -- exactly once -- and stop. The caller's onGiveUp is where the
 * categorical fallback is set and the one report is made.
 */
export function withRetry<T>(
  attempt: () => Promise<T>,
  policy: RetryPolicy,
  onGiveUp: (err: unknown) => void,
  timers: RetryTimers = globalTimers,
): RetryRun<T> {
  let cancelled = false
  let timer: unknown
  let failed = 0
  let resolve!: (v: T) => void
  const value = new Promise<T>((r) => { resolve = r })

  const run = () => {
    timer = undefined
    let p: Promise<T>
    try {
      p = attempt()
    } catch (err) {
      p = Promise.reject(err)
    }
    p.then(resolve, (err: unknown) => {
      if (cancelled) return
      failed += 1
      const wait = retryDelay(failed, policy)
      if (wait === null) onGiveUp(err)
      else timer = timers.setTimeout(run, wait)
    })
  }
  run()

  return {
    value,
    cancel() {
      cancelled = true
      if (timer !== undefined) timers.clearTimeout(timer)
      timer = undefined
    },
  }
}

/** `x` when it is a string, else `fallback`. */
export function asString<F>(x: unknown, fallback: F): string | F {
  return typeof x === 'string' ? x : fallback
}

/** True only for the boolean true; anything else, "true" and 1 included, is false. */
export function asBool(x: unknown): boolean {
  return x === true
}
