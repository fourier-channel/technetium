// See presetreset-react.html. Harness only -- never shipped.
import '../../src/index.css'
import '../../src/formant-tokens.css'
import '../../src/formant-bridge.css'
import '@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ClientContext } from '../../src/client/clientContextValue'
import { SpaceProvider } from '../../src/ui/SpaceProvider'
import { useSpace } from '../../src/ui/spaceContext'
import { defaultSpace, putAwayPanel, serialize } from '../../src/ui/space'

const TYPE = 'net.41chan.tc.layout'
// Two panels each: a layout with one panel open on a wide screen reads as a
// phone's momentary view and opens the default (space.ts damagedByPhone), so
// it could not stand in for a layout that really hides the sidebar.
const noSidebar = putAwayPanel(defaultSpace(), 'sidebar', 'replace')
const noMembers = putAwayPanel(defaultSpace(), 'members', 'replace')
let content: Record<string, unknown> = {
  code: serialize(noMembers),
  presets: [{ name: 'Desk', code: serialize(noSidebar) }],
  defaultPreset: 'Desk',
  mobilePreset: null,
  overflow: 'replace',
}
// &full=1: every preset slot taken, so the reset must show and not save.
if (new URLSearchParams(location.search).has('full')) {
  const many = Array.from({ length: 23 }, (_, i) => ({ name: `P${String(i).padStart(2, '0')}`, code: serialize(noMembers) + '' }))
  content = { ...content, presets: [...(content.presets as object[]), ...many] }
}
const before = JSON.parse(JSON.stringify(content))
const writes: Record<string, unknown>[] = []
const client = {
  getUserId: () => '@me:x',
  getRooms: () => [],
  getRoom: () => null,
  getAccountData: (type: string) => (type === TYPE ? { getContent: () => content } : undefined),
  setAccountData: (type: string, c: Record<string, unknown>) => {
    if (type === TYPE) { writes.push(c); content = c }
    return Promise.resolve({})
  },
  on: () => {},
  removeListener: () => {},
} as never
const clientCtx = { client, status: 'ready', error: null, userId: '@me:x' } as never

export function Probe() {
  const { space } = useSpace()
  // What the first render showed, before the reset ran.
  const [first] = useState(() => space.leaves.sidebar.open)
  return (
    <div id="probe" data-first-sidebar={first ? 'open' : 'hidden'} style={{ padding: 16 }}>
      sidebar {space.leaves.sidebar.open ? 'OPEN' : 'hidden'}, members {space.leaves.members.open ? 'OPEN' : 'hidden'}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <ClientContext.Provider value={clientCtx}>
    <SpaceProvider><Probe /></SpaceProvider>
  </ClientContext.Provider>,
)
// After the reset and the debounced layout save (400 ms) have both landed.
setTimeout(() => {
  const last = (writes[writes.length - 1] ?? {}) as { code?: string; presets?: { name: string; code: string }[]; defaultPreset?: string }
  const named = (n: string) => last.presets?.find((p) => p.name === n)?.code
  const kept = last.presets?.find((p) => p.name.startsWith('Before reset '))
  const def = serialize(defaultSpace())
  const lines = [
    `address after load: ${location.pathname}${location.search}`,
    `sidebar on first render: ${document.getElementById('probe')?.dataset.firstSidebar}; now: ${document.getElementById('probe')?.textContent?.trim()}`,
    `account-data writes: ${writes.length}`,
    `live code is the default: ${last.code === def}`,
    `"${kept?.name}" holds the old live layout: ${kept?.code === before.code}`,
    `Desk preset untouched: ${named('Desk') === before.presets[0].code}`,
    `Default preset is the default: ${named('Default') === def}`,
    `this device starts from: ${last.defaultPreset}`,
    `notice: ${document.querySelector('.tc-layout-reset-notice span')?.textContent ?? '(none)'}`,
  ]
  document.getElementById('result')!.textContent = lines.join('\n')
}, 1500)
