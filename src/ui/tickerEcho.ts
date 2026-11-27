import type { AccountDataSpec } from '../client/accountDataEcho'

// The ticker's collapse state, held in ACCOUNT DATA so it follows the user
// across devices and sessions (the operator's persistence law: state lives
// where the server can hand it back, never in one browser's storage), and
// written through echoSync (tc.110): clicked open and shut fast, the server
// ends where the last click said, and a failed save is undone on screen and
// reported rather than swallowed. Pure, so the check suite drives this spec
// against a fake server (checks/accountDataEcho.check.ts).

export const TICKER_EVENT = 'net.41chan.tc.ticker'

export const TICKER_ECHO: AccountDataSpec<boolean> = {
  type: TICKER_EVENT,
  // Only `true` collapses; anything else stored is the open ticker. Content
  // that is not an object at all is refused, so echoSync reports it.
  parse: (content) => (content && typeof content === 'object'
    ? (content as { collapsed?: unknown }).collapsed === true
    : null),
  empty: false,
  same: (a, b) => a === b,
  content: (collapsed) => ({ collapsed }),
  subject: 'ticker',
  unreadable: 'the saved ticker state is not readable, so the ticker is shown open; folding it rewrites it',
  failed: 'the ticker went back to how it was; try again once the connection is back',
}
