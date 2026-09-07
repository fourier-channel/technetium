import { useEffect, useState } from 'react'
import { useClient } from '../client/clientContextValue'
import { e2eeEnabled, observeCryptoIdentity, observeKeyBackup } from '../client/crypto'
import type { CryptoIdentityFacts } from '../client/cryptoIdentity'
import type { KeyBackupFacts } from '../client/keyBackup'
import { encryptionSummary, type EncryptionAction } from './encryptionSummary'

// What each action would do, in the user's terms. The panel names what is
// missing even where the control does not exist yet: a list of things you
// cannot do is more use than a page that implies everything is fine, and far
// more use than a button that does nothing when pressed.
const ACTION_TEXT: Record<EncryptionAction, string> = {
  'verify-this-device': 'Verify this device against one you already trust.',
  'set-up-recovery': 'Set up a recovery key, so your keys survive losing every device.',
  'restore-from-key': 'Enter your recovery key to unlock older messages on this device.',
  'connect-backup': 'Connect this session to your existing key backup.',
  'create-backup': 'Create a key backup, using the recovery you already have.',
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { client } = useClient()
  const [identity, setIdentity] = useState<CryptoIdentityFacts | null>(null)
  const [backup, setBackup] = useState<KeyBackupFacts | null>(null)
  const [read, setRead] = useState(false)

  // OBSERVE, never act. Both calls here are read-only on purpose -- see
  // observeKeyBackup, which exists because the connect path enables the backup
  // as a side effect of asking about it.
  useEffect(() => {
    if (!client || !e2eeEnabled()) { queueMicrotask(() => setRead(true)); return }
    let cancelled = false
    // queueMicrotask, as everywhere else here: G-tc01 forbids a synchronous
    // setState in an effect body, and the linter counts an await's
    // continuation as one.
    queueMicrotask(() => {
      void (async () => {
        const [i, b] = await Promise.all([observeCryptoIdentity(client), observeKeyBackup(client)])
        if (cancelled) return
        setIdentity(i)
        setBackup(b)
        setRead(true)
      })()
    })
    return () => { cancelled = true }
  }, [client])

  const summary = encryptionSummary(e2eeEnabled(), identity, backup)

  return (
    <div className="tc-settings" role="dialog" aria-label="Settings" aria-modal="true">
      <div className="tc-settings-row">
        <strong>Settings</strong>
        <button type="button" onClick={onClose}>Done</button>
      </div>

      <h3 className="tc-settings-head">Encryption</h3>
      {!read ? (
        <p className="tc-settings-note">Reading this account&apos;s encryption state...</p>
      ) : (
        <>
          <p className={`tc-settings-headline tc-tone-${summary.tone}`}>{summary.headline}</p>
          <ul className="tc-settings-detail">
            {summary.detail.map((line) => <li key={line}>{line}</li>)}
          </ul>
          {summary.actions.length > 0 && (
            <>
              <h4 className="tc-settings-subhead">What is left to do</h4>
              <ul className="tc-settings-detail">
                {summary.actions.map((a) => <li key={a}>{ACTION_TEXT[a]}</li>)}
              </ul>
              {/* Named, not offered. These controls are the next work; a button
                  that did nothing would be worse than an honest list. */}
              <p className="tc-settings-note">
                These are not built yet. They are the remaining work before encryption can be turned on for everyone.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
