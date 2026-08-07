// Pure-helper checks for the S4 shared receipt walk-back. See
// checks/relations.check.ts for how these run (`npm run check`).
import { findReceiptableEvent } from '../src/client/receipts.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log('  ok   ' + name)
  } else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

type Fake = { id: string | null; type?: string; status?: string }

function ev(f: Fake): any {
  return {
    getId: () => f.id,
    getType: () => f.type ?? 'm.room.message',
    status: f.status,
  }
}

function room(events: any[]): any {
  return { getLiveTimeline: () => ({ getEvents: () => events }) }
}

console.log('\n-- findReceiptableEvent --')
{
  check('empty room -> null', findReceiptableEvent(room([])) === null)

  check(
    'picks the last event',
    findReceiptableEvent(room([ev({ id: '$1' }), ev({ id: '$2' })]))?.getId() === '$2',
  )

  // A local echo would 400 the receipt endpoint.
  check(
    'skips a sending local echo',
    findReceiptableEvent(room([ev({ id: '$1' }), ev({ id: '$2', status: 'sending' })]))?.getId() === '$1',
  )
  check(
    'skips a not_sent local echo',
    findReceiptableEvent(room([ev({ id: '$1' }), ev({ id: '$2', status: 'not_sent' })]))?.getId() === '$1',
  )
  check(
    'skips a ~-prefixed transaction id',
    findReceiptableEvent(room([ev({ id: '$1' }), ev({ id: '~txn123' })]))?.getId() === '$1',
  )
  check(
    'skips a missing id',
    findReceiptableEvent(room([ev({ id: '$1' }), ev({ id: null })]))?.getId() === '$1',
  )

  // Spatial presence rides the timeline so it works at PL0, but it is not a
  // "read" target -- receipting one leaves the room looking unread.
  check(
    'skips net.41chan.spatial.* events',
    findReceiptableEvent(
      room([ev({ id: '$1' }), ev({ id: '$s', type: 'net.41chan.spatial.position' })]),
    )?.getId() === '$1',
  )
  check(
    'walks back past a whole run of skippables',
    findReceiptableEvent(
      room([
        ev({ id: '$1' }),
        ev({ id: '$s1', type: 'net.41chan.spatial.position' }),
        ev({ id: '~t' }),
        ev({ id: '$2', status: 'sending' }),
      ]),
    )?.getId() === '$1',
  )
  check(
    'all-skippable room -> null',
    findReceiptableEvent(room([ev({ id: '~t' }), ev({ id: '$s', type: 'net.41chan.spatial.x' })])) === null,
  )
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
