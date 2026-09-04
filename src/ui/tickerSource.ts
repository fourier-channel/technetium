// The ticker strip's data contract. The strip itself (Ticker.tsx) knows only
// this shape; WHAT crawls across it is whoever built the source's business.
// MVP ships the mechanism with a placeholder source -- point a real one at a
// data endpoint by swapping the source handed to <Ticker /> in App.tsx.

export type TickerItem = {
  /** Stable identity within one delivery; keys the rendered run. */
  id: string
  text: string
  /** Optional destination; an item without one renders as plain text. */
  href?: string
}

export type TickerSource = {
  /**
   * Deliver the current items now and again on every change. Returns the
   * unsubscribe. The strip renders whatever was delivered last, so a source
   * that goes quiet leaves its final delivery crawling rather than blanking
   * the strip.
   */
  subscribe(onItems: (items: TickerItem[]) => void): () => void
}

/** A fixed run of items: delivered once, never changes. */
export function staticTickerSource(items: TickerItem[]): TickerSource {
  return {
    subscribe(onItems) {
      onItems(items)
      return () => {}
    },
  }
}

/**
 * Poll a JSON endpoint and map each response to items. A failed or non-OK
 * fetch delivers nothing -- the last good items stay on screen -- so a
 * flaky source degrades to stale, never to blank.
 *
 * The eventual "top 10 tags of the last hour" wiring is one line:
 *
 *   pollingTickerSource("/api/ticker/top-tags", 60_000, (json) =>
 *     (json as { tags: string[] }).tags.map((t, i) => ({ id: `${i}:${t}`, text: t })))
 */
export function pollingTickerSource(
  url: string,
  intervalMs: number,
  map: (json: unknown) => TickerItem[],
): TickerSource {
  return {
    subscribe(onItems) {
      let alive = true
      const pull = async () => {
        try {
          const res = await fetch(url, { headers: { Accept: 'application/json' } })
          if (!res.ok) return
          const items = map(await res.json())
          if (alive) onItems(items)
        } catch {
          // Stale beats blank; the next tick tries again.
        }
      }
      void pull()
      const timer = setInterval(() => { void pull() }, intervalMs)
      return () => {
        alive = false
        clearInterval(timer)
      }
    },
  }
}

/** The MVP's stand-in: obviously placeholder, exercising the mechanism. */
export const placeholderTickerSource: TickerSource = staticTickerSource([
  { id: 'p0', text: 'TICKER ONLINE -- awaiting a data source' },
  { id: 'p1', text: 'top tags of the last hour will crawl here' },
  { id: 'p2', text: '#1 placeholder' },
  { id: 'p3', text: '#2 sample_tag' },
  { id: 'p4', text: '#3 mechanism_test' },
  { id: 'p5', text: 'swap placeholderTickerSource for pollingTickerSource when the endpoint exists' },
])
