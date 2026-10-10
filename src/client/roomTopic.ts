// A room's topic, as the header shows it and as its editor writes it.
//
// Rooms carry their quick rules in the topic (operator, 2026-10-10), so its
// line breaks are content: a numbered list is a list. The header's line
// flattens it to fit (topicLine); the popup behind it shows it whole
// (topicText), as plain text -- never HTML, so nothing in a topic reaches the
// DOM as markup.
//
// Pure, so the harness can load it (O-tp9).

/** The topic as written: line breaks kept, trailing spaces and edge blank lines gone. */
export function topicText(content: unknown): string {
  if (!content || typeof content !== 'object') return ''
  const topic = (content as Record<string, unknown>).topic
  if (typeof topic !== 'string') return ''
  return topic
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The topic on one line, for the header. */
export function topicLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** What Save would write, and whether it changes anything. */
export function topicEdit(draft: string, current: string): { next: string; changed: boolean } {
  const next = topicText({ topic: draft })
  return { next, changed: next !== current }
}

/** A failed save, as a sentence that says what to do. */
export function describeTopicError(err: unknown): string {
  const e = err as { httpStatus?: unknown; errcode?: unknown; message?: unknown } | null
  if (e?.httpStatus === 403 || e?.errcode === 'M_FORBIDDEN') {
    return 'The server says you may not change this topic. Your level in this room may have changed; ask a moderator.'
  }
  if (e?.httpStatus === 429 || e?.errcode === 'M_LIMIT_EXCEEDED') {
    return 'Too many changes too quickly. Your text is still here; wait a moment and Save again.'
  }
  const why = typeof e?.message === 'string' && e.message ? e.message : 'no reason given'
  return `The topic was not saved (${why}). Your text is still here; Save again.`
}
