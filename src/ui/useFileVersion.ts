import { useCallback, useSyncExternalStore } from 'react'
import { useClient } from '../client/clientContextValue'
import { fileVersionOf, subscribeFileVersions } from '../client/fileVersions'

// A picture's file version, live (client/fileVersions.ts). A component that
// fetches an mxc puts this in its effect's dependencies, so a replacement
// refetches the picture under its new URL -- the reload the operator asked to
// be forced. Null for every picture never replaced.
export function useFileVersion(mxc: string | null | undefined): string | null {
  const { client } = useClient()
  const subscribe = useCallback((cb: () => void) => (client ? subscribeFileVersions(client, cb) : () => {}), [client])
  const snapshot = useCallback(() => (client && mxc ? fileVersionOf(client, mxc) : null), [client, mxc])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
