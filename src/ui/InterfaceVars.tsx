import { useLayoutEffect } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { useInterfacePrefs } from '../client/interfaceStore'
import { INTERFACE_VAR_NAMES, interfaceVars } from '../client/interfacePrefs'

// The interface options as the stylesheet reads them (INTERFACE_OPTIONS IO9,
// IO10): custom properties on the document root, so every timeline -- the
// room's, a DM's, a thread's -- draws from one place. Only what
// interfaceVars builds from admitted values is ever set, and every name it
// can set is cleared first, so a colour put back to its default is gone
// rather than left behind.
export function InterfaceVars({ client }: { client: MatrixClient }) {
  const { prefs } = useInterfacePrefs(client)
  useLayoutEffect(() => {
    const style = document.documentElement.style
    const vars = interfaceVars(prefs)
    for (const name of INTERFACE_VAR_NAMES) {
      if (vars[name] === undefined) style.removeProperty(name)
      else style.setProperty(name, vars[name])
    }
    return () => {
      for (const name of INTERFACE_VAR_NAMES) style.removeProperty(name)
    }
  }, [prefs])
  return null
}
