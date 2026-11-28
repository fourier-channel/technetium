// The ticker strip's data contract. The strip itself (Ticker.tsx) knows only
// this shape; WHAT crawls across it is whoever built the source's business.
// App.tsx hands <Ticker /> the one source the app uses: horizon's milestones.

import { reportIgnored } from '../client/report'
import {
  HORIZON_POLL_MS,
  HORIZON_STATUS_URL,
  horizonFailureItems,
  horizonFailureReason,
  horizonTickerItems,
} from '../client/horizonFeed'

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

/**
 * Horizon's milestones, read live (tc.155; client/horizonFeed.ts decides the
 * words). Unlike pollingTickerSource this one FAILS LOUDLY (operator,
 * 2026-11-28, P4): a failed read is reported and put on the strip itself,
 * ahead of the last good items, which are marked as possibly out of date.
 * Nothing is sent but the request: no cookie (credentials omitted), no
 * identity, and the file is public.
 */
export function horizonTickerSource(): TickerSource {
  return {
    subscribe(onItems) {
      let alive = true
      let lastGood: TickerItem[] = []
      const pull = async () => {
        try {
          const res = await fetch(HORIZON_STATUS_URL, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            credentials: 'omit',
          })
          if (!res.ok) throw Object.assign(new Error(`horizon status.json answered ${res.status}`), { status: res.status })
          const items = horizonTickerItems(await res.json())
          lastGood = items
          if (alive) onItems(items)
        } catch (err) {
          reportIgnored('ticker: horizon', err)
          if (alive) onItems(horizonFailureItems(horizonFailureReason(err), lastGood, Math.round(HORIZON_POLL_MS / 60_000)))
        }
      }
      void pull()
      const timer = setInterval(() => { void pull() }, HORIZON_POLL_MS)
      return () => {
        alive = false
        clearInterval(timer)
      }
    },
  }
}
