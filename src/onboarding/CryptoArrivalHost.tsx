import { useState } from 'react'
import { useClient } from '../client/ClientContext'
import { KeysArrival } from './KeysArrival'

// Mounted once, beside <App/>, because the crypto load straddles App's render
// branches: it runs before `setClient`, so App is still showing the pre-client
// BootScreen while it happens, and it must remain visible when App swaps to the
// shell. Hosting it here means one mount point and no duplicate overlay.
//
// Renders nothing at all unless there is something to say (shouldShowCryptoBox).
//
// Dismissal lives HERE, not in the state machine: 'failed' is a fact about
// crypto and stays one, but the user has read it and the client underneath
// works. Found the hard way -- the failed modal had no exit, and the operator
// was trapped behind a veil over a functioning client (2026-09-05).
export function CryptoArrivalHost() {
  const { cryptoLoad } = useClient()
  const [dismissed, setDismissed] = useState(false)
  if (dismissed && cryptoLoad.phase === 'failed') return null
  return <KeysArrival state={cryptoLoad} onDismiss={() => setDismissed(true)} />
}
