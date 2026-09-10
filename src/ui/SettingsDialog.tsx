import { useEffect, useRef, useState } from 'react'
import { useClient } from '../client/clientContextValue'
import { e2eeEnabled, e2eeFromBuild, observeCryptoIdentity, observeKeyBackup } from '../client/crypto'
import { applyOptIn, browserOptInStore, needsReload, readOptIn } from '../client/e2eeOptIn'
import type { CryptoIdentityFacts } from '../client/cryptoIdentity'
import type { KeyBackupFacts } from '../client/keyBackup'
import { encryptionSummary, type EncryptionAction } from './encryptionSummary'
import { recoveryPlan } from '../client/recoveryPlan'
import { createRecovery, restoreFromRecoveryKey, type RestoreOutcome } from '../client/recovery'
import { observeRecoveryKeyFacts, changeRecoveryKey } from '../client/recovery'
import { recoveryKeyChangePlan, RECOVERY_KEY_CHANGE_TEXT, type RecoveryKeyChangeFacts } from '../client/recoveryKeyPlan'
import { listSessions, endSessions, type ListOutcome } from '../client/masSessions'
import { purgePlan, describeSessions } from '../client/sessionPurgePlan'
import { loadSession } from '../client/session'
import { deviceTrustLabel, observeOwnDevices, type OwnDevice } from '../client/ownDevices'
import { startDeviceVerification, type VerificationHandle, type VerificationView } from '../client/verification'
import { verificationStage } from '../client/verificationStage'
import { gateBlockers, resetCopy, resetPlan } from '../client/resetPlan'
import { exportRoomKeys, performReset } from '../client/cryptoReset'

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
  'reset-encryption': 'Start over by resetting your encryption. Last resort, and it destroys things -- see the section at the bottom.',
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
  'storage-broken': 'Your recovery is set up on the server but its key description is missing, so no key can be checked against it. Fix it from another client -- in Element: Settings, Security & Privacy, Secure Backup -- then try again here.',
  failed: 'That did not work, and the reason was not something this could name.',
}

