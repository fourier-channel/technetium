import { M_POLL_END, M_POLL_RESPONSE, M_POLL_START, type MatrixEvent } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W5.3 -- polls (MSC3381).
//
// O-tp4: follow whatever the installed sdk emits and parses. It ships
// M_POLL_START / M_POLL_RESPONSE / M_POLL_END as "unstable-or-stable" matchers
// that accept BOTH the org.matrix.msc3381.* prefix and the stable m.poll.*
// name, so using those matchers means we read polls from clients on either
// side of the stabilisation without hand-rolling a prefix table.
//
// Tallying is done here rather than trusted from anywhere: one response per
// voter counts, the LAST one they sent before the poll closed, and responses
// after an end event do not count at all.
// ---------------------------------------------------------------------------

export interface PollAnswer {
  id: string
  text: string
}

export interface PollDefinition {
  question: string
  answers: PollAnswer[]
  // An undisclosed poll hides its tallies until it ends.
  undisclosed: boolean
  maxSelections: number
}

export interface PollTally {
  answerId: string
  count: number
  voters: string[]
}

export interface PollState {
  definition: PollDefinition
  tallies: PollTally[]
  totalVoters: number
  ended: boolean
  endedTs: number | null
  // What the local user picked, if anything.
  myAnswerIds: string[]
  // True when tallies should be hidden (undisclosed and still open).
  hidden: boolean
}

function text(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    // MSC1767 extensible text: prefer the plain representation.
    if (typeof o['org.matrix.msc1767.text'] === 'string') return o['org.matrix.msc1767.text']
    if (typeof o['m.text'] === 'string') return o['m.text']
  }
  return ''
}

export function isPollStart(ev: MatrixEvent): boolean {
  return M_POLL_START.matches(ev.getType())
}

export function parsePollStart(ev: MatrixEvent): PollDefinition | null {
  const content = ev.getOriginalContent()
  const start = (content[M_POLL_START.name] ?? content[M_POLL_START.altName ?? '']) as
    | Record<string, unknown>
    | undefined
  if (!start || typeof start !== 'object') return null

  const rawAnswers = Array.isArray(start.answers) ? start.answers : []
  const answers: PollAnswer[] = []
  for (const a of rawAnswers) {
    if (!a || typeof a !== 'object') continue
    const o = a as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : null
    if (!id) continue
    answers.push({ id, text: text(o) || id })
  }
  if (answers.length === 0) return null

  const kind = typeof start.kind === 'string' ? start.kind : ''
  return {
    question: text(start.question) || '(no question)',
    answers,
    undisclosed: kind.includes('undisclosed'),
    maxSelections:
      typeof start.max_selections === 'number' && start.max_selections > 0
        ? start.max_selections
        : 1,
  }
}

// Build the current state of a poll from its start event and every related
// event in the loaded window.
export function tallyPoll(
  start: MatrixEvent,
  related: MatrixEvent[],
  myUserId: string | null,
): PollState | null {
  const definition = parsePollStart(start)
  if (!definition) return null
  const validIds = new Set(definition.answers.map((a) => a.id))

  // An end event only counts from someone allowed to send it: the poll's
  // creator. Otherwise any member could close anyone's poll in our renderer.
  let endedTs: number | null = null
  for (const ev of related) {
    if (!M_POLL_END.matches(ev.getType())) continue
    if (ev.getSender() !== start.getSender()) continue
    const ts = ev.getTs()
    if (endedTs === null || ts < endedTs) endedTs = ts
  }

  // Last response per voter wins; responses after the close are discarded.
  const latest = new Map<string, { ts: number; ids: string[] }>()
  for (const ev of related) {
    if (!M_POLL_RESPONSE.matches(ev.getType())) continue
    if (ev.isRedacted()) continue
    const sender = ev.getSender()
    if (!sender) continue
    const ts = ev.getTs()
    if (endedTs !== null && ts > endedTs) continue

    const content = ev.getOriginalContent()
    const resp = (content[M_POLL_RESPONSE.name] ?? content[M_POLL_RESPONSE.altName ?? '']) as
      | Record<string, unknown>
      | undefined
    const answers = resp && Array.isArray(resp.answers) ? resp.answers : []
    const ids = answers
      .filter((a): a is string => typeof a === 'string' && validIds.has(a))
      .slice(0, definition.maxSelections)

    const prev = latest.get(sender)
    if (!prev || ts > prev.ts) latest.set(sender, { ts, ids })
  }

  const counts = new Map<string, string[]>()
  for (const a of definition.answers) counts.set(a.id, [])
  for (const [sender, { ids }] of latest) {
    for (const id of ids) counts.get(id)?.push(sender)
  }

  const tallies: PollTally[] = definition.answers.map((a) => ({
    answerId: a.id,
    count: counts.get(a.id)?.length ?? 0,
    voters: counts.get(a.id) ?? [],
  }))

  const ended = endedTs !== null
  return {
    definition,
    tallies,
    totalVoters: latest.size,
    ended,
    endedTs,
    myAnswerIds: myUserId ? (latest.get(myUserId)?.ids ?? []) : [],
    hidden: definition.undisclosed && !ended,
  }
}

// Content for a vote. The relation ties it to the poll's start event.
export function buildPollResponse(pollStartId: string, answerIds: string[]) {
  return {
    'm.relates_to': { rel_type: 'm.reference', event_id: pollStartId },
    [M_POLL_RESPONSE.name]: { answers: answerIds },
  }
}
