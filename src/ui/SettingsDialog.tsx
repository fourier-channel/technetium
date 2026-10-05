import { useEffect, useState } from 'react'
import { useClient } from '../client/clientContextValue'
import { applyDomainOptIn, domainOptInStore, domainEnabled } from '../client/domainMode'
import { clientTokenSource } from '../client/masSessions'
import { loadSession } from '../client/session'
import { observeServerAdmin, type AdminFacts } from '../client/serverAdmin'
import { ServerPermissions } from './ServerPermissions'

// Settings: what this account ADMINISTERS -- server permissions, and the
// unfinished features an administrator can try on one browser. Encryption
// and the sign-in itself moved to Manage session, under your name in the
// room list (operator, 2026-10-05); the panel says so to anyone who opens it
// looking for them.

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { client } = useClient()
  // U8. Which tab is up, and whether the server says this account administers
  // it. `null` until asked -- absent is not "no" (VERIFICATION-DOCTRINE rule 8),
  // and the panel says which of the three answers it got.
  const [tab, setTab] = useState<'server' | 'features'>('server')
  // Domain mode's per-browser switch. `domainOn` is what is STORED; whether
  // the feature is actually offered also depends on the build, which this
  // panel says out loud rather than leaving the switch looking broken.
  const [domainOn, setDomainOn] = useState(() => domainEnabled())
  const [domainPass, setDomainPass] = useState('')
  const [domainNote, setDomainNote] = useState<string | null>(null)
  const [admin, setAdmin] = useState<AdminFacts | null>(null)

  // Asked once per open. Read-only: it is a GET that answers yes or 403.
  useEffect(() => {
    if (!client) return
    let cancelled = false
    queueMicrotask(() => {
      void (async () => {
        const facts = await observeServerAdmin(client, clientTokenSource(client), fetch, loadSession()?.oidc.issuer ?? null)
        if (!cancelled) setAdmin(facts)
      })()
    })
    return () => { cancelled = true }
  }, [client])

  return (
    <div
      className="tc-settings"
      // ONE size for every tab (operator, 2026-09-30: "give it a standard size
      // that doesn't change when you flip between menus"). The header and the
      // tabs hold still; only the body below them scrolls.
      role="dialog"
      aria-label="Settings"
      aria-modal="true"
    >
      <div className="tc-settings-row tc-panel-head" data-inset="true">
        <strong>Settings</strong>
        <button type="button" className="tc-pill" onClick={onClose}>Done</button>
      </div>

      {/* The tab strip appears only once there is more than one tab to pick
          from, which on most accounts is never. */}
      {admin?.verdict === 'admin' && (
        <div className="tc-settings-tabs" role="tablist" aria-label="Settings sections">
          <button type="button" role="tab" aria-selected={tab === 'server'} onClick={() => setTab('server')}>
            Server permissions
          </button>
          <button type="button" role="tab" aria-selected={tab === 'features'} onClick={() => setTab('features')}>
            Unfinished features
          </button>
        </div>
      )}
      <div className="tc-settings-body">
      {/* Where encryption went. Said here because this is where people will
          look for it, and an empty panel would read as encryption gone. */}
      <p className="tc-settings-note">
        Encryption and this sign-in are under <strong>Manage session</strong>, below your name in the room list.
      </p>
      {admin === null && <p className="tc-settings-note">Checking what this account administers...</p>}
      {admin !== null && admin.verdict !== 'admin' && <p className="tc-settings-note">{admin.because} Nothing else here applies to it.</p>}
      {tab === 'server' && admin?.verdict === 'admin' && client && (
        <>
          {/* Said out loud on the panel, because the honest answer to "make
              this show up for me only" is that it hides a VIEW. Every setting
              below is room state any member can read with any client. */}
          <p className="tc-settings-note">
            {admin.because} This hides the panel, not the information: everything in it is room
            state that any member of these rooms can read with any client.
          </p>
          <ServerPermissions client={client} />
        </>
      )}

      {tab === 'features' && (
        <>
          <h3 className="tc-settings-head">Unfinished features</h3>
          {/* This tab rides the strip, which only renders for admins -- so an
              ordinary account cannot reach it. That is a consequence of the
              strip's own rule, NOT a security boundary: the passphrase ships
              in the bundle and so does this panel. It is a speed bump, said
              plainly rather than dressed up. */}
          <div className="tc-settings-optin">
            <p className="tc-settings-note">
              Domain mode is not finished and is turned off for everyone. Turning it on here
              affects this browser only, so it can be worked on against the real site.
            </p>
            {domainOn ? (
              <>
                <p className="tc-settings-note">Domain mode is on for this browser.</p>
                <button
                  className="tc-pill"
                  type="button"
                  onClick={() => {
                    applyDomainOptIn(domainOptInStore, '', false)
                    setDomainOn(false)
                    setDomainNote('Off after a reload.')
                  }}
                >
                  Turn domain mode off
                </button>
              </>
            ) : (
              <div className="tc-settings-confirm">
                <input
                  className="tc-input"
                  type="password"
                  value={domainPass}
                  onChange={(e) => setDomainPass(e.target.value)}
                  placeholder="Passphrase"
                  aria-label="Domain mode passphrase"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  className="tc-pill"
                  type="button"
                  disabled={!domainPass.trim()}
                  onClick={() => {
                    const result = applyDomainOptIn(domainOptInStore, domainPass, true)
                    if (result === 'enabled') {
                      setDomainOn(true)
                      setDomainNote('On after a reload.')
                    } else {
                      setDomainNote('That passphrase is not right, or this browser refused to store the setting.')
                    }
                    setDomainPass('')
                  }}
                >
                  Turn domain mode on
                </button>
              </div>
            )}
            {domainNote && <p className="tc-settings-note tc-tone-warn">{domainNote}</p>}
            {/* Not cosmetic: App reads the answer once per mount, so a session
                that started without it has the control unrendered. */}
            <p className="tc-settings-note">A reload is needed either way.</p>
          </div>
        </>
      )}
      </div>
    </div>
  )
}
