import { createContext, useContext } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import type { CryptoIdentityFacts, IdentityAction } from './cryptoIdentity'
import type { KeyBackupFacts } from './keyBackup'
import type { CryptoLoadState } from './cryptoProgress'

// The client context, its value type, and the hook that reads it.
//
// Split out of ClientContext.tsx so that file exports ONLY its component:
// react-refresh cannot hot-reload a module that mixes components with other
// exports, so every edit to the provider was forcing a full page reload.
// Lifecycle of the client, so the UI can render the right thing per phase.
export type ClientStatus =
  | 'starting' // bootstrap in progress (deciding which path)
  | 'awaiting_login' // no session — show the login UI
  | 'syncing' // client built, initial sync running
  | 'ready' // synced and usable
  | 'error'

export interface ClientContextValue {
  client: MatrixClient | null
  status: ClientStatus
  error: string | null
  userId: string | null
  // How the crypto engine's arrival is going, so the shell can show it (D-e6).
  // Stays 'idle' for everyone while the flag is off.
  cryptoLoad: CryptoLoadState
  // What this account's encryption identity needs, if anything. Null until
  // crypto is up, or when we could not read it -- which is NOT the same as
  // "nothing needed", and callers must not collapse the two.
  identityAction: IdentityAction | null
  // The facts behind that decision, for surfaces that need more than the verb
  // (whether history is readable, whether a backup exists).
  identityFacts: CryptoIdentityFacts | null
  // Whether this account's conversations would survive losing this device
  // (E8). Null means we could not find out -- which callers must NOT render as
  // "no backup", since that tells a protected user they are at risk.
  keyBackup: KeyBackupFacts | null
  login: (homeserver?: string) => Promise<void>
  logout: () => void
}

export const ClientContext = createContext<ClientContextValue | null>(null)

// Hook every component uses to reach the live client + lifecycle state.
export function useClient(): ClientContextValue {
  const ctx = useContext(ClientContext)
  if (!ctx) throw new Error('useClient must be used within <ClientProvider>')
  return ctx
}
