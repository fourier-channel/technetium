// Closing a conversation: what it does, in what order, and what it admits to.
//
// The gap this closes: a DM window could not be closed at all. Removing the
// other person did not do it, so a conversation could be over in every sense
// except the one on screen.
import { closeDm, pruneFromDirect, dmCloseWarning } from '../src/client/dmClose.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const THEM = '@neru:41chan.net'
const ROOM = '!dm:41chan.net'

function clientWith(direct: Record<string, string[]>, fail: { leave?: boolean; forget?: boolean; save?: boolean } = {}) {
  const calls: string[] = []
  let saved: Record<string, string[]> | null = null
  return {
    calls,
    get saved() { return saved },
    getAccountData: () => ({ getContent: () => direct }),
    leave: async (id: string) => {
      calls.push('leave:' + id)
      if (fail.leave) throw new Error('server said no')
    },
    forget: async (id: string) => {
      calls.push('forget:' + id)
      if (fail.forget) throw new Error('forget broke')
    },
    setAccountData: async (_t: string, content: Record<string, string[]>) => {
      calls.push('setAccountData')
      if (fail.save) throw new Error('account data broke')
      saved = content
    },
  } as never as Parameters<typeof closeDm>[0] & { calls: string[]; saved: Record<string, string[]> | null }
}

console.log('== the happy path, in order')
{
  const c = clientWith({ [THEM]: [ROOM] })
  const r = await closeDm(c, ROOM)
  check('leaves, forgets, then prunes -- in that order',
    JSON.stringify(c.calls) === JSON.stringify(['leave:' + ROOM, 'forget:' + ROOM, 'setAccountData']), c.calls)
  check('reports all three', r.left && r.forgotten && r.pruned)
  check('no problem to report', r.problem === undefined)
  check('the user key goes when their last room does', JSON.stringify(c.saved) === '{}', c.saved)
}

console.log('== a failed leave changes NOTHING else')
{
  // A half-close that pruned account data would hide a room the user is still
  // in, which is worse than not closing it.
  const c = clientWith({ [THEM]: [ROOM] }, { leave: true })
  const r = await closeDm(c, ROOM)
  check('did not forget or prune', JSON.stringify(c.calls) === JSON.stringify(['leave:' + ROOM]), c.calls)
  check('says it did not close', !r.left && !r.pruned)
  check('and says why', typeof r.problem === 'string' && r.problem.includes('server said no'))
}

console.log('== a failed forget still leaves the room, and says so')
{
  const c = clientWith({ [THEM]: [ROOM] }, { forget: true })
  const r = await closeDm(c, ROOM)
  check('the leave stands', r.left)
  check('pruning still happened', r.pruned)
  check('the failure is reported, not swallowed',
    typeof r.problem === 'string' && r.problem.includes('could not forget'))
}

console.log('== a failed account-data write is reported too')
{
  const c = clientWith({ [THEM]: [ROOM] }, { save: true })
  const r = await closeDm(c, ROOM)
  check('left and forgotten', r.left && r.forgotten)
  check('not pruned, and said', !r.pruned && String(r.problem).includes('m.direct'))
}

console.log('== pruning touches every entry, not the first')
{
  // Other clients write this map too. A room listed twice would come back as
  // an "existing DM" from the entry nobody looked at.
  const c = clientWith({ [THEM]: [ROOM, '!other:x'], '@someone:x': [ROOM] })
  check('changed', await pruneFromDirect(c, ROOM))
  check('gone from both users, and the survivor kept',
    JSON.stringify(c.saved) === JSON.stringify({ [THEM]: ['!other:x'] }), c.saved)
}
{
  const c = clientWith({ [THEM]: ['!other:x'] })
  check('a room that is not there writes nothing at all', (await pruneFromDirect(c, ROOM)) === false)
  check('and really nothing', c.calls.length === 0, c.calls)
}

console.log('== the warning tells the truth, including the unwelcome half')
{
  const w = dmCloseWarning('Neru-chan')
  const all = [...w.losses, ...w.keeps].join(' ')
  check('says a new conversation is a NEW room', /NEW room/.test(all))
  check('says this history will not be in it', /will not be in it/.test(all))
  check('says nothing is deleted', /Nothing is deleted/.test(all))
  check('says they keep it', /Neru-chan keeps this room/.test(all))
  check('says the one route back, which is theirs to offer', /invites you back to this same room/.test(all))
  check('says media stops being readable', /pictures stop being readable/.test(all))
  check('names the person rather than saying "this user"', !/this user/.test(all) && /Neru-chan/.test(all))
  check('has both halves', w.losses.length >= 2 && w.keeps.length >= 2)
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\ndm close: all checks passed')
