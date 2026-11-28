import { mediaErrorCode, mediaErrorCompact, mediaErrorCopy } from '../client/mediaError'
import './mediaErrorCard.css'

// The card a picture becomes when it cannot be shown (boo.52): what happened,
// what you can do, in the box the picture would have had, so nothing around it
// moves (no-forced-reflow-law). The words and the full/compact rule are
// client/mediaError.ts; this only draws them.
export function MediaErrorCard({
  status,
  box,
  onRetry,
}: {
  status: number | null
  // The box the picture was going to occupy, when known.
  box?: { width: number; height: number }
  onRetry?: () => void
}) {
  const copy = mediaErrorCopy(status)
  const compact = mediaErrorCompact(box?.width)
  return (
    <span
      className="tc-media-error"
      role="group"
      aria-label={`${copy.title} ${copy.body}`}
      data-tone={copy.tone}
      data-compact={compact ? '' : undefined}
      title={compact ? copy.body : undefined}
      style={box ? { width: box.width, height: box.height } : undefined}
    >
      <span className="tc-media-error-code" aria-hidden="true">{mediaErrorCode(status)}</span>
      <span className="tc-media-error-title">{copy.title}</span>
      {!compact && <span className="tc-media-error-body">{copy.body}</span>}
      {copy.retry && onRetry && (
        <button
          type="button"
          className="tc-media-error-retry"
          onClick={(e) => {
            e.stopPropagation()
            onRetry()
          }}
        >
          Try again
        </button>
      )}
    </span>
  )
}
