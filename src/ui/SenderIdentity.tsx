import { displayDecoration, decoratedName } from './displayDecoration'

// ---------------------------------------------------------------------------
// The name line of the first message of a run: the decorated name, and the
// guild tag after it on the same line. Nothing else.
//
// The Discord shape (launch-polish L11, operator 2026-09-25): this sits at the
// top of the text column, beside the avatar on the run's first message, with
// the text under it. It used to be a block ABOVE the run with the avatar under
// it, built as a provisional layout in its own file so it could be reverted
// cleanly; the operator saw it and ruled it back.
//
// The avatar is NOT here -- it belongs to the message line, where the row
// renders it. Neither is the TIMESTAMP: a time is a property of a message, and
// a run is many messages, so it trails each line's own text instead.
// ---------------------------------------------------------------------------

export function SenderIdentity({
  userId,
  name,
  onOpenProfile,
  onOpenInteractions,
}: {
  userId: string
  name: string
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
    </div>
  )
}
