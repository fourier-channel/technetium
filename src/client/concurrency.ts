// ---------------------------------------------------------------------------
// A concurrency limiter, for media fetches.
//
// Every picture is a JS fetch rather than an <img src>, because an <img> cannot
// send an Authorization header. That costs us the browser's own scheduling: it
// will not prioritise, defer, or cap them, so a timeline that paginates fifty
// images fires fifty requests at once and the six you are actually looking at
// queue behind the forty-four you are not.
//
// LIFO, not FIFO, and that is the whole design. Requests arrive in scroll
// order, so the MOST RECENT one is the likeliest to be on screen right now.
// Serving oldest-first means serving what the reader has already scrolled past
// before what is under their eyes -- which is precisely the complaint this
// exists to fix. Combined with a prefetch that only asks for what is near the
// viewport, the queue stays short enough that nothing starves.
//
// Pure and framework-free, so the harness can drive it with controllable
// promises (O-tp9).
// ---------------------------------------------------------------------------

export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>
  stats(): { active: number; waiting: number }
}

export function createLimiter(max: number): Limiter {
  const cap = Math.max(1, Math.floor(max))
  let active = 0
  const waiting: Array<() => void> = []

  function acquire(): Promise<void> {
    if (active < cap) {
      active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      waiting.push(resolve)
    })
  }

  function release(): void {
    // Hand the slot straight to the next waiter rather than freeing it and
    // re-acquiring: releasing first would let a task started in between jump
    // the queue, and `active` would briefly under-report.
    const next = waiting.pop()
    if (next) next()
    else active -= 1
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire()
      try {
        return await task()
      } finally {
        // finally, not a then: a task that throws must give its slot back, or
        // one failure permanently shrinks the pool and enough of them stop
        // media loading altogether.
        release()
      }
    },
    stats: () => ({ active, waiting: waiting.length }),
  }
}
