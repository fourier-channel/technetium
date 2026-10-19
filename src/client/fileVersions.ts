// THE FILE VERSION OF A PICTURE, for the reload a replacement forces
// (operator, 2026-10-19: "a reload should be forced on that post", and a
// repost of the same picture "gets replaced everywhere").
//
// When a creator replaces a picture, every copy of it -- reposts in other
// people's messages included -- is re-pointed at the new file on the server
// (fourier-tunnel canon.js repoint), and Neru-chan writes the new file's md5
// into each copy's tag state as `file_md5`. But a download is served
// immutable for a year: a browser that already has the old bytes under a URL
// never asks for that URL again. So the URL itself has to change, and it is
// made to: mediaUrl adds v=<file_md5> whenever the tag state names one, and
// anything drawing that picture re-renders when it changes.
//
// ONLY A REPLACED PICTURE CARRIES ONE. Every other picture keeps the URL it
// has always had, so nothing already cached is fetched again.
//
// One store per client, built from the rooms' current tag state (in sliding
// sync's required state, all keys) and kept live from state events.
import { RoomStateEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { MEDIA_TAGS_EVENT } from './mediaTags'

const MD5 = /^[0-9a-f]{32}$/

/** The file version a tag-state content names, or null. Pure. */
export function fileVersionFrom(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null
  const v = (content as Record<string, unknown>).file_md5
  return typeof v === 'string' && MD5.test(v) ? v : null
}

interface Store {
  versions: Map<string, string>
  listeners: Set<() => void>
}

const stores = new WeakMap<MatrixClient, Store>()

function storeFor(client: MatrixClient): Store {
  const existing = stores.get(client)
  if (existing) return existing
  const made: Store = { versions: new Map(), listeners: new Set() }
  stores.set(client, made)
  const take = (ev: MatrixEvent) => {
    if (ev.getType() !== MEDIA_TAGS_EVENT) return false
    const mxc = ev.getStateKey()
    const v = fileVersionFrom(ev.getContent())
    if (!mxc || !v || made.versions.get(mxc) === v) return false
    made.versions.set(mxc, v)
    return true
  }
  // A client with no rooms to read (a stand-in, or one not started) has no
  // versions: every URL stays the one it always was.
  for (const room of typeof client.getRooms === 'function' ? (client.getRooms() ?? []) : []) {
    for (const ev of room.currentState.getStateEvents(MEDIA_TAGS_EVENT)) take(ev)
  }
  if (typeof client.on === 'function') {
    client.on(RoomStateEvent.Events, (ev) => {
      if (take(ev)) for (const l of made.listeners) l()
    })
  }
  return made
}

/** The current file version of an mxc, or null when it was never replaced. */
export function fileVersionOf(client: MatrixClient, mxc: string): string | null {
  return storeFor(client).versions.get(mxc) ?? null
}

export function subscribeFileVersions(client: MatrixClient, cb: () => void): () => void {
  const s = storeFor(client)
  s.listeners.add(cb)
  return () => {
    s.listeners.delete(cb)
  }
}
