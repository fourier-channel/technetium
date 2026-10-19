// Bulk update requests (BURs), read and decided as the viewer.
//
// HOW ONE ARRIVES. Somebody with Voice (+) or higher in #botsbotsbots types
// `!bur <reason>` and a script; Neru-chan files it on the booru under her own
// account and replies with the BUR's id under net.41chan.bur (fourier-tunnel
// capabilities/bur.js, operator 2026-10-19). That key is a POINTER, the same
// shape as net.41chan.media.tags' post_id: everything the card shows is read
// live from the booru, so its status is never a copy that went stale.
//
// WHO DECIDES. An admin, as THEMSELVES, through the booru session cookie --
// the same write path as a tag edit (booruTags.ts writeBooruTags): a simple
// POST with the CSRF token in the body, so no preflight is sent for the
// booru's Caddy rule to refuse. The booru's own policy then applies: approving
// needs the level the script's lines need (ADMIN for nearly all of them on
// this fork), rejecting needs admin or the BUR's creator. Nothing here
// approves on anyone's behalf.
//
// WHAT THE CARD OFFERS is the booru's per-viewer can_approve / can_reject
// (chanbooru ca05bee43, 2026-10-19), from the same policy its actions enforce.
// They mean "may attempt", so a refusal is still handled and said. Only a
// booru too old to send them falls back to the viewer's own level from
// /profile.json. A button that 403s is worse than no button (powerLevels.ts).
//
// THE CONTRACT is the booru's, recorded here so the card reads exactly it:
// status pending|processing|approved|partial|failed|rejected (partial: ran to
// the end with some post edits skipped; approvable again); `lines` -- one per
// script line as stored, blank lines counted -- with state, matched, skipped,
// skipped_reasons, error and remedy, empty until a run starts; `reason` is
// free text naming who asked, drawn as TEXT and never as an identity; a
// refusal is 422 {message, errors:[{line, text, reason}]} whose message is
// shown as it is, words only.
import { BOORU_ORIGIN } from './booruUrl'
import { NoBooruSession, postAsViewer } from './booruWrite'
import { reportIgnored } from './report'

/** The content key on Neru-chan's reply. */
export const BUR_KEY = 'net.41chan.bur'

/**
 * Who may point a card at a BUR. Only the bot that files them: anyone else's
 * message carrying the key is drawn as plain text, so a card can never be
 * forged to sit under somebody else's words.
 */
export const BUR_SENDERS: readonly string[] = ['@tunnel:41chan.net']

/** The BUR id an event points at, or null. Pure. */
export function burPointer(content: unknown, sender: string | null | undefined): number | null {
  if (!sender || !BUR_SENDERS.includes(sender)) return null
  if (!content || typeof content !== 'object') return null
  const v = (content as Record<string, unknown>)[BUR_KEY]
  if (!v || typeof v !== 'object') return null
  const id = (v as Record<string, unknown>).id
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null
}

export type BurStatus = 'pending' | 'processing' | 'approved' | 'partial' | 'failed' | 'rejected'
const STATUSES: readonly BurStatus[] = ['pending', 'processing', 'approved', 'partial', 'failed', 'rejected']

export type LineState = 'running' | 'done' | 'skipped_some' | 'failed' | 'not_run'
const LINE_STATES: readonly LineState[] = ['running', 'done', 'skipped_some', 'failed', 'not_run']

export interface BurLine {
  /** 1-based, the script as stored, blank lines counted */
  line: number
  command: string
  state: LineState | null
  matched: number | null
  skipped: number | null
  skippedReasons: { message: string; count: number }[]
  error: string | null
  remedy: string | null
}

export interface Bur {
  id: number
  status: BurStatus
  lines: BurLine[]
  /** Free text naming who asked -- drawn as text, never as an identity. */
  reason: string | null
  skippedCount: number | null
  failedLine: number | null
  /** The booru's own per-viewer answer, when it gives one. */
  canApprove?: boolean
  canReject?: boolean
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)

/** The script's non-blank lines, numbered as stored (blank lines counted). Pure. */
function scriptLines(script: string): BurLine[] {
  const out: BurLine[] = []
  script.split(/\r?\n/).forEach((raw, i) => {
    const command = raw.trim()
    if (command) out.push({ line: i + 1, command, state: null, matched: null, skipped: null, skippedReasons: [], error: null, remedy: null })
  })
  return out
}

