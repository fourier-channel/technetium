import type { AccountDataSpec } from '../client/accountDataEcho'
import { emptyStore, readStore, writeStore, type LayoutStore } from './presets'

// The layout and its presets, held in ACCOUNT DATA as one content (the live
// layout's number, the named layouts, which one each device opens on, the
// overflow mode) and written through echoSync (tc.110). Before, the drag's
// save and the presets' save each wrote on their own with a bare
// console.warn: two writes could land in either order, a write equal to the
// SDK's stale local copy was skipped, and a failure left the screen showing
// a layout the server never got. Pure, so the check suite drives this spec
// against a fake server (checks/accountDataEcho.check.ts).

export const LAYOUT_EVENT = 'net.41chan.tc.layout'

// One object, so an empty account reads as the same value every time (a
// snapshot must not change until something does).
const EMPTY: LayoutStore = Object.freeze(emptyStore()) as LayoutStore

const content = (s: LayoutStore): Record<string, unknown> => writeStore(s)

export const LAYOUT_ECHO: AccountDataSpec<LayoutStore> = {
  type: LAYOUT_EVENT,
  // presets.ts reads any content, however malformed, as a sane store: a field
  // it cannot read is that field's default, so nothing here is ever refused.
  parse: readStore,
  empty: EMPTY,
  same: (a, b) => JSON.stringify(content(a)) === JSON.stringify(content(b)),
  content,
  subject: 'layout',
  failed: 'the layout went back to the last one saved; try again once the connection is back',
}
