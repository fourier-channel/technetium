import { useClient } from '../client/ClientContext'
import { KeysArrival } from './KeysArrival'

// Mounted once, beside <App/>, because the crypto load straddles App's render
// branches: it runs before `setClient`, so App is still showing the pre-client
// BootScreen while it happens, and it must remain visible when App swaps to the
// shell. Hosting it here means one mount point and no duplicate overlay.
//
// Renders nothing at all unless there is something to say (shouldShowCryptoBox).
export function CryptoArrivalHost() {
  const { cryptoLoad } = useClient()
  return <KeysArrival state={cryptoLoad} />
}
