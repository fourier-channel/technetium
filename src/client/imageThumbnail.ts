// ---------------------------------------------------------------------------
// Sender-side thumbnails, which is the only kind an encrypted image can have.
//
// H3 concluded that "every encrypted image is a full-size download to render
// any preview at all" and that E6 must downscale ON RECEIPT. The first half is
// right about the SERVER -- an octet-stream upload fails its format gate and
// dynamic thumbnailing is off, so no server thumbnail exists or can. The second
// half was wrong, and this file is the correction: downscaling on receipt still
// pulls the whole image, once per recipient per device.
//
// The spec's answer, and Element's, is that the SENDER makes it. The thumbnail
// is downscaled before encryption, encrypted as a SEPARATE attachment with its
// own key and IV, uploaded separately, and referenced as `info.thumbnail_file`
// (matrix-js-sdk types it; see the spec's "Sending encrypted attachments").
// The recipient fetches a few KB instead of megabytes, and the full image only
// when they ask for it.
//
// The geometry is pure and checked. The drawing is not: it needs a canvas, so
// it cannot run in the node harness, and pretending otherwise would be a check
// that proves nothing.
// ---------------------------------------------------------------------------

// The longest edge a thumbnail may have. The inline image renders at 320 CSS
// pixels, so this leaves headroom for a high-DPI screen without carrying a
// second copy of the picture.
export const THUMB_MAX_EDGE = 512

export interface ThumbDimensions { w: number; h: number }

// Fit within a square of `max`, preserving aspect, never enlarging. Returns
// null when the image is ALREADY within the box -- there is nothing to gain
// from a "thumbnail" the size of the original, and sending one would cost a
// second upload and a second key for no saving.
export function thumbDimensions(w: number, h: number, max = THUMB_MAX_EDGE): ThumbDimensions | null {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  if (w <= max && h <= max) return null
  const scale = max / Math.max(w, h)
  return {
    // At least 1px: a 4000x1 panorama scaled by 512/4000 rounds the short edge
    // to zero, and a zero-height canvas throws rather than producing anything.
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
  }
}

// PNG keeps alpha; everything else becomes JPEG, which is much smaller for
// photographs. A JPEG thumbnail of a transparent PNG would composite the alpha
// onto black, which looks like corruption rather than compression.
export function thumbMimetype(sourceMimetype: string): string {
  return /png/i.test(sourceMimetype) ? 'image/png' : 'image/jpeg'
}

export interface Thumbnail {
  blob: Blob
  w: number
  h: number
  mimetype: string
}

// Browser only. Returns null whenever a thumbnail cannot be made -- too small
// to be worth one, an unreadable image, no canvas support. Null means "send the
// picture without a thumbnail", which is a worse experience and not a failure,
// so this never throws into the send path.
export async function makeThumbnail(file: Blob, sourceMimetype: string): Promise<Thumbnail | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const dims = thumbDimensions(bitmap.width, bitmap.height)
    if (!dims) { bitmap.close?.(); return null }
    const canvas = document.createElement('canvas')
    canvas.width = dims.w
    canvas.height = dims.h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close?.(); return null }
    ctx.drawImage(bitmap, 0, 0, dims.w, dims.h)
    bitmap.close?.()
    const mimetype = thumbMimetype(sourceMimetype)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimetype, mimetype === 'image/jpeg' ? 0.7 : undefined))
    if (!blob) return null
    return { blob, w: dims.w, h: dims.h, mimetype }
  } catch {
    return null
  }
}
