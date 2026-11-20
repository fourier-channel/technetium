import { BOORU_ORIGIN } from './booruUrl'

// ---------------------------------------------------------------------------
// A picture an event REFERENCES on the booru rather than uploads (lens L0b,
// fourier-basis docs/design/LIVE_4CHAN_LENS.md).
//
// The 4chan lens posts a thread's images as `m.text` events carrying
//   content["net.41chan.booru"] = {post_id, md5, ext, w, h}
// and no mxc: the booru already holds the file, and every image exists once.
// post_id is absent while a new image is being tagged; @sample edits its own
// event (m.replace) to add it once the booru has a post (ruling 1: an image
// shows only once the booru has a post the reader may see).
//
// ONE ADDRESS, THE MEDIA GATE'S. The fourier-auth media Worker answers
// `<booru>/fourier/booru/<md5>.<ext>` (`?w=` for a variant, snapped by the
// gate to its allowed sizes) and takes Technetium's Matrix Bearer as well as
// the booru cookie. The two are different askers: a cookie is asked about as
// its booru session, and a Bearer as the Matrix reader the token names, with
// the Matrix door's own question (fourier-auth booru-route.js readerOpens,
// openOutsideRooms; ea0605b). Before that the Bearer was asked about as
// nobody, and a lens picture went "unavailable" once the booru stopped
// answering signed-out asks for its post, about two hours after it showed.
// So the picture is fetched exactly as an mxc is: an authorized fetch, a
// blob, an <img>. No new route.
//
// INSIDE THIS CLIENT the picture is named by an address of the mxc shape,
//   mxc://booru.41chan.net/<md5>.<ext>
// so that every surface that already takes an mxc -- the row's AuthedImage,
// the lightbox, the blob cache, the tag store and its withheld pop -- takes
// this one unchanged. mediaUrl (media.ts) routes that server name to the
// booru gate and never to the homeserver. It is never sent anywhere as an
// mxc: the homeserver is not asked about it (useMediaTags.ts fetchTags), and
// it is not a Matrix server name this deployment federates with.
// ---------------------------------------------------------------------------

export const BOORU_REF_KEY = 'net.41chan.booru'

/** The server name of a booru-referenced picture's in-client address. */
export const BOORU_MEDIA_SERVER = 'booru.41chan.net'

export interface BooruRef {
  /** Absent while the image is being tagged: there is no post to show yet. */
  postId?: number
  md5: string
  ext: string
  w?: number
  h?: number
  /** The in-client address, mxc://booru.41chan.net/<md5>.<ext>. */
  mxc: string
}

// The media Worker's own pattern (fourier-auth worker/media-worker.mjs
// parseBooruPath): 32 hex, a dot, 1-5 alphanumerics. Lowercase only here, so
// one picture has one address and one cache entry.
const FILE_RE = /^[0-9a-f]{32}\.[a-z0-9]{1,5}$/

function positiveInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : undefined
}

/** The booru reference an event carries, or null when it carries none that can be drawn. */
export function parseBooruRef(content: Record<string, unknown> | null | undefined): BooruRef | null {
  const raw = content?.[BOORU_REF_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.md5 !== 'string' || typeof r.ext !== 'string') return null
  const md5 = r.md5.toLowerCase()
  const ext = r.ext.toLowerCase().replace(/^\./, '')
  if (!FILE_RE.test(`${md5}.${ext}`)) return null
  return {
    postId: positiveInt(r.post_id),
    md5,
    ext,
    w: positiveInt(r.w),
    h: positiveInt(r.h),
    mxc: `mxc://${BOORU_MEDIA_SERVER}/${md5}.${ext}`,
  }
}

/** Is this the in-client address of a booru-referenced picture? */
export function isBooruMxc(mxc: string): boolean {
  return mxc.startsWith(`mxc://${BOORU_MEDIA_SERVER}/`)
}

/**
 * The media gate's URL for one booru file, or null when the name is not a
 * booru file name. `width` asks for a variant; none is the original.
 */
export function booruMediaUrl(file: string, width?: number): string | null {
  if (!FILE_RE.test(file)) return null
  const url = `${BOORU_ORIGIN}/fourier/booru/${file}`
  return width ? `${url}?w=${width}` : url
}

/**
 * The address of the picture a message shows, by which the tag store and the
 * hidden set know it: an m.image's own mxc, or a booru reference's -- only
 * once it has a post, since before that nothing is shown to hide.
 */
export function pictureMxcOf(content: Record<string, unknown> | null | undefined): string | undefined {
  if (!content) return undefined
  if (content.msgtype === 'm.image' && typeof content.url === 'string') return content.url
  const ref = parseBooruRef(content)
  return ref?.postId !== undefined ? ref.mxc : undefined
}
