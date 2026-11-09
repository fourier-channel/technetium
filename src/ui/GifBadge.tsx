// The badge on a GIF's still thumbnail: a play mark and "GIF", so a reader
// knows a click plays it (the lightbox fetches the original, which moves).
// Decorative to a screen reader: the picture's own alt text names it.
export function GifBadge() {
  return (
    <span className="gif-badge" aria-hidden="true">
      <svg viewBox="0 0 10 10">
        <path d="M2 1v8l7-4z" />
      </svg>
      GIF
    </span>
  )
}