// Which colour each outcome earns. Green only for the one that worked; amber
// for "your input, try again"; red for "something is broken".
const RESTORE_TONE: Record<RestoreOutcome, 'ok' | 'warn' | 'bad'> = {
  restored: 'ok',
  'bad-key': 'warn',
  'wrong-key': 'warn',
  'no-backup': 'bad',
  'no-crypto': 'bad',
  'storage-broken': 'bad',
  failed: 'bad',
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
  // The reply to whatever was just pressed. TONED: a success in an amber box
  // reads as a warning, which is how "Restored" looked the first time.
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'warn' | 'bad' } | null>(null)
  const [reload, setReload] = useState(0)
  const [devices, setDevices] = useState<OwnDevice[] | null>(null)
  // What a new recovery key would need from this device (recoveryKeyPlan.ts).
  const [keyFacts, setKeyFacts] = useState<RecoveryKeyChangeFacts | null>(null)
  const [rotating, setRotating] = useState(false)
  // This account's sessions as MAS sees them; null until read.
  const [sessions, setSessions] = useState<ListOutcome | null>(null)
  const [purge, setPurge] = useState<'unverified' | 'others' | null>(null)
  const [purgeBusy, setPurgeBusy] = useState(false)
  const [purgeNote, setPurgeNote] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [vview, setVview] = useState<VerificationView | null>(null)
  const [vhandle, setVhandle] = useState<VerificationHandle | null>(null)
  // E11. Closed by default and not a button: opening it is itself a step, so
  // nobody arrives at a destructive control by scrolling.
  const [resetOpen, setResetOpen] = useState(false)
  const [exported, setExported] = useState(false)
  const [cannotExport, setCannotExport] = useState(false)
  const [typedId, setTypedId] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetNote, setResetNote] = useState<string | null>(null)
  // MAS owns the approval for replacing an identity (MSC3861), so the reset
  // pauses here while the user goes and does it.
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null)
  const approvalResolve = useRef<((ok: boolean) => void) | null>(null)
  // The runtime switch. `optIn` is what is STORED; e2eeEnabled() is what this
  // session actually started with. They disagree between flipping the switch
  // and reloading, and saying so is the whole point of `pendingReload`.
  const [optIn, setOptIn] = useState(() => readOptIn(browserOptInStore))
  const [passphrase, setPassphrase] = useState('')
  const [optInNote, setOptInNote] = useState<string | null>(null)
  const [pendingReload, setPendingReload] = useState(false)

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
        const issuer = loadSession()?.oidc.issuer
        const token = client.getAccessToken()
        const [i, b, d, k, sess] = await Promise.all([
          observeCryptoIdentity(client), observeKeyBackup(client), observeOwnDevices(client),
          observeRecoveryKeyFacts(client),
          issuer && token ? listSessions(issuer, token) : Promise.resolve<ListOutcome>('failed'),
        ])
        if (cancelled) return
        setIdentity(i)
        setBackup(b)
        setDevices(d)
        setKeyFacts(k)
        setSessions(sess)
        setRead(true)
      })()
    })
    return () => { cancelled = true }
  }, [client, reload])

  const flipOptIn = (on: boolean) => {
    const before = readOptIn(browserOptInStore)
    const result = applyOptIn(browserOptInStore, passphrase, on)
    if (result === 'bad-passphrase') {
      setOptInNote('That passphrase is not right, or this browser refused to store the setting.')
      return
    }
    const after = readOptIn(browserOptInStore)
    setOptIn(after)
    setPassphrase('')
    setOptInNote(null)
    setPendingReload(needsReload(before, after))
  }

  // ONE definition of "this device is verified". The headline and the device
  // row both read crossSigningVerified from the SDK, but at different moments
  // during the same reload, and right after a restore that moment matters --
  // the device's own signature lands asynchronously. Seen live: "This device
  // is verified" printed above a row saying "verified on this device only".
  // The row also drives the Verify button, so it is the reading the user can
  // act on; the headline takes it from there rather than from its own read.
  const thisRow = devices?.find((d) => d.isThisDevice)
  const identityForSummary = identity && thisRow
    ? { ...identity, thisDeviceVerified: thisRow.crossSigningVerified }
    : identity
  const summary = encryptionSummary(e2eeEnabled(), identityForSummary, backup)
  const plan = recoveryPlan(identity, backup)

  const doCreate = async () => {
    if (!client) return
    setBusy(true)
    setNote(null)
    const result = await createRecovery(client, plan)
    setBusy(false)
    setConfirming(false)
    if (typeof result === 'string') {
      // A refusal has to say what to do INSTEAD, or the user reads it as the app
      // being broken and goes looking for a worse way round.
      setNote({ tone: result !== 'refused-by-plan' ? 'bad' : 'warn', text:
        result !== 'refused-by-plan'
          ? 'Recovery could not be set up. Nothing was changed that this can see.'
          : plan === 'refuse-would-replace-identity'
            ? 'Refused: this account already has an encryption identity that this device cannot use. Verify this device against one you already trust, or enter your recovery key. If you have neither, use the reset at the bottom of this panel.'
            : 'Refused: something already exists that this would have replaced.',
      })
      return
    }
    setNewKey(result.recoveryKey)
  }

  const keyPlan = keyFacts ? recoveryKeyChangePlan(keyFacts) : null

  const doRotate = async () => {
    if (!client || !keyPlan) return
    setBusy(true)
    setNote(null)
    const result = await changeRecoveryKey(client, keyPlan)
    setBusy(false)
    setRotating(false)
    if (typeof result === 'string') {
      setNote({ tone: 'bad', text: result === 'refused-by-plan'
        ? 'Refused: this device cannot carry everything a new key would need.'
        : 'A new recovery key could not be made. Your current one still works.' })
      return
    }
    setNewKey(result.recoveryKey)
  }

  const masIssuer = loadSession()?.oidc.issuer ?? null
  const verifiedIds = new Set((devices ?? []).filter((d) => d.crossSigningVerified).map((d) => d.deviceId))
  const purgeable = Array.isArray(sessions) ? purgePlan(sessions, client?.getDeviceId() ?? null, verifiedIds) : null
  const purgeList = purgeable && purge ? purgeable[purge] : []

  const doPurge = async () => {
    const token = client?.getAccessToken()
    if (!masIssuer || !token || purgeList.length === 0) return
    setPurgeBusy(true)
    const r = await endSessions(masIssuer, token, purgeList)
    setPurgeBusy(false)
    setPurge(null)
    setPurgeNote(r.failed === 0
      ? `Signed out ${r.ended} session${r.ended === 1 ? '' : 's'}.`
      : `Signed out ${r.ended}; ${r.failed} could not be ended.`)
    setReload((n) => n + 1)
  }

  const beginVerify = async (deviceId: string) => {
    if (!client) return
    setNote(null)
    setVerifying(deviceId)
    setVview({ phase: null, emoji: [] })
    const handle = await startDeviceVerification(client, deviceId, setVview)
    if (!handle) { setVerifying(null); setNote({ text: 'Verification could not be started.', tone: 'bad' }); return }
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
    setNote({ text: RESTORE_TEXT[outcome], tone: RESTORE_TONE[outcome] })
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

      {/* The switch comes FIRST. Everything below is hidden while encryption is
          off, so a switch placed further down would be a control you can only
          reach once you no longer need it. */}
      <div className="tc-settings-optin">
        {e2eeFromBuild() ? (
          <p className="tc-settings-note">Encryption is turned on in this build. There is nothing to switch here.</p>
        ) : optIn ? (
          <>
            <p className="tc-settings-note">Encryption is turned on for this browser.</p>
            <button type="button" onClick={() => flipOptIn(false)}>Turn encryption off</button>
          </>
        ) : (
          <>
            <p className="tc-settings-note">
              Encryption is off. Turning it on is for testing, and needs the passphrase you were given.
            </p>
            <div className="tc-settings-confirm">
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Passphrase"
                aria-label="Encryption passphrase"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" disabled={!passphrase.trim()} onClick={() => flipOptIn(true)}>
                Turn encryption on
              </button>
            </div>
          </>
        )}
        {optInNote && <p className="tc-settings-note tc-tone-warn">{optInNote}</p>}
        {pendingReload && (
          <p className="tc-settings-note tc-tone-warn">
            {/* Not cosmetic: crypto is built once, with the client. Until this
                page reloads, the setting is stored and inert -- and claiming
                otherwise would put encryption UI over a client that has no
                crypto at all. */}
            Saved. It takes effect when the page reloads.{' '}
            <button type="button" onClick={() => { window.location.reload() }}>Reload now</button>
          </p>
        )}
      </div>

      {!read ? (
        <p className="tc-settings-note">Reading this account&apos;s encryption state...</p>
      ) : (
        <>
          <p className={`tc-settings-headline tc-tone-${summary.tone}`}>{summary.headline}</p>
          <ul className="tc-settings-detail">
            {summary.detail.map((line) => <li key={line}>{line}</li>)}
          </ul>
          {/* Feedback from the controls below, rendered HERE and not at the
              bottom of the panel. It used to sit under the device list, so
              pressing "Unlock older messages" flickered the button and put the
              answer below the fold. Reported 2026-09-10 as the button
              "disappearing for a second and returning" -- which is precisely
              what a reply rendered off-screen looks like from the top.
              Always rendered when the panel has been read, so a success note
              survives the action list emptying on the re-observe it triggers. */}
          {note && (
            <p className={`tc-settings-note tc-settings-feedback tc-tone-${note.tone}`} role="status">{note.text}</p>
          )}
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

              {summary.actions.includes('connect-backup') && (
                <p className="tc-settings-note">
                  Connecting to an existing key backup is not built yet. Verifying a device is --
                  use the Verify button beside it under Your devices.
                </p>
              )}
            </>
          )}

          {/* Replacing the recovery key. Offered only when this device holds
              everything the new storage must carry (recoveryKeyPlan.ts); a
              refusal says what to do first rather than hiding the control. */}
          {e2eeEnabled() && keyPlan && keyFacts?.secretStorageReady && (
            <div className="tc-settings-rotate">
              <h4 className="tc-settings-subhead">Recovery key</h4>
              {keyPlan !== 'ok' ? (
                <p className="tc-settings-note">{RECOVERY_KEY_CHANGE_TEXT[keyPlan]}</p>
              ) : rotating ? (
                <div className="tc-settings-confirm">
                  <p>Your current recovery key stops working. Your identity and your key backup stay exactly as they are and move under the new key.</p>
                  <button type="button" disabled={busy} onClick={() => { void doRotate() }}>
                    {busy ? 'Working...' : 'Yes, make a new key'}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setRotating(false)}>Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => setRotating(true)}>Make a new recovery key</button>
              )}
            </div>
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

      {/* Sessions, as MAS sees them. The device list above is only the
          sessions holding keys; an account collects many more, and ending
          them one at a time on the account page is the thing this replaces. */}
      {read && e2eeEnabled() && sessions !== null && (
        <>
          <h3 className="tc-settings-head">Sessions</h3>
          {sessions === 'no-scope' ? (
            <p className="tc-settings-note">
              This sign-in is from before session management was added here. Sign out and back in, and this panel can end sessions in bulk.
              {masIssuer && (
                <>
                  {' '}Until then, <a href={`${masIssuer}account/?action=org.matrix.sessions_list`} target="_blank" rel="noopener noreferrer">manage them on the account page</a>.
                </>
              )}
            </p>
          ) : sessions === 'failed' || !purgeable ? (
            <p className="tc-settings-note">This account&apos;s sessions could not be read just now.</p>
          ) : (
            <>
              <p className="tc-settings-note">
                {sessions.length} session{sessions.length === 1 ? ' is' : 's are'} signed in to this account, this one included.
                {' '}{purgeable.unverified.length} {purgeable.unverified.length === 1 ? 'is' : 'are'} not a verified device.
              </p>
              {purgeNote && <p className="tc-settings-note tc-tone-ok" role="status">{purgeNote}</p>}
              {purge ? (
                <div className="tc-settings-confirm">
                  <p>These {purgeList.length} sessions will be signed out. Any of them that held keys not backed up loses them.</p>
                  <ul className="tc-settings-detail">
                    {describeSessions(purgeList).map((line) => <li key={line}>{line}</li>)}
                  </ul>
                  <button type="button" disabled={purgeBusy} onClick={() => { void doPurge() }}>
                    {purgeBusy ? 'Signing out...' : 'Sign them out'}
                  </button>
                  <button type="button" disabled={purgeBusy} onClick={() => setPurge(null)}>Cancel</button>
                </div>
              ) : (
                <div className="tc-settings-actions">
                  <button type="button" disabled={purgeable.unverified.length === 0} onClick={() => { setPurgeNote(null); setPurge('unverified') }}>
                    Sign out the {purgeable.unverified.length} unverified
                  </button>
                  <button type="button" disabled={purgeable.others.length === 0} onClick={() => { setPurgeNote(null); setPurge('others') }}>
                    Sign out all {purgeable.others.length} others
                  </button>
                </div>
              )}
            </>
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

      {/* E11 -- the destructive reset.
          LAST in the panel, closed by default, and behind two independent
          gates: an export (or an admission you cannot make one) and your own
          Matrix ID typed out. Everything above this exists to keep people from
          needing it. */}
      {read && e2eeEnabled() && identity?.accountHasIdentity && (() => {
        const plan = resetPlan(identity)
        const copy = resetCopy(plan)
        const myId = client?.getUserId() ?? ''
        const gate = { exportedOrAcknowledged: exported || cannotExport, typedMatrixId: typedId }
        const blockers = gateBlockers(gate, myId, plan)
        const doExport = async () => {
          if (!client) return
          const json = await exportRoomKeys(client)
          if (!json) { setResetNote('The export could not be made. Nothing has been changed.'); return }
          const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
          const a = document.createElement('a')
          a.href = url
          a.download = `element-keys-${myId.replace(/[^a-z0-9]/gi, '-')}.json`
          a.click()
          URL.revokeObjectURL(url)
          setExported(true)
          setResetNote('Export saved. Keep it somewhere you will still have after this.')
        }
        const doReset = async () => {
          if (!client) return
          setResetBusy(true)
          setResetNote(null)
          const approve = (url: string) => new Promise<boolean>((resolve) => {
            approvalResolve.current = resolve
            setApprovalUrl(url)
            // noopener: this is a URL from a server response, and the new tab
            // must not get a handle on this one.
            window.open(url, '_blank', 'noopener')
          })
          const out = await performReset(client, gate, plan, myId, approve)
          setApprovalUrl(null)
          approvalResolve.current = null
          setResetBusy(false)
          if (out.ok) {
            // A reset that ends here leaves the user with a fresh identity and NO
            // recovery -- one lost device from the hole they just climbed out
            // of. The panel reloads into "set up a recovery key"; this says why
            // that is the next thing and not an optional extra.
            setResetNote('Done. Now set up a recovery key below -- until you do, losing this device puts you straight back here. Then re-verify your other devices, and import your export if you saved one.')
            setResetOpen(false)
            setTypedId('')
            setExported(false)
            setCannotExport(false)
            setReload((n) => n + 1)
            return
          }
          // Naming the STEP matters: a failure after cross-signing leaves a
          // different account than a failure before it.
          setResetNote(
            out.reason === 'refused-by-gate' ? out.blockers.join(' ')
              : out.reason === 'no-crypto' ? 'Encryption is not running in this session.'
              // Declined is not failed. Nothing was destroyed and nothing needs
              // apologising for.
              : out.reason === 'not-approved' ? 'Not approved, so nothing was changed. You can start again whenever you want to.'
              : `The reset failed at the ${out.step} step. ${out.detail.slice(0, 120)}`,
          )
        }
        return (
          <div className="tc-reset">
            <h3 className="tc-settings-head">If you have lost everything</h3>
            {!resetOpen ? (
              <>
                <p className="tc-settings-note">
                  Locked out of every device with no recovery key? There is one way back, and it
                  destroys things permanently. Read it before you decide.
                </p>
                <button type="button" onClick={() => setResetOpen(true)}>Show me the reset</button>
              </>
            ) : (
              <>
                <p className="tc-settings-note tc-tone-warn">
                  This cannot be undone by you, by anyone else, or by the server.
                </p>
                <h4 className="tc-settings-subhead">What you lose</h4>
                <ul className="tc-settings-detail">{copy.willLose.map((l) => <li key={l}>{l}</li>)}</ul>
                <h4 className="tc-settings-subhead">What you keep</h4>
                <ul className="tc-settings-detail">{copy.willKeep.map((l) => <li key={l}>{l}</li>)}</ul>

                <h4 className="tc-settings-subhead">1. Save your keys</h4>
                <div className="tc-settings-confirm">
                  <button type="button" disabled={resetBusy} onClick={() => { void doExport() }}>
                    {exported ? 'Save the export again' : 'Save a key export'}
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={cannotExport}
                      onChange={(e) => setCannotExport(e.target.checked)}
                    />{' '}
                    I cannot make an export
                  </label>
                </div>

                <h4 className="tc-settings-subhead">2. Confirm it is you</h4>
                <p className="tc-settings-note">
                  Type <code className="tc-settings-keytext">{myId}</code> to continue.
                </p>
                <div className="tc-settings-confirm">
                  <input
                    type="text"
                    value={typedId}
                    onChange={(e) => setTypedId(e.target.value)}
                    placeholder="@you:41chan.net"
                    aria-label="Type your Matrix ID to confirm the reset"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                {approvalUrl && (
                  <div className="tc-settings-confirm tc-tone-warn">
                    <p>
                      Your account settings opened in another tab. Approve the reset there,
                      then come back and press Continue. Nothing has been changed yet.
                    </p>
                    <button type="button" onClick={() => { approvalResolve.current?.(true) }}>
                      I approved it -- continue
                    </button>
                    <button type="button" onClick={() => { approvalResolve.current?.(false) }}>
                      Cancel
                    </button>
                  </div>
                )}
                {blockers.length > 0 && (
                  <ul className="tc-settings-detail tc-tone-warn">
                    {blockers.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                )}
                <div className="tc-settings-confirm">
                  <button
                    type="button"
                    className="tc-reset-go"
                    disabled={resetBusy || blockers.length > 0}
                    onClick={() => { void doReset() }}
                  >
                    {resetBusy ? 'Working...' : 'Reset my encryption permanently'}
                  </button>
                  <button type="button" disabled={resetBusy} onClick={() => setResetOpen(false)}>
                    Cancel
                  </button>
                </div>
              </>
            )}
            {resetNote && <p className="tc-settings-note">{resetNote}</p>}
          </div>
        )
      })()}
    </div>
  )
}
