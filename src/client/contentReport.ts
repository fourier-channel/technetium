// ---------------------------------------------------------------------------
// Report a message to the moderators (ing.67, the Technetium half).
//
// One standard Matrix route, the content-report API
// (POST /_matrix/client/v3/rooms/{roomId}/report/{eventId}), through the SDK's
// own client.reportEvent. The server keeps the report; getting it in front of
// people is the relay's job, not this module's.
//
// Pure, so the check can prove who may report what and what is sent without
// a DOM or a homeserver. The dialog (ui/ReportDialog.tsx) renders what this
// decides.
//
// Named contentReport, not report: client/report.ts is the reporter for
// failures we continue past (reportIgnored), a different fact.
// ---------------------------------------------------------------------------

/** The longest reason sent. Synapse stores the text as given; a cap keeps a
 * pasted wall of text from becoming the moderators' problem. */
export const REPORT_REASON_MAX = 1000

/**
 * The spec's old `score`: -100 (most offensive) to 0. The SDK still requires
 * it and Synapse still stores it, but nobody reads it any more, and the
 * Matrix spec has deprecated it. Sent as the one fixed value so the report's
 * meaning lives in the reason, and so every report from Technetium carries the
 * same number rather than a guess.
 */
export const REPORT_SCORE = -100

export interface ReportTarget {
  /** TimelineItem kind: only 'message' and 'gallery' are real messages. */
  readonly kind: string
  readonly eventId: string
  readonly sender: string | null
  readonly me: string | null
}

/**
 * May this item be reported? A real message (not redacted, not undecryptable,
 * not a state row), already on the server (a local echo's '~' id is not), and
 * someone else's: reporting yourself is not a thing anyone needs, and a
 * button that does nothing useful teaches people to ignore the bar.
 */
export function mayReport(t: ReportTarget): boolean {
  if (t.kind !== 'message' && t.kind !== 'gallery') return false
  if (!t.eventId || t.eventId.startsWith('~')) return false
  if (!t.me || !t.sender) return false
  return t.sender !== t.me
}

/** The reason as sent: trimmed, and capped at REPORT_REASON_MAX characters
 * (code points, so a cap never splits an emoji into a lone surrogate). */
export function reportReason(raw: string): string {
  const t = raw.trim()
  const cps = Array.from(t)
  return cps.length <= REPORT_REASON_MAX ? t : cps.slice(0, REPORT_REASON_MAX).join('').trimEnd()
}

/** What the dialog says when the server says no -- plain words, never the
 * raw error (that goes to the console through reportIgnored). */
export function reportFailureText(err: unknown): string {
  const e = err as { httpStatus?: number; errcode?: string } | null
  const status = e && typeof e === 'object' ? e.httpStatus : undefined
  const code = e && typeof e === 'object' ? e.errcode : undefined
  if (status === 429 || code === 'M_LIMIT_EXCEEDED') return 'Too many reports just now. Try again in a minute.'
  if (status === 404 || code === 'M_NOT_FOUND') return 'This message can no longer be reported. It may have been deleted.'
  if (status === 403 || code === 'M_FORBIDDEN') return 'You can only report messages in rooms you are in.'
  return 'The report did not go through. Try again in a moment.'
}

/** The one call that leaves. `client` is anything with the SDK's reportEvent,
 * called as a method so it keeps its `this` (G-bf03). */
export function sendReport(
  client: { reportEvent(roomId: string, eventId: string, score: number, reason: string): Promise<unknown> },
  roomId: string,
  eventId: string,
  reason: string,
): Promise<unknown> {
  return client.reportEvent(roomId, eventId, REPORT_SCORE, reportReason(reason))
}
