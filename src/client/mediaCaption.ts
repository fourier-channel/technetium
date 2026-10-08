import type { IContent } from 'matrix-js-sdk'

// Does this media event carry words someone wrote, rather than a file name?
//
// MSC2530, which the composer has sent since the first commit of this client
// (2026-06-27): a captioned picture puts the caption in `body` and the real
// name in `filename`. An uncaptioned one has `body` as the name and either no
// `filename` or the same string in both, which is what other clients send.
//
// ONE rule for every media row. Until launch-polish L26 (operator, 2026-10-08:
// "image posts on the matrix server are swallowing any text that came with
// them") the caption was drawn only under a GALLERY, and a single picture is
// never a gallery -- toItems folds a batch only from two images up -- so every
// one-picture post with words lost the words. The words were on the server the
// whole time; this client just never drew them.
export function hasCaption(content: IContent | null | undefined): content is IContent {
  if (!content) return false
  const body = content.body
  const filename = content.filename
  if (typeof body !== 'string' || typeof filename !== 'string') return false
  if (body.trim().length === 0) return false
  return body !== filename
}
