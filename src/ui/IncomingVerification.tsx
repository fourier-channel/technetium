import { useEffect, useState } from 'react'
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api/CryptoEvent'
import type { VerificationRequest, Verifier, ShowSasCallbacks } from 'matrix-js-sdk/lib/crypto-api/verification'
import { VerificationRequestEvent, VerifierEvent } from 'matrix-js-sdk/lib/crypto-api/verification'
import { VerificationMethod } from 'matrix-js-sdk/lib/types'
import { useClient } from '../client/clientContextValue'
import { e2eeEnabled } from '../client/crypto'
import { verificationStage } from './../client/verificationStage'

// An incoming verification request, shown wherever the user happens to be.
//
// This exists because building only the side that STARTS a verification leaves
// a flow that can never finish: the other device has to accept, and if nothing
// in the app is listening, the request sits unanswered and the person who
// started it watches a spinner forever. Found by trying to prove the feature
// rather than by reading it.
//
// Global rather than inside Settings, because a request arrives when the other
// device decides to send it, not when you happen to have a panel open.
export function IncomingVerification() {
  // cryptoLoad is read ONLY to re-run the effect below when the engine
  // arrives. See the dependency list.
  const { client, cryptoLoad } = useClient()
  const [request, setRequest] = useState<VerificationRequest | null>(null)
  const [emoji, setEmoji] = useState<{ symbol: string; name: string }[]>([])
  const [phase, setPhase] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!client || !e2eeEnabled()) return
    // Crypto attaches AFTER the client exists. This effect used to depend on
    // [client] alone, so a mount that happened in that window returned here and
    // never ran again -- the listener was never registered for the whole
    // session, and an incoming verification request produced no window at all.
    // Reported live on 2026-09-10: "if I attempt it from Element, no window
    // even pops up". Keying on cryptoLoad re-runs this the moment the engine is
    // up.
    if (!client.getCrypto()) return

    let verifier: Verifier | null = null
    let current: VerificationRequest | null = null

    const onSas = (cb: ShowSasCallbacks) => {
      queueMicrotask(() => setEmoji((cb.sas?.emoji ?? []).map(([symbol, name]) => ({ symbol, name }))))
    }

    let starting = false
    const onChange = () => {
      // NAME THE METHOD. Accepting only moves the request to READY (phase 3);
      // it does not begin anything. If neither side then starts a method, both
      // sit on "Compare emojis" forever -- which is exactly what the asking
      // side was fixed for on 2026-09-07, and this side still had the same
      // hole. Found live on 2026-09-10 with Element asking and this client
      // accepting: two spinners, no error anywhere.
      //
      // Either side may start after READY, and starting twice is harmless
      // (the second is ignored), so it is safer to start than to wait for a
      // peer that may be waiting for us.
      if (current?.phase === 3 && !current.verifier && !starting) {
        starting = true
        void current.startVerification(VerificationMethod.Sas).catch((e: unknown) => {
          queueMicrotask(() => setErr(String((e as Error)?.message ?? e)))
        })
      }
      const v = current?.verifier
      if (v && v !== verifier) {
        verifier = v
        v.on(VerifierEvent.ShowSas, onSas)
        void v.verify().catch(() => {})
      }
      queueMicrotask(() => setPhase(current?.phase ?? null))
    }

    const onRequest = (req: VerificationRequest) => {
      // Only one at a time. A second request while one is open is rare and the
      // honest thing is to leave the first alone rather than swap it out from
      // under whoever is comparing pictures.
      if (current) return
      current = req
      req.on(VerificationRequestEvent.Change, onChange)
      queueMicrotask(() => { setRequest(req); setPhase(req.phase ?? null) })
    }

    client.on(CryptoEvent.VerificationRequestReceived, onRequest)
    return () => {
      client.off(CryptoEvent.VerificationRequestReceived, onRequest)
      current?.off(VerificationRequestEvent.Change, onChange)
      verifier?.off(VerifierEvent.ShowSas, onSas)
    }
  }, [client, cryptoLoad])

  if (!request) return null
  const stage = verificationStage(phase, emoji.length > 0)
  const close = () => { setRequest(null); setEmoji([]); setPhase(null) }

  return (
    <div className="tc-verify tc-verify--incoming" role="alertdialog" aria-label="Verification request" data-phase={phase ?? ''}>
      <strong className={`tc-tone-${stage.verified ? 'ok' : stage.name === 'cancelled' ? 'bad' : 'warn'}`}>
        {stage.name === 'waiting' ? 'Another device wants to verify with this one.' : stage.headline}
      </strong>
      <p className="tc-settings-note">
        {stage.name === 'waiting' ? 'Only accept this if you started it yourself, just now.' : stage.instruction}
      </p>
      {emoji.length > 0 && (
        <ul className="tc-verify-emoji">
          {emoji.map((e, i) => (
            <li key={`${e.name}-${i}`}><span aria-hidden="true">{e.symbol}</span><span>{e.name}</span></li>
          ))}
        </ul>
      )}
      {err && <p className="tc-settings-note tc-tone-bad">This device could not accept: {err}</p>}
      <div className="tc-verify-actions">
        {stage.name === 'waiting' && (
          <button
            type="button"
            onClick={() => {
              // The rejection is SHOWN, not swallowed: an accept that fails
              // silently is indistinguishable from one that did nothing, and
              // that cost an hour of chasing the wrong thing.
              request.accept().catch((e: unknown) => setErr(String((e as Error)?.message ?? e)))
            }}
          >
            Accept
          </button>
        )}
        {stage.canConfirm && (
          <>
            <button type="button" onClick={() => { void request.verifier?.getShowSasCallbacks()?.confirm() }}>They match</button>
            <button type="button" onClick={() => { request.verifier?.getShowSasCallbacks()?.mismatch() }}>They do NOT match</button>
          </>
        )}
        {stage.canCancel && <button type="button" onClick={() => { void request.cancel(); close() }}>Decline</button>}
        {stage.terminal && <button type="button" onClick={close}>Close</button>}
      </div>
    </div>
  )
}
