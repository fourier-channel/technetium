// The goal ticker's feed (tc.155; canon docs/design/TC_PROVENANCE_MODE.md
// sec 6): horizon's milestones, read live from horizon's own status.json
// (operator, 2026-11-28, P4), one crawl item each.
//
// MILESTONES ONLY, ON PURPOSE. What a goal is (spec sec 8 question 6) is not
// answered: milestones only, or named row groups as well. A milestone is a
// goal under either answer, so that is what this shows until the answer comes;
// the groups half is added then, not guessed now.
//
// Every line is built from the export's own words (the milestone's name) and
// counts; the export carries Public lines only, so nothing here can quote
// anyone (memory public-surfaces-never-quote-the-developer).
//
// Pure: no DOM, no fetch. Loaded by checks/horizonFeed.check.ts.

import type { TickerItem } from '../ui/tickerSource'
import { HORIZON_URL } from './provenanceMode'

export const HORIZON_STATUS_URL = `${HORIZON_URL}status.json`
// How often the ticker asks again. Horizon changes when the roadmap does, a
// few times a day; five minutes keeps it fresh without asking every minute.
export const HORIZON_POLL_MS = 5 * 60_000

const MILESTONE_KEY = /^m\d{1,3}$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dueText(date: unknown): string {
  if (typeof date !== 'string') return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return ''
  const month = Number(m[2])
  if (month < 1 || month > 12) return ''
  return `, due ${Number(m[3])} ${MONTHS[month - 1]}`
}

function count(n: unknown): number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0
}

// A thrown error names what was wrong with the file and where it comes from,
// so the strip's failure line and the report both say something a person can
// act on (memory errors-must-carry-their-own-remedy).
export class HorizonShapeError extends Error {
  constructor(what: string) {
    super(`horizon's status file ${what}; it is written by fourier-basis tools/status-export.py`)
    this.name = 'HorizonShapeError'
  }
}

export function horizonTickerItems(json: unknown): TickerItem[] {
  if (typeof json !== 'object' || json === null || !Array.isArray((json as { groups?: unknown }).groups)) {
    throw new HorizonShapeError('has no list of groups')
  }
  const items: TickerItem[] = []
  for (const g of (json as { groups: unknown[] }).groups) {
    if (typeof g !== 'object' || g === null) continue
    const { key, name, date, items: rows, not_public, not_public_done } = g as Record<string, unknown>
    if (typeof key !== 'string' || !MILESTONE_KEY.test(key)) continue
    if (typeof name !== 'string' || !name.trim()) continue
    const list = Array.isArray(rows) ? rows : []
    const done = list.filter((r) => typeof r === 'object' && r !== null && (r as { status?: unknown }).status === 'done').length
      + count(not_public_done)
    const total = list.length + count(not_public)
    if (total === 0) continue
    const text = done === total
      ? `Done: ${name.trim()}`
      : `${name.trim()}: ${done} of ${total} done${dueText(date)}`
    items.push({ id: key, text, href: `${HORIZON_URL}#${key}` })
  }
  if (items.length === 0) throw new HorizonShapeError('lists no milestones')
  return items
}

// What the strip shows when a read fails. Loud, never blank and never a quiet
// stale run: the last good items stay, marked, behind a line that says what
// went wrong and when it will be tried again (operator, 2026-11-28, P4: a
// failed fetch fails loudly).
export function horizonFailureItems(reason: string, lastGood: readonly TickerItem[], retryMinutes: number): TickerItem[] {
  const again = `trying again in ${retryMinutes} minute${retryMinutes === 1 ? '' : 's'}`
  const head: TickerItem = {
    id: 'horizon-failed',
    text: lastGood.length
      ? `Horizon could not be read (${reason}); the goals below may be out of date, ${again}`
      : `Horizon could not be read (${reason}), so there are no goals to show; ${again}`,
  }
  return [head, ...lastGood]
}

// A failure, said in a few plain words for the strip: the status code, or
// what kind of thing went wrong. Never the address or the raw message.
export function horizonFailureReason(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status: unknown }).status
    if (typeof s === 'number' && Number.isInteger(s)) return `the server answered ${s}`
  }
  if (err instanceof HorizonShapeError) return 'its file was not in the expected shape'
  if (err instanceof SyntaxError) return 'its file was not readable'
  return 'no answer came back'
}