function parseLine(v: unknown): BurLine | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const line = int(o.line)
  const command = str(o.command)
  if (line === null || command === null) return null
  const reasons = Array.isArray(o.skipped_reasons)
    ? o.skipped_reasons
        .map((r) => (r && typeof r === 'object' ? { message: str((r as Record<string, unknown>).message), count: int((r as Record<string, unknown>).count) } : null))
        .filter((r): r is { message: string; count: number } => !!r && r.message !== null && r.count !== null)
    : []
  return {
    line,
    command,
    state: LINE_STATES.includes(o.state as LineState) ? (o.state as LineState) : null,
    matched: int(o.matched),
    skipped: int(o.skipped),
    skippedReasons: reasons,
    error: str(o.error),
    remedy: str(o.remedy),
  }
}

/** A BUR as the booru serialises it. Null for anything that is not one. Pure. */
export function parseBur(json: unknown): Bur | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  if (typeof o.id !== 'number' || !Number.isInteger(o.id)) return null
  if (typeof o.status !== 'string' || !STATUSES.includes(o.status as BurStatus)) return null
  const ran = Array.isArray(o.lines) ? o.lines.map(parseLine).filter((l): l is BurLine => l !== null) : []
  const bur: Bur = {
    id: o.id,
    status: o.status as BurStatus,
    // Per-line progress once a run has started; until then, the script.
    lines: ran.length ? ran : scriptLines(typeof o.script === 'string' ? o.script : ''),
    reason: str(o.reason),
    skippedCount: int(o.skipped_count),
    failedLine: int(o.failed_line),
  }
  if (typeof o.can_approve === 'boolean') bur.canApprove = o.can_approve
  if (typeof o.can_reject === 'boolean') bur.canReject = o.can_reject
  return bur
}

// Danbooru's level numbers (user.rb). Only Admin matters, and only as the
// fallback for a booru that does not send can_approve / can_reject.
export const BOORU_ADMIN = 50

export interface BurActions {
  approve: boolean
  reject: boolean
}

/**
 * What the card offers this viewer. Pure.
 *
 * The booru's own per-viewer flags decide whenever it sends them -- they come
 * from the same policy its actions enforce. Without them: Admin may approve a
 * pending, partial, failed or rejected BUR (all stay approvable, as upstream
 * has it -- operator ruling 2026-10-19) and reject a pending one; an unknown
 * level offers nothing.
 */
export function burActions(bur: Bur, viewerLevel: number | null): BurActions {
  const admin = viewerLevel !== null && viewerLevel >= BOORU_ADMIN
  const approvable = bur.status === 'pending' || bur.status === 'partial' || bur.status === 'failed' || bur.status === 'rejected'
  const rejectable = bur.status === 'pending'
  return {
    approve: bur.canApprove ?? (approvable && admin),
    reject: bur.canReject ?? (rejectable && admin),
  }
}

/** The words for a status, as the card says them. Pure. */
export function burStatusText(status: BurStatus): string {
  switch (status) {
    case 'pending':
      return 'waiting for an admin'
    case 'processing':
      return 'running on the booru now'
    case 'approved':
      return 'approved and applied'
    case 'partial':
      return 'applied, but some posts were skipped; an admin can approve it again'
    case 'rejected':
      return 'rejected; nothing changed, and an admin can still approve it'
    case 'failed':
      return 'failed part-way; an admin can approve it again'
  }
}

/** One script line's progress, in words. Pure. */
export function lineStateText(l: BurLine): string | null {
  switch (l.state) {
    case 'running':
      return 'running'
    case 'done':
      return l.matched !== null ? `done, ${l.matched} post${l.matched === 1 ? '' : 's'}` : 'done'
    case 'skipped_some':
      return `done, ${l.skipped ?? 'some'} skipped${l.matched !== null ? ` of ${l.matched}` : ''}`
    case 'failed':
      return 'failed'
    case 'not_run':
      return 'not run'
    default:
      return null
  }
}

/** A refusal from the booru: its sentence, and the lines it names. */
export class BurRefusal extends Error {
  lineErrors: Map<number, string>
  constructor(message: string, lineErrors: Map<number, string> = new Map(), options?: ErrorOptions) {
    super(message, options)
    this.name = 'BurRefusal'
    this.lineErrors = lineErrors
  }
}

/** The booru's per-line reasons from a refusal body, by line. Pure. */
export function refusalLines(json: unknown): Map<number, string> {
  const out = new Map<number, string>()
  if (!json || typeof json !== 'object') return out
  const errors = (json as Record<string, unknown>).errors
  if (!Array.isArray(errors)) return out
  for (const e of errors) {
    if (!e || typeof e !== 'object') continue
    const line = int((e as Record<string, unknown>).line)
    const reason = str((e as Record<string, unknown>).reason)
    if (line !== null && reason) out.set(line, reason)
  }
  return out
}

