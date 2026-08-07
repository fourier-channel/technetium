import type { IContent, MatrixEvent } from 'matrix-js-sdk'

// S1 -- the relations read layer.
//
// Everything here is PURE over an array of loaded events. We deliberately do
// not read the sdk's RelationsContainer: it is internal-ish, its population
// depends on which timeline set an event landed in, and the sliding-sync deep
// import already taught us what betting on sdk internals costs. A single pass
// over the loaded window is O(n), deterministic, and unit-testable.
//
// The trade is that a relation whose target scrolled out of the loaded window
// is invisible until that target is paginated back in. That is the correct
// failure mode: we never render a reaction on a message we cannot see.

export type RelType = 'm.replace' | 'm.annotation' | 'm.thread' | 'm.reference' | null

export interface RelatesTo {
  relType: RelType
  targetId: string | null
  key: string | null
  replyToId: string | null
  // MSC3440: a thread reply carries an m.in_reply_to FALLBACK pointing at the
  // thread's previous message. It is not a user-authored reply and must never
  // render a reply pill.
  replyIsFallback: boolean
}

// One aggregated reaction key on a single event.
export interface ReactionTally {
  key: string
  count: number
  // Did the local user react with this key? Drives the "own reaction" styling
  // and the toggle-off path.
  mine: boolean
  // The local user's own annotation event id -- required to redact it when
  // toggling the reaction off.
  myEventId: string | null
  // Senders in first-seen order, for the hover tooltip.
  senders: string[]
}

export interface ReplyRef {
  eventId: string
  // Resolved only if the target is inside the loaded window. Wave 2's
  // click-to-jump does the bounded scrollback when this is null.
  event: MatrixEvent | null
}

export interface EditInfo {
  // The winning m.replace event.
  event: MatrixEvent
  ts: number
}

// Read m.relates_to defensively -- it is remote input and may be any shape.
export function readRelatesTo(ev: MatrixEvent): RelatesTo {
  const empty: RelatesTo = {
    relType: null,
    targetId: null,
    key: null,
    replyToId: null,
    replyIsFallback: false,
  }
  const raw = ev.getOriginalContent()?.['m.relates_to']
  if (!raw || typeof raw !== 'object') return empty
  const r = raw as Record<string, unknown>

  const rt = r['rel_type']
  const relType =
    rt === 'm.replace' || rt === 'm.annotation' || rt === 'm.thread' || rt === 'm.reference'
      ? (rt as RelType)
      : null

  const targetId = typeof r['event_id'] === 'string' ? (r['event_id'] as string) : null
  const key = typeof r['key'] === 'string' ? (r['key'] as string) : null

  let replyToId: string | null = null
  let replyIsFallback = false
  const rep = r['m.in_reply_to']
  if (rep && typeof rep === 'object') {
    const id = (rep as Record<string, unknown>)['event_id']
    if (typeof id === 'string') replyToId = id
    replyIsFallback = r['is_falling_back'] === true
  }

  return { relType, targetId, key, replyToId, replyIsFallback }
}

// True for events that exist only to modify another event. They travel down
// the timeline like any other event; rendering them as rows produces the
// duplicate-message and `[m.reaction]` junk the client shows today.
export function isRelationOnlyEvent(ev: MatrixEvent): boolean {
  const rel = readRelatesTo(ev)
  if (rel.relType === 'm.annotation') return true
  // An m.replace whose target we know is a pure edit event. Guard on the type
  // too: only m.room.message replacements are collapsed into their target.
  if (rel.relType === 'm.replace' && ev.getType() === 'm.room.message') return true
  return false
}

export interface RelationIndex {
  byId: Map<string, MatrixEvent>
  edits: Map<string, EditInfo>
  reactions: Map<string, ReactionTally[]>
}

// Later edit wins. Ties break on event id so every client agrees (spec).
function editWins(a: MatrixEvent, b: EditInfo): boolean {
  if (a.getTs() !== b.ts) return a.getTs() > b.ts
  return (a.getId() ?? '') > (b.event.getId() ?? '')
}

// Build the whole relation index in one pass over the loaded window.
export function buildRelationIndex(
  events: MatrixEvent[],
  myUserId?: string | null,
): RelationIndex {
  const byId = new Map<string, MatrixEvent>()
  for (const ev of events) {
    const id = ev.getId()
    if (id) byId.set(id, ev)
  }

  const edits = new Map<string, EditInfo>()
  // key -> tally, per target, preserving first-seen key order.
  const reactions = new Map<string, Map<string, ReactionTally>>()
  // Guards a user annotating the same target with the same key twice.
  const seenAnnotation = new Set<string>()

  for (const ev of events) {
    if (ev.isRedacted()) continue
    const rel = readRelatesTo(ev)
    if (!rel.targetId) continue
    const target = byId.get(rel.targetId)

    if (rel.relType === 'm.replace' && ev.getType() === 'm.room.message') {
      // SECURITY: an edit is only valid from the ORIGINAL sender. Without this
      // check any room member could rewrite anyone's message in our renderer.
      if (!target || target.getSender() !== ev.getSender()) continue
      const cur = edits.get(rel.targetId)
      if (!cur || editWins(ev, cur)) {
        edits.set(rel.targetId, { event: ev, ts: ev.getTs() })
      }
      continue
    }

    if (rel.relType === 'm.annotation' && ev.getType() === 'm.reaction') {
      if (!rel.key) continue
      const sender = ev.getSender()
      if (!sender) continue
      const dedupe = `${rel.targetId}|${rel.key}|${sender}`
      if (seenAnnotation.has(dedupe)) continue
      seenAnnotation.add(dedupe)

      let perTarget = reactions.get(rel.targetId)
      if (!perTarget) {
        perTarget = new Map()
        reactions.set(rel.targetId, perTarget)
      }
      let tally = perTarget.get(rel.key)
      if (!tally) {
        tally = { key: rel.key, count: 0, mine: false, myEventId: null, senders: [] }
        perTarget.set(rel.key, tally)
      }
      tally.count += 1
      tally.senders.push(sender)
      if (myUserId && sender === myUserId) {
        tally.mine = true
        tally.myEventId = ev.getId() ?? null
      }
    }
  }

  const flat = new Map<string, ReactionTally[]>()
  for (const [targetId, perTarget] of reactions) {
    flat.set(targetId, Array.from(perTarget.values()))
  }

  return { byId, edits, reactions: flat }
}

// Effective content of an event with its winning edit applied.
//
// Per MSC2676 m.new_content wholly replaces the renderable content, but the
// ORIGINAL m.relates_to is preserved -- an edit cannot retarget a reply or
// move a message between threads.
export function effectiveContent(ev: MatrixEvent, edit?: EditInfo): IContent {
  const original = ev.getOriginalContent()
  if (!edit) return original
  const newContent = edit.event.getOriginalContent()?.['m.new_content']
  if (!newContent || typeof newContent !== 'object') return original
  const merged: IContent = { ...(newContent as IContent) }
  if (original['m.relates_to']) merged['m.relates_to'] = original['m.relates_to']
  return merged
}

// Resolve an event's user-authored reply target, or null.
export function resolveReply(ev: MatrixEvent, byId: Map<string, MatrixEvent>): ReplyRef | null {
  const rel = readRelatesTo(ev)
  if (!rel.replyToId) return null
  // A thread reply's fallback in_reply_to is plumbing, not a reply.
  if (rel.relType === 'm.thread' && rel.replyIsFallback) return null
  return { eventId: rel.replyToId, event: byId.get(rel.replyToId) ?? null }
}
