// Who may START a thread (operator, 2026-10-19: "make it 49 to make threads").
// The server enforces it (fourier-basis ops/hetzner/synapse/modules/
// thread_start_policy.py); this is the client asking the same question of the
// same place, the room's power levels, so the verb shows exactly where the
// server would accept it.
import { threadStartLevel, canStartThreads, mayOfferStartThread, THREAD_START_EVENT, DEFAULT_THREAD_START_LEVEL } from '../src/client/threadStart.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -- ' + JSON.stringify(extra))) }
}

// --- the level, read as the server module reads it --------------------------
{
  check('the default is 49', DEFAULT_THREAD_START_LEVEL === 49 && threadStartLevel(undefined) === 49 && threadStartLevel({}) === 49)
  check('the event type matches the server module', THREAD_START_EVENT === 'net.41chan.thread_start')
  check('a room that sets it is obeyed', threadStartLevel({ events: { [THREAD_START_EVENT]: 0 } }) === 0)
  check('a numeric string counts, as Synapse reads old rooms', threadStartLevel({ events: { [THREAD_START_EVENT]: ' 75 ' } }) === 75)
  check('junk falls back to the default, never to "anyone"',
    threadStartLevel({ events: { [THREAD_START_EVENT]: 'lots' } }) === 49 && threadStartLevel({ events: { [THREAD_START_EVENT]: true } }) === 49)
  check('other event levels do not leak into it', threadStartLevel({ events: { 'm.room.message': 0 } }) === 49)
}

// --- the room ---------------------------------------------------------------
const room = (levels: Record<string, number>, pl: unknown = {}) => ({
  getMember: (id: string) => (id in levels ? { powerLevel: levels[id] } : null),
  currentState: { getStateEvents: (type: string, key: string) => (type === 'm.room.power_levels' && key === '' ? { getContent: () => pl } : null) },
}) as never
{
  const r = room({ '@mod:x': 50, '@bot:x': 49, '@me:x': 0 })
  check('level 49 may start threads', canStartThreads(r, '@bot:x'))
  check('level 50 may', canStartThreads(r, '@mod:x'))
  check('level 0 may not', !canStartThreads(r, '@me:x'))
  check('a stranger to the room may not', !canStartThreads(r, '@ghost:x'))
  check('no room or no user: no', !canStartThreads(null, '@mod:x') && !canStartThreads(r, null))
  check('the room\'s own level applies', canStartThreads(room({ '@me:x': 0 }, { events: { [THREAD_START_EVENT]: 0 } }), '@me:x'))
}

// --- which messages offer it --------------------------------------------------
{
  const ev = (o: { id?: string; root?: boolean; inThread?: string }) => ({
    getId: () => o.id ?? '$e1', isThreadRoot: !!o.root, threadRootId: o.inThread,
  }) as never
  check('a plain message offers Start thread', mayOfferStartThread(ev({})))
  check('a message that already has a thread does not (its chip opens it)', !mayOfferStartThread(ev({ root: true })))
  check('a reply inside a thread does not (threads do not nest)', !mayOfferStartThread(ev({ inThread: '$root' })))
  check('a local echo does not (it has no id the server knows)', !mayOfferStartThread(ev({ id: '~local1' })))
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