/** The booru's sentence from a refusal body, or null. Pure. */
export function refusalText(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const m = (json as Record<string, unknown>).message
  return typeof m === 'string' && m.trim() ? m.trim() : null
}

const NO_SESSION = 'The booru could not be reached from this browser. Fix: open the booru panel once to sign in there, then reopen this room.'

export function burPageUrl(id: number): string {
  return `${BOORU_ORIGIN}/bulk_update_requests/${id}`
}

/** Read one BUR as the viewer. Throws a sentence that names its fix. */
export async function readBur(id: number, fetchImpl: typeof fetch = fetch): Promise<Bur> {
  let res: Response
  try {
    res = await fetchImpl(`${BOORU_ORIGIN}/bulk_update_requests/${id}.json`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    // A rejected fetch is a missing session: Caddy's own 403 carries no CORS
    // headers, so the browser reports it as a network failure.
    throw new BurRefusal(NO_SESSION, undefined, { cause: err })
  }
  if (!res.ok) {
    throw new BurRefusal(
      res.status === 404
        ? `BUR #${id} is not on the booru any more, or this account may not see it.`
        : `The booru would not show BUR #${id} (HTTP ${res.status}). Fix: open the booru panel once to sign in there, then reopen this room.`,
    )
  }
  const bur = parseBur(await res.json())
  if (!bur) throw new BurRefusal(`The booru's answer for BUR #${id} was not a BUR. Fix: report it; the BUR's own page on the booru still works.`)
  return bur
}

let levelMemo: Promise<number | null> | null = null

/** The viewer's booru level, once per page; null when unknown. Used only as the fallback. */
export function viewerBooruLevel(fetchImpl: typeof fetch = fetch): Promise<number | null> {
  if (levelMemo) return levelMemo
  levelMemo = fetchImpl(`${BOORU_ORIGIN}/profile.json`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
    .then(async (r) => {
      if (!r.ok) return null
      const j = (await r.json()) as Record<string, unknown>
      return typeof j.level === 'number' ? j.level : null
    })
    .catch((err) => {
      // Unknown, not refused: the card shows the status and no buttons.
      reportIgnored('bur: viewer booru level', err)
      return null
    })
    .then((level) => {
      // An unknown answer is not remembered: the session may simply not
      // exist yet, and the next card should ask again.
      if (level === null) levelMemo = null
      return level
    })
  return levelMemo
}

/** For checks and sign-out. */
export function resetViewerBooruLevel(): void {
  levelMemo = null
}

async function decide(id: number, verb: 'approve' | 'reject', fetchImpl: typeof fetch): Promise<Bur> {
  // Reject is DELETE /bulk_update_requests/:id, sent as a POST carrying
  // _method like every other write here (booruWrite.ts).
  const path = verb === 'approve' ? `/bulk_update_requests/${id}/approve.json` : `/bulk_update_requests/${id}.json`
  let res: Response
  try {
    res = await postAsViewer(path, {}, fetchImpl, verb === 'approve' ? 'post' : 'delete')
  } catch (err) {
    if (err instanceof NoBooruSession || err instanceof TypeError) throw new BurRefusal(NO_SESSION, undefined, { cause: err })
    throw err
  }
  if (res.ok) {
    // Reject answers 204 with no body; approve answers the BUR, processing.
    if (res.status !== 204) {
      try {
        const bur = parseBur(await res.json())
        if (bur) return bur
      } catch (err) {
        // The decision landed; only its echo was unreadable. Read it fresh.
        reportIgnored('bur: decision answer', err)
      }
    }
    return readBur(id, fetchImpl)
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch (err) {
    reportIgnored('bur: refusal body', err)
  }
  const said = refusalText(body)
  if (res.status === 429) throw new BurRefusal(said ?? 'The booru is limiting how fast requests are decided. Try again in a minute.')
  if (res.status === 403) throw new BurRefusal(said ?? `This account may not ${verb} BUR #${id}.`)
  if (res.status === 404 && verb === 'reject') {
    throw new BurRefusal('The booru did not receive the reject. Fix: reload this page and try again; if it repeats, report it.')
  }
  if (said) throw new BurRefusal(said, refusalLines(body))
  throw new BurRefusal(`The booru refused to ${verb} BUR #${id} (HTTP ${res.status}) without saying why.`)
}

export function approveBur(id: number, fetchImpl: typeof fetch = fetch): Promise<Bur> {
  return decide(id, 'approve', fetchImpl)
}

export function rejectBur(id: number, fetchImpl: typeof fetch = fetch): Promise<Bur> {
  return decide(id, 'reject', fetchImpl)
}
