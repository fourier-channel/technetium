// See startthread-react.html. Harness only -- never shipped.
import '../../src/index.css'
import '../../src/formant-tokens.css'
import '../../src/formant-bridge.css'
import '@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css'
import { createRoot } from 'react-dom/client'
import { ClientContext } from '../../src/client/clientContextValue'
import { MessageVerbsProvider } from '../../src/ui/MessageVerbs'
import { MessageActionBar } from '../../src/ui/MessageActionBar'
import { useMessageActions } from '../../src/ui/messageActions'

const errors: string[] = []
window.addEventListener('error', (e) => errors.push(String(e.message)))
const level = Number(new URLSearchParams(location.search).get('level') ?? '49')
const me = '@me:x'
const room = {
  roomId: '!r:x',
  getMember: (id: string) => (id === me ? { powerLevel: level } : null),
  hasEncryptionStateEvent: () => false,
  currentState: {
    getStateEvents: () => null,
    maySendStateEvent: () => false,
    hasSufficientPowerLevelFor: () => false,
  },
} as never
const client = { getUserId: () => me, getRoom: () => room, on: () => {}, off: () => {}, removeListener: () => {} } as never

const ev = (id: string, o: { root?: boolean; inThread?: string } = {}) => ({
  getId: () => id, getRoomId: () => '!r:x', getSender: () => '@them:x', getType: () => 'm.room.message',
  getContent: () => ({ msgtype: 'm.text', body: id }), isThreadRoot: !!o.root, threadRootId: o.inThread,
  isRedacted: () => false, isState: () => false, getTs: () => 0,
})
const items = [
  { label: 'plain message', item: { kind: 'message', id: '$plain', event: ev('$plain'), content: { msgtype: 'm.text', body: 'plain' } } },
  { label: 'thread root', item: { kind: 'message', id: '$root', event: ev('$root', { root: true }), content: { msgtype: 'm.text', body: 'root' } } },
  { label: 'reply in a thread', item: { kind: 'message', id: '$inner', event: ev('$inner', { inThread: '$root' }), content: { msgtype: 'm.text', body: 'inner' } } },
]
const opened: string[] = []

export function Case({ label, item }: { label: string; item: unknown }) {
  const actions = useMessageActions(item as never)
  return (
    <div className="case" data-label={label} data-verbs={actions.map((a) => a.label).join(', ')}>
      <div>{label}</div>
      <MessageActionBar actions={actions} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <ClientContext.Provider value={{ client, status: 'ready', error: null, userId: me } as never}>
    <MessageVerbsProvider room={room} onStartThread={(r, id) => opened.push(`${r} ${id}`)}>
      {items.map((c) => <Case key={c.label} label={c.label} item={c.item} />)}
    </MessageVerbsProvider>
  </ClientContext.Provider>,
)
setTimeout(() => {
  const start = document.querySelector('[data-label="plain message"] button[aria-label="Start thread"]') as HTMLButtonElement | null
  start?.click()
  const lines = [...document.querySelectorAll('.case')].map((c) => `${(c as HTMLElement).dataset.label}: ${(c as HTMLElement).dataset.verbs}`)
  lines.push(`level ${level}; clicking Start thread opened: ${opened.join('; ') || '(nothing)'}`)
  if (errors.length) lines.push('errors: ' + errors.join(' | '))
  document.getElementById('result')!.textContent = lines.join('\n')
}, 1000)
