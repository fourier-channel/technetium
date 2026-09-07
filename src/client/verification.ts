// Driving a device verification: request, emoji, confirm, cancel.
//
// The wording lives in verificationStage.ts, which is pure and swept. This is
// only the plumbing, and it is deliberately thin -- the SDK owns the protocol
// and the one thing this must not do is invent a state the protocol did not
// report.
import type { MatrixClient } from 'matrix-js-sdk'
import { VerificationMethod } from 'matrix-js-sdk/lib/types'
import {
  VerificationRequestEvent, VerifierEvent,
  type VerificationRequest, type Verifier, type ShowSasCallbacks,
} from 'matrix-js-sdk/lib/crypto-api/verification'

export interface VerificationView {
  // The SDK's phase, passed straight through to verificationStage().
  phase: number | null
  // Seven pictures, or empty until the protocol produces them. Never invented.
  emoji: { symbol: string; name: string }[]
}

export interface VerificationHandle {
  request: VerificationRequest
  confirm: () => Promise<void>
  mismatch: () => Promise<void>
  cancel: () => Promise<void>
  stop: () => void
}

// Start verifying one of this account's own devices, and call back on every
// change. The caller renders from what it is given and never polls.
export async function startDeviceVerification(
  client: MatrixClient,
  deviceId: string,
  onChange: (view: VerificationView) => void,
): Promise<VerificationHandle | null> {
  const crypto = client.getCrypto()
  const userId = client.getUserId()
  if (!crypto || !userId) return null

  const request = await crypto.requestDeviceVerification(userId, deviceId)
  let sas: ShowSasCallbacks | null = null
  let verifier: Verifier | null = null

  const view = (): VerificationView => ({
    phase: request.phase ?? null,
    emoji: (sas?.sas?.emoji ?? []).map(([symbol, name]) => ({ symbol, name })),
  })
  const publish = () => onChange(view())

  const onShowSas = (cb: ShowSasCallbacks) => { sas = cb; publish() }

  let starting = false

  const onPhase = () => {
    // READY means both sides have agreed to verify, and NOTHING happens next
    // unless somebody names a method. The side that asked does it. Without
    // this, both devices sit waiting for a verifier that is never created --
    // measured: the request arrived, the other device accepted, and then two
    // spinners forever.
    if (request.phase === 3 && !request.verifier && !starting) {
      starting = true
      void request.startVerification(VerificationMethod.Sas).catch((err) => {
        console.error('[crypto] could not start the emoji comparison', err)
        publish()
      })
    }
    const v = request.verifier
    if (v && v !== verifier) {
      verifier = v
      v.on(VerifierEvent.ShowSas, onShowSas)
      // Kick the SAS method off. Errors here are the protocol's to report
      // through the phase, not ours to translate into a state.
      void v.verify().catch(() => publish())
    }
    publish()
  }

  request.on(VerificationRequestEvent.Change, onPhase)
  onPhase()

  const stop = () => {
    request.off(VerificationRequestEvent.Change, onPhase)
    verifier?.off(VerifierEvent.ShowSas, onShowSas)
  }

  return {
    request,
    confirm: async () => { await sas?.confirm() },
    // A DIFFERENT call from cancel, and the difference matters: this tells the
    // other side the codes did not match, which is a security signal, whereas
    // cancel is just "not now".
    mismatch: async () => { sas?.mismatch() },
    cancel: async () => { await request.cancel() },
    stop,
  }
}
