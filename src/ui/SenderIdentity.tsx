import { displayDecoration, decoratedName } from './displayDecoration'

// ---------------------------------------------------------------------------
// The identity block above the first message of a cluster: the decorated name,
// and the guild tag centred beneath it. The avatar is NOT here -- it belongs to
// the message line below, where it repeats for every message in the run, and it
// lands directly under this block because this block sits directly above it.
//
// Its own file rather than a branch inside Timeline, because this layout is
// provisional: the operator wants to see it before deciding to keep it, and a
// self-contained component is a clean revert rather than an archaeology
// exercise.
//
// The guild is centred on the NAME, not on the row, which is why the name and
// the tag are wrapped in an inline-block: the wrapper is exactly as wide as the
// name, so centring inside it centres under the name however long that name is.
// ---------------------------------------------------------------------------

export function SenderIdentity({
  userId,
  name,
  time,
  onOpenProfile,
  onOpenInteractions,
}: {
  userId: string
  name: string
  time: string
  onOpenProfile?: (userId: string, x: number, y: number) => void
  onOpenInteractions?: (userId: string, x: number, y: number) => void
}) {
  const dec = displayDecoration(userId)
  return (
    <div className="tc-ident-row">
      <span className="tc-ident">
        <span
          className="tc-ident-name"
          role={onOpenProfile ? 'button' : undefined}
          tabIndex={onOpenProfile ? 0 : undefined}
          onClick={onOpenProfile ? (e) => onOpenProfile(userId, e.clientX, e.clientY) : undefined}
          onKeyDown={
            onOpenProfile
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    const r = e.currentTarget.getBoundingClientRect()
                    onOpenProfile(userId, r.left, r.bottom)
                  }
                }
              : undefined
          }
          onContextMenu={
            onOpenInteractions
              ? (e) => {
                  e.preventDefault()
                  onOpenInteractions(userId, e.clientX, e.clientY)
                }
              : undefined
          }
          title={userId}
        >
          {/* Concatenated with no separator of any kind. The whitespace, if
              any, is the decoration's own -- see displayDecoration.ts. */}
          {decoratedName(name, dec)}
        </span>
        {dec.guild !== null && <span className="tc-ident-guild">{dec.guild}</span>}
      </span>
      <span className="tc-ident-time">{time}</span>
    </div>
  )
}
