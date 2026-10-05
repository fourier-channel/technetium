import { useState } from 'react'
import { useClient } from '../client/clientContextValue'
import { deviceElsewhereCopy, type DeviceElsewhere as Which } from '../client/deviceLock'
import { Pip2Link } from './Pip2Link'

// ---------------------------------------------------------------------------
// The screen a tab shows while another tab of this browser has the device
// (client/deviceLock.ts): never got it, or gave it up to a "Use it here"
// elsewhere. One action, the same in both: take it back.
//
// NO PURGE HERE, deliberately, though every other screen carries the
// rectangle: the live tab is using this browser's stored session and caches
// right now, and a purge from this one would delete them from under it. Purge
// from the tab that is running.
// ---------------------------------------------------------------------------

export function DeviceElsewhere({ which }: { which: Which }) {
  const { takeOverDevice } = useClient()
  const [asked, setAsked] = useState(false)
  const copy = deviceElsewhereCopy(which)
  return (
    <div className="tc-device-elsewhere" role="alertdialog" aria-labelledby="tc-device-elsewhere-title">
      <div className="tc-device-elsewhere-box">
        <h1 id="tc-device-elsewhere-title">{copy.title}</h1>
        <p>{copy.body}</p>
        <button
          type="button"
          className="tc-pill"
          disabled={asked}
          onClick={() => { setAsked(true); takeOverDevice() }}
        >
          {asked ? 'Taking it over...' : copy.action}
        </button>
        <p className="tc-device-elsewhere-pip"><Pip2Link /></p>
      </div>
    </div>
  )
}
