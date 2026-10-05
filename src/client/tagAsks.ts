// ---------------------------------------------------------------------------
// The tag line's state, decided in one place: whether the homeserver has been
// asked about an image's tags, what it answered, and so what the line under the
// picture says. Pure -- no client, no DOM -- so the check suite can hold it.
//
// WHY THIS EXISTS (2026-10-05). Every image asks the homeserver for its tag
// event when it first renders. The first render of a timeline happens BEFORE
// the tag store has its client: React runs a child's effects before its
// parent's, and the store is wired in App's effect. The ask returned early,
// silently, and nothing ever asked again -- so on a cold start an image showed
// no tags until sync happened to deliver them, and a line with nothing in it
// read the same as an image with no tags. Now an ask made before the client
// exists is DEFERRED and runs the moment it does, and the line names each state:
// still loading, no tags, or could not load.
// ---------------------------------------------------------------------------

// What the homeserver has said about one image in one room.
//   asking    a request is out, or waiting for the client to exist
//   absent    404: no tag event for this image (the bridge never tagged it)
//   failed    anything else: the reason is in `reason`, and a retry is allowed
export type AskStatus = 'unasked' | 'asking' | 'absent' | 'failed'

export interface TagAsks {
  // key -> where it stands. A key is `${roomId}|${mediaId}`.
  status: Map<string, AskStatus>
  reason: Map<string, string>
  // Asks made before the client existed, to run once it does.
  deferred: Map<string, { roomId: string; mxc: string }>
}

export function newTagAsks(): TagAsks {
  return { status: new Map(), reason: new Map(), deferred: new Map() }
}

export function askKey(roomId: string, mediaId: string): string {
  return roomId + '|' + mediaId
}

// Should this image be asked about now? `go` sends the request; `defer` parks
// it until the client exists; `skip` means there is nothing to ask (a set is
// already held, or an answer is already in). A failed ask is not retried here
// -- only `retry` does that, so a render can never turn into a request loop.
export function beginAsk(
  s: TagAsks,
  roomId: string,
  mxc: string,
  mediaId: string,
  opts: { haveClient: boolean; haveSet: boolean },
): 'go' | 'defer' | 'skip' {
  if (opts.haveSet) return 'skip'
  const key = askKey(roomId, mediaId)
  const now = s.status.get(key) ?? 'unasked'
  if (now !== 'unasked') return 'skip'
  s.status.set(key, 'asking')
  if (!opts.haveClient) {
    s.deferred.set(key, { roomId, mxc })
    return 'defer'
  }
  return 'go'
}

// The client exists now: every parked ask, to send.
export function takeDeferred(s: TagAsks): { roomId: string; mxc: string }[] {
  const out = [...s.deferred.values()]
  s.deferred.clear()
  return out
}

// The homeserver answered. `found` clears the record: the set itself is the
// answer from then on.
export function settle(s: TagAsks, key: string, outcome: 'found' | 'absent' | { failed: string }): void {
  if (outcome === 'found') {
    s.status.delete(key)
    s.reason.delete(key)
  } else if (outcome === 'absent') {
    s.status.set(key, 'absent')
    s.reason.delete(key)
  } else {
    s.status.set(key, 'failed')
    s.reason.set(key, outcome.failed)
  }
}

// Ask again: the person pressed the line that said it could not load.
export function retry(s: TagAsks, key: string): void {
  if (s.status.get(key) !== 'failed') return
  s.status.delete(key)
  s.reason.delete(key)
}

// A tag event for this image arrived over sync: any "absent" or "failed" on
// record for it, in any room, is out of date. Returns the keys it cleared.
export function heardOf(s: TagAsks, mediaId: string): string[] {
  const cleared: string[] = []
  for (const key of [...s.status.keys()]) {
    if (key.endsWith('|' + mediaId) && s.status.get(key) !== 'asking') {
      s.status.delete(key)
      s.reason.delete(key)
      cleared.push(key)
    }
  }
  return cleared
}

// A 404 (or Matrix's M_NOT_FOUND) is the homeserver saying the image has no
// tag event; anything else is a failure to find out.
export function isAbsent(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { httpStatus?: unknown; errcode?: unknown }
  return e.httpStatus === 404 || e.errcode === 'M_NOT_FOUND'
}

// What the line under a picture shows. The line is ALWAYS there for a chat
// image (operator, 2026-10-05: "pre-assign the tagspace"), so nothing that
// arrives in it moves the conversation; this decides only what is in it.
//   tags      the set (or its post pointer, which the live read fills)
//   loading   asked, not answered yet
//   none      the homeserver says there are no tags
//   failed    could not find out; the line offers to try again
//   blank     no room to ask in (the lightbox opened without one) and no set:
//             there is no answer to give, so the line says nothing rather
//             than guess -- an explicit no-opinion, not a loading state that
//             would never end
export type TagLineView = 'tags' | 'loading' | 'none' | 'failed' | 'blank'

export function tagLineView(hasSet: boolean, status: AskStatus | undefined, canAsk: boolean): TagLineView {
  if (hasSet) return 'tags'
  if (!canAsk) return 'blank'
  switch (status) {
    case 'absent':
      return 'none'
    case 'failed':
      return 'failed'
    // 'unasked' is the first paint, before the effect that asks has run: it is
    // already as good as asked.
    default:
      return 'loading'
  }
}
