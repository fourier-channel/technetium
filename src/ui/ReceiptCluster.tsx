import type { Room } from 'matrix-js-sdk'
import { AuthedImage } from './AuthedImage'
import { initials } from '../client/members'

// W2.6 -- the "seen by" cluster at the right of the row footer.
//
// Capped, because a busy room would otherwise put fifty avatars under every
// message. The overflow count is shown rather than dropped, and the full list
// is in the tooltip.
const MAX_SHOWN = 5

export function ReceiptCluster({ room, userIds }: { room: Room | null; userIds: string[] }) {
  if (userIds.length === 0) return null

  const shown = userIds.slice(0, MAX_SHOWN)
  const overflow = userIds.length - shown.length
  const names = userIds.map((id) => room?.getMember(id)?.name || id)

  return (
    <span
      className="tc-receipts"
      title={`Seen by ${names.join(', ')}`}
      aria-label={`Seen by ${userIds.length} ${userIds.length === 1 ? 'person' : 'people'}`}
    >
      {shown.map((userId) => {
        const member = room?.getMember(userId) ?? null
        const name = member?.name || userId
        const mxc = member?.getMxcAvatarUrl() ?? null
        return (
          <span key={userId} className="tc-receipt-avatar" aria-hidden="true">
            {mxc ? (
              <AuthedImage
                mxc={mxc}
                width={180}
                fill
                transparentLoading
                alt=""
                fallback={initials(name)}
                viaHomeserver
              />
            ) : (
              initials(name)
            )}
          </span>
        )
      })}
      {overflow > 0 && (
        <span className="tc-receipt-more" aria-hidden="true">
          +{overflow}
        </span>
      )}
    </span>
  )
}
