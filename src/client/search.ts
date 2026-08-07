import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W5.1 -- message search.
//
// Server-side /search is the real thing: it reaches the whole history, not the
// slice this client happens to have loaded. But it is optional -- a homeserver
// can decline it, and some do -- so the capability is probed once and cached,
// and the fallback is an honest CLIENT-SIDE filter over loaded events.
//
// The fallback is labelled as partial everywhere it surfaces. A search that
// quietly only covers the last 60 messages is worse than no search: it answers
// "not found" with total confidence about a room it has barely read.
// ---------------------------------------------------------------------------

export type SearchScope = 'room' | 'all'

export interface SearchHit {
  eventId: string
  roomId: string
  sender: string
  ts: number
  body: string
}

export interface SearchOutcome {
  hits: SearchHit[]
  // 'server' = whole history. 'local' = only what this client has loaded.
  source: 'server' | 'local'
  // Set when the server declined, so the UI can say why it is showing less.
  degradedReason?: string
}

// Cached per client instance. `undefined` = not yet probed.
const serverSearchSupported = new WeakMap<MatrixClient, boolean>()

function hitFromEvent(ev: MatrixEvent): SearchHit | null {
  const content = ev.getContent()
  const body = typeof content.body === 'string' ? content.body : ''
  const eventId = ev.getId()
  const roomId = ev.getRoomId()
  if (!eventId || !roomId || !body) return null
  return { eventId, roomId, sender: ev.getSender() ?? '', ts: ev.getTs(), body }
}

// Search the loaded timelines. Bounded and honest: this is what the client can
// see, never a claim about the room.
export function searchLoaded(
  client: MatrixClient,
  term: string,
  scope: SearchScope,
  roomId: string | null,
  limit = 50,
): SearchHit[] {
  const q = term.trim().toLowerCase()
  if (!q) return []
  const rooms =
    scope === 'room'
      ? [roomId ? client.getRoom(roomId) : null].filter(Boolean)
      : client.getRooms().filter((r) => r.getMyMembership() === 'join')

  const hits: SearchHit[] = []
  for (const room of rooms) {
    if (!room) continue
    for (const ev of room.getLiveTimeline().getEvents()) {
      if (ev.getType() !== 'm.room.message' || ev.isRedacted()) continue
      const hit = hitFromEvent(ev)
      if (hit && hit.body.toLowerCase().includes(q)) hits.push(hit)
    }
  }
  // Newest first -- a search for something recent should not make you scroll.
  hits.sort((a, b) => b.ts - a.ts)
  return hits.slice(0, limit)
}

export async function search(
  client: MatrixClient,
  term: string,
  scope: SearchScope,
  roomId: string | null,
): Promise<SearchOutcome> {
  const query = term.trim()
  if (!query) return { hits: [], source: 'local' }

  // Probed once per client: asking on every keystroke would turn a server that
  // does not support search into a stream of failing requests.
  if (serverSearchSupported.get(client) !== false) {
    try {
      const res = await client.searchMessageText({
        query,
        ...(scope === 'room' && roomId ? { keys: undefined } : {}),
      })
      serverSearchSupported.set(client, true)

      const results = res?.search_categories?.room_events?.results ?? []
      const hits: SearchHit[] = []
      for (const r of results) {
        const raw = r?.result
        if (!raw) continue
        const body = typeof raw.content?.body === 'string' ? raw.content.body : ''
        if (!raw.event_id || !raw.room_id || !body) continue
        // Room scope is filtered here: searchMessageText has no room filter,
        // and asking the server for everything then narrowing is still a whole-
        // history search, which is the point.
        if (scope === 'room' && roomId && raw.room_id !== roomId) continue
        hits.push({
          eventId: raw.event_id,
          roomId: raw.room_id,
          sender: raw.sender ?? '',
          ts: raw.origin_server_ts ?? 0,
          body,
        })
      }
      hits.sort((a, b) => b.ts - a.ts)
      return { hits, source: 'server' }
    } catch (err) {
      const e = err as { httpStatus?: number; errcode?: string; message?: string }
      // Only a capability failure disables it permanently. A rate limit or a
      // network blip must not convince us the server cannot search.
      const capabilityFailure =
        e?.httpStatus === 404 ||
        e?.httpStatus === 501 ||
        e?.errcode === 'M_UNRECOGNIZED' ||
        e?.errcode === 'M_UNKNOWN'
      if (capabilityFailure) serverSearchSupported.set(client, false)

      return {
        hits: searchLoaded(client, query, scope, roomId),
        source: 'local',
        degradedReason: capabilityFailure
          ? 'This server does not support message search.'
          : (e?.message ?? 'Search failed on the server.'),
      }
    }
  }

  return {
    hits: searchLoaded(client, query, scope, roomId),
    source: 'local',
    degradedReason: 'This server does not support message search.',
  }
}
