import { useSyncExternalStore } from 'react'
import { dismissDmNotice, dmNoticeFor, subscribeDmNotice } from '../client/dmNotice'
import { dmEncryptionNotice, willEncrypt } from '../client/dmEncryption'

// The one-time line at the top of a DM that was just created, saying whether it
// is encrypted and -- when it is not -- why. See client/dmNotice.ts for why
// this is transient and the shield badge is not.
export function DmEncryptionNotice({ roomId }: { roomId: string }) {
  const decision = useSyncExternalStore(
    subscribeDmNotice,
    () => dmNoticeFor(roomId),
    () => null,
  )
  if (!decision) return null
  const notice = dmEncryptionNotice(decision)
  const encrypted = willEncrypt(decision)
  return (
    <div className={`tc-dm-notice ${encrypted ? 'tc-dm-notice-ok' : 'tc-dm-notice-warn'}`} role="status">
      <span>{notice}</span>
      <button type="button" onClick={() => dismissDmNotice(roomId)} aria-label="Dismiss">Got it</button>
    </div>
  )
}
