import { useEffect, useState } from 'react'
import { useClient } from '../client/clientContextValue'
import { e2eeEnabled, observeCryptoIdentity, observeKeyBackup } from '../client/crypto'
import type { CryptoIdentityFacts } from '../client/cryptoIdentity'
import type { KeyBackupFacts } from '../client/keyBackup'
import { encryptionSummary, type EncryptionAction } from './encryptionSummary'
import { recoveryPlan } from '../client/recoveryPlan'
import { createRecovery, restoreFromRecoveryKey, type RestoreOutcome } from '../client/recovery'
import { deviceTrustLabel, observeOwnDevices, type OwnDevice } from '../client/ownDevices'
import { startDeviceVerification, type VerificationHandle, type VerificationView } from '../client/verification'
import { verificationStage } from '../client/verificationStage'

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

// What the restore told us, in the user's terms. A key that is not a key and a
// key that is the wrong one are different problems with different fixes, and
// collapsing them into "that didn't work" makes the second one unsolvable.
const RESTORE_TEXT: Record<RestoreOutcome, string> = {
  restored: 'Restored. Older messages should open now.',
  'bad-key': 'That does not look like a recovery key. Check for missing characters.',
  'wrong-key': 'That is a recovery key, but not the one this backup was made with.',
  'no-backup': 'There is no key backup on the server to restore from.',
  'no-crypto': 'Encryption is not running in this session.',
  failed: 'That did not work, and the reason was not something this could name.',
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { client } = useClient()
  const [identity, setIdentity] = useState<CryptoIdentityFacts | null>(null)
  const [backup, setBackup] = useState<KeyBackupFacts | null>(null)
  const [read, setRead] = useState(false)
  const [busy, setBusy] = useState(false)
  // Shown ONCE, and never stored anywhere by us. It lives in component state
  // for exactly as long as the user is looking at it.
  const [newKey, setNewKey] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [typedKey, setTypedKey] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [devices, setDevices] = useState<OwnDevice[] | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [vview, setVview] = useState<VerificationView | null>(null)
  const [vhandle, setVhandle] = useState<VerificationHandle | null>(null)

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
        const [i, b, d] = await Promise.all([
          observeCryptoIdentity(client), observeKeyBackup(client), observeOwnDevices(client),
        ])
        if (cancelled) return
        setIdentity(i)
        setBackup(b)
        setDevices(d)
        setRead(true)
      })()
    })
    return () => { cancelled = true }
  }, [client, reload])

  const summary = encryptionSummary(e2eeEnabled(), identity, backup)
  const plan = recoveryPlan(identity, backup)

  const doCreate = async () => {
    if (!client) return
    setBusy(true)
    setNote(null)
    const result = await createRecovery(client, plan)
    setBusy(false)
    setConfirming(false)
    if (typeof result === 'string') {
      setNote(result === 'refused-by-plan'
        ? 'Refused: something already exists that this would have replaced.'
        : 'Recovery could not be set up. Nothing was changed that this can see.')
      return
    }
    setNewKey(result.recoveryKey)
  }

  const beginVerify = async (deviceId: string) => {
    if (!client) return
    setNote(null)
    setVerifying(deviceId)
    setVview({ phase: null, emoji: [] })
    const handle = await startDeviceVerification(client, deviceId, setVview)
    if (!handle) { setVerifying(null); setNote('Verification could not be started.'); return }
    setVhandle(handle)
  }

  const endVerify = (refresh: boolean) => {
    vhandle?.stop()
    setVhandle(null)
    setVerifying(null)
    setVview(null)
    if (refresh) setReload((n) => n + 1)
  }

  const doRestore = async () => {
    if (!client) return
    setBusy(true)
    const outcome = await restoreFromRecoveryKey(client, typedKey)
    setBusy(false)
    setNote(RESTORE_TEXT[outcome])
    if (outcome === 'restored') {
      setTypedKey('')
      setReload((n) => n + 1)
    }
  }

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
              {/* Only the built ones are offered. The rest stay named but
                  unoffered: a button that does nothing when pressed is worse
                  than an honest list. */}
              {(summary.actions.includes('set-up-recovery') || summary.actions.includes('create-backup')) && (
                confirming ? (
                  <div className="tc-settings-confirm">
                    <p>This creates an identity and a key backup on your account, and gives you a recovery key to write down. It will not replace anything you already have.</p>
                    <button type="button" disabled={busy} onClick={() => { void doCreate() }}>
                      {busy ? 'Working...' : 'Yes, set it up'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirming(true)}>Set up recovery</button>
                )
              )}

              {summary.actions.includes('restore-from-key') && (
                <div className="tc-settings-restore">
                  <label htmlFor="tc-recovery-key">Recovery key</label>
                  <input
                    id="tc-recovery-key"
                    value={typedKey}
                    onChange={(e) => setTypedKey(e.target.value)}
                    placeholder="paste it here"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button type="button" disabled={busy || !typedKey.trim()} onClick={() => { void doRestore() }}>
                    {busy ? 'Working...' : 'Unlock older messages'}
                  </button>
                </div>
              )}

              {(summary.actions.includes('verify-this-device') || summary.actions.includes('connect-backup')) && (
                <p className="tc-settings-note">
                  Verifying a device and connecting to an existing backup are not built yet.
                </p>
              )}
            </>
          )}
        </>
      )}

      {read && e2eeEnabled() && (
        <>
          <h3 className="tc-settings-head">Your devices</h3>
          {devices === null ? (
            // null is "we could not find out", which must never be drawn as
            // "you have no devices" -- that reads as nothing to verify against.
            <p className="tc-settings-note">This account&apos;s devices could not be read just now.</p>
          ) : (
            <ul className="tc-settings-devices">
              {devices.map((d) => (
                <li key={d.deviceId} data-device-id={d.deviceId}>
                  {/* The ID is shown ALWAYS, not just as a fallback. Every
                      session of this client picks the same display name, so a
                      real account ends up with a column of identical rows and
                      no way to tell which one you are about to trust --
                      measured on the test account: fourteen devices, one
                      name. A verification you cannot aim is not a
                      verification. */}
                  <span className="tc-device-name">
                    {d.displayName || 'unnamed device'}
                    <span className="tc-device-id"> {d.deviceId}</span>
                  </span>
                  {d.isThisDevice && <span className="tc-device-here"> this device</span>}
                  <span className={`tc-device-trust tc-trust-${d.crossSigningVerified ? 'ok' : d.locallyVerified ? 'local' : 'no'}`}>
                    {deviceTrustLabel(d)}
                  </span>
                  {/* This device cannot verify itself, and one already
                      cross-signed has nothing to gain. */}
                  {!d.isThisDevice && !d.crossSigningVerified && !verifying && (
                    <button type="button" onClick={() => { void beginVerify(d.deviceId) }}>Verify</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {verifying && vview && (() => {
        const stage = verificationStage(vview.phase, vview.emoji.length > 0)
        return (
          <div className="tc-verify" role="group" aria-label="Device verification" data-phase={vview.phase ?? ''}>
            <strong className={`tc-tone-${stage.verified ? 'ok' : stage.name === 'cancelled' ? 'bad' : 'warn'}`}>
              {stage.headline}
            </strong>
            <p className="tc-settings-note">{stage.instruction}</p>
            {vview.emoji.length > 0 && (
              <ul className="tc-verify-emoji">
                {vview.emoji.map((e, i) => (
                  <li key={`${e.name}-${i}`}><span aria-hidden="true">{e.symbol}</span><span>{e.name}</span></li>
                ))}
              </ul>
            )}
            <div className="tc-verify-actions">
              {stage.canConfirm && (
                <>
                  <button type="button" onClick={() => { void vhandle?.confirm() }}>They match</button>
                  {/* A separate call from cancel: this tells the other side the
                      codes differed, which is a security signal rather than
                      "not now". */}
                  <button type="button" onClick={() => { void vhandle?.mismatch() }}>They do NOT match</button>
                </>
              )}
              {stage.canCancel && (
                <button type="button" onClick={() => { void vhandle?.cancel(); endVerify(false) }}>Stop</button>
              )}
              {stage.terminal && (
                <button type="button" onClick={() => endVerify(stage.verified)}>Close</button>
              )}
            </div>
          </div>
        )
      })()}

      {note && <p className="tc-settings-note">{note}</p>}

      {newKey && (
        <div className="tc-settings-key" role="alertdialog" aria-label="Your recovery key">
          <strong>Write this down now.</strong>
          <p>
            This is the only time it is shown. If you lose it and lose your devices, those
            conversations cannot be recovered by anyone, including the server.
          </p>
          <code className="tc-settings-keytext">{newKey}</code>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(newKey).catch(() => {}) }}>Copy</button>
          <button
            type="button"
            onClick={() => { setNewKey(null); setReload((n) => n + 1) }}
          >
            I have written it down
          </button>
        </div>
      )}
    </div>
  )
}
