import type { MatrixEvent } from 'matrix-js-sdk'
import type { TimelineItem } from '../client/useTimeline'
import { parseMxc } from '../client/media'
import type { LightboxItem } from './Lightbox'

// The vertical axis of the image viewer, built once per rendered conversation.
//
// formant grammar: horizontal moves along the sequence you are browsing --
// inside the lightbox that is the batch you clicked into. Vertical addresses
// the other dimension of the thing under the cursor: an image's other dimension
// is its place in the conversation it was posted to. So up and down walk every
// image in the thread (or room) in timeline order, crossing from one message to
// the next, and a reader can go picture to picture without touching the mouse.
//
// Built here rather than in the Lightbox because the lightbox is mounted at App
// root and has no view: only the surface that RENDERED the messages knows which
// conversation the reader is in. The thread panel passes its thread; the main
// timeline passes the room's loaded window. Same code, different sequence,
// which is the whole point -- up/down means "the conversation this came from".

// Pull a friendly filename + mimetype off an m.image content for the lightbox
// (download name + extension hinting). filename wins (MSC2530 caption case),
// else body; the mediaId is the downstream fallback.
export function imageMeta(ev: MatrixEvent): { name?: string; mimetype?: string } {
  const c = ev.getContent()
  const name =
    typeof c.filename === 'string' ? c.filename : typeof c.body === 'string' ? c.body : undefined
  const info = c.info as { mimetype?: unknown } | undefined
  const mimetype = info && typeof info.mimetype === 'string' ? info.mimetype : undefined
  return { name, mimetype }
}

/** The lightbox item for an image event, or null if it carries no usable mxc. */
export function lightboxItem(ev: MatrixEvent | null): LightboxItem | null {
  if (!ev) return null
  const c = ev.getContent()
  const mxc = typeof c.url === 'string' ? c.url : ''
  if (!parseMxc(mxc)) return null
  // roomId travels with the item: in an ENCRYPTED room the server cannot work
  // out which room an mxc belongs to, so the gateway needs telling.
  return { mxc, roomId: ev.getRoomId(), ...imageMeta(ev) }
}

export interface MediaSequence {
  /** Every image-bearing message in the conversation, in timeline order. A lone
   *  image is a one-item stop; a gallery batch is one stop holding N images. */
  stops: LightboxItem[][]
  /** Which stop a TimelineItem occupies, by item id. */
  stopOf: Map<string, number>
}

function messageStop(item: TimelineItem): LightboxItem[] {
  const mxc = typeof item.content.url === 'string' ? item.content.url : ''
  if (!parseMxc(mxc)) return []
  return [{ mxc, roomId: item.event.getRoomId(), ...imageMeta(item.event) }]
}

export const EMPTY_SEQUENCE: MediaSequence = { stops: [], stopOf: new Map() }

/** Collect the image stops of a rendered conversation, in the order shown. */
export function buildMediaSequence(items: TimelineItem[]): MediaSequence {
  const stops: LightboxItem[][] = []
  const stopOf = new Map<string, number>()
  for (const item of items) {
    // A stop is only ever pushed non-empty: the vertical walk counts images,
    // and an empty stop would be a position the reader can never occupy.
    const stop =
      item.kind === 'gallery' && item.cells
        ? (item.cells.map(lightboxItem).filter(Boolean) as LightboxItem[])
        : item.kind === 'message' && item.content.msgtype === 'm.image'
          // item.content, not the raw event: the effective content with the
          // winning edit applied, so the sequence holds the image the row
          // actually rendered.
          ? messageStop(item)
          : []
    if (stop.length === 0) continue
    stopOf.set(item.id, stops.length)
    stops.push(stop)
  }
  return { stops, stopOf }
}

// --- the vertical walk -------------------------------------------------------
// Pure, and out here rather than inside the viewer, so it can be checked
// directly. The viewer's copy of this arithmetic was the part most likely to be
// wrong at a stop boundary, which is exactly the case a human tester scrolls
// past without noticing.

/** A position in the sequence: which stop, and which image inside it. */
export interface SeqPos {
  stop: number
  index: number
}

/** How many images the whole sequence holds. */
export function totalImages(stops: LightboxItem[][]): number {
  return stops.reduce((n, s) => n + s.length, 0)
}

/**
 * The position counted in images from the start of the sequence.
 *
 * `index` is clamped to the stop it names: the viewer's horizontal index is
 * owned by the opened set, and a caller that opened a set other than
 * stops[stop] must not be able to push the count past the end.
 */
export function flatIndex(stops: LightboxItem[][], pos: SeqPos): number {
  const stop = Math.min(Math.max(0, pos.stop), Math.max(0, stops.length - 1))
  const size = stops[stop]?.length ?? 0
  const within = Math.min(Math.max(0, pos.index), Math.max(0, size - 1))
  return stops.slice(0, stop).reduce((n, s) => n + s.length, 0) + within
}

/**
 * One image along the sequence, crossing message boundaries.
 *
 * Returns null at the ends: a move that cannot happen does nothing, and this
 * sequence is not a ring -- wrapping from the newest picture in a thread back
 * to the oldest would tell the reader they had reached neither end.
 */
export function stepImage(
  stops: LightboxItem[][],
  pos: SeqPos,
  delta: 1 | -1,
): SeqPos | null {
  const target = flatIndex(stops, pos) + delta
  if (target < 0 || target >= totalImages(stops)) return null
  let stop = 0
  let index = target
  while (stop < stops.length - 1 && index >= stops[stop].length) {
    index -= stops[stop].length
    stop += 1
  }
  return { stop, index }
}
