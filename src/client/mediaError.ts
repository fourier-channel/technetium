// A failed picture becomes a card that says what happened and what the reader
// can do, sized to its box (boo.52; formant's "Failure has a face" rule).
// chanbooru's ErrorArt (app/logical/error_art.rb) is the first consumer and
// owns the wording; this is the second, a NATIVE table, not a fetch of
// chanbooru's art. The structure and tone are kept; the words differ only where
// Technetium's meaning does (a 401 here is a session that ended while you were
// signed in, not a visitor at the door).
//
// Pure: no DOM, no React, loaded by checks/mediaError.check.ts.

// What the colour of the card says, by name; the stylesheet maps names to
// formant tokens.
export type MediaErrorTone = 'refused' | 'later' | 'missing' | 'ours' | 'unknown'

export interface MediaErrorCopy {
  title: string
  body: string
  tone: MediaErrorTone
  // Whether trying again can change the answer. A refusal or a missing file
  // will say the same thing next time; a busy server may not.
  retry: boolean
}

// The status codes the media route can answer a picture with.
const COPY: Record<number, MediaErrorCopy> = {
  400: { title: 'Bad Request!', tone: 'later', retry: true, body: 'This means the request came out garbled. Trying again usually settles it.' },
  401: { title: 'Who Goes There!', tone: 'refused', retry: true, body: 'This means your sign-in ran out before the picture arrived. Trying again signs you back in; if it keeps happening, reload the page.' },
  403: { title: 'Not Authorized!', tone: 'refused', retry: false, body: "This means you don't have permission to see this image." },
  404: { title: 'Not Found!', tone: 'missing', retry: false, body: "This means the image you were looking for isn't here." },
  410: { title: 'Gone!', tone: 'missing', retry: false, body: 'This means the image was here once and has since been removed.' },
  413: { title: 'Too Big!', tone: 'missing', retry: false, body: 'This means the image is larger than the server will hand out.' },
  429: { title: 'Slow Down!', tone: 'later', retry: true, body: "This means you're loading pictures faster than the server thinks you should be able to. Wait a moment and try again; if you see this during normal use, please report it." },
  451: { title: 'Taken Down!', tone: 'refused', retry: false, body: 'This means the image was removed following a takedown request or a rule violation.' },
  500: { title: 'We Broke It!', tone: 'ours', retry: true, body: "This means something failed on our end, not yours. It's worth reporting if it keeps happening." },
  502: { title: 'Bad Gateway!', tone: 'ours', retry: true, body: "Something went wrong somewhere, and we're trying to figure out who to blame." },
  503: { title: 'Back Shortly!', tone: 'ours', retry: true, body: "This means the server is down or busy. It's usually brief." },
  504: { title: 'Took Too Long!', tone: 'ours', retry: true, body: 'This means something upstream never answered. Trying again often works.' },
}

// No status at all: the request never got an answer (offline, blocked), or
// the bytes arrived and could not be used (an encrypted file that failed its
// check). The server did not say why.
const FALLBACK: MediaErrorCopy = {
  title: 'Unavailable!',
  tone: 'unknown',
  retry: true,
  body: "This image couldn't be loaded, and the server didn't say why. Trying again sometimes helps.",
}

export function mediaErrorCopy(status: number | null): MediaErrorCopy {
  if (status !== null && Object.hasOwn(COPY, status)) return COPY[status]
  // An unlisted 5xx is still ours; an unlisted 4xx still a refusal of some kind.
  if (status !== null && status >= 500 && status <= 599) return { ...COPY[500] }
  return FALLBACK
}

export const MEDIA_ERROR_STATUSES: readonly number[] = Object.keys(COPY).map(Number)

// The code shown in the corner of the card: the status, or "?" when there was none.
export function mediaErrorCode(status: number | null): string {
  return status !== null && status > 0 ? String(status) : '?'
}

// Below this width the card drops its body to a tooltip and shows the title
// and code only (chanbooru error_card.js COMPACT_BELOW_PX, the same number).
export const MEDIA_ERROR_COMPACT_BELOW_PX = 320

// An unknown width (0, or a box we were not told) is a FULL card: a card that
// cannot be read is the failure this exists to prevent.
export function mediaErrorCompact(width: number | undefined): boolean {
  return typeof width === 'number' && width > 0 && width < MEDIA_ERROR_COMPACT_BELOW_PX
}

// The HTTP status a media failure carries, or null. media.ts throws a
// MediaFetchError with a numeric .status; anything else (a network failure, a
// failed decrypt, a missing token) has none, and a status is never parsed back
// out of message text.
export class MediaFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'MediaFetchError'
    this.status = status
  }
}

export function mediaErrorStatus(err: unknown): number | null {
  if (err instanceof MediaFetchError) return err.status
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status: unknown }).status
    if (typeof s === 'number' && Number.isInteger(s) && s >= 100 && s <= 599) return s
  }
  return null
}
