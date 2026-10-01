import type { MatrixClient } from 'matrix-js-sdk'
import { asMembership, type BulkIO } from './bulkPower'
import { creatorRefusal, levelIn, refusal, requiredToSetPower, withUserLevel } from './powerLevels'

// ---------------------------------------------------------------------------
// The one way Technetium writes somebody's power level.
//
// Every write reads the room's power levels FROM THE SERVER first, judges the
// change against what it read, and sends that content back with one entry
// changed. The SDK's setPowerLevel, which this replaces at every call site,
// builds its write from the client's own copy of the event whenever sync is
// running -- and a power-levels write replaces the event whole, so anything
// that copy had not caught up with was deleted by the write. For a room with
// no power-levels event at all it writes one naming only the target, which
// takes the creator's implicit 100 away.
//
// Only the client's TYPE is imported, so a check can hand this a stand-in.
// ---------------------------------------------------------------------------

function errcode(err: unknown): string | undefined {
  return (err as { errcode?: string } | null)?.errcode
}

export function powerIO(client: MatrixClient): BulkIO {
  return {
    async readLevels(roomId) {
      try {
        return (await client.getStateEvent(roomId, 'm.room.power_levels', '')) as Record<string, unknown>
      } catch (err) {
        if (errcode(err) === 'M_NOT_FOUND') return null
        throw err
      }
    },
    async readMembership(roomId, userId) {
      try {
        const content = await client.getStateEvent(roomId, 'm.room.member', userId)
        return asMembership(content?.membership)
      } catch (err) {
        // Never in the room at all: there is no member event to read.
        if (errcode(err) === 'M_NOT_FOUND') return 'none'
        throw err
      }
    },
    async writeLevels(roomId, content) {
      // sendStateEvent is typed to the SDK's enum of event names, which a
      // module the checks load cannot import (O-tp9); bound, because it uses
      // `this` (G-bf03). useDomainBackground does the same.
      const send = client.sendStateEvent.bind(client) as unknown as (
        roomId: string, type: string, content: Record<string, unknown>, stateKey: string,
      ) => Promise<unknown>
      await send(roomId, 'm.room.power_levels', content, '')
    },
    // Wakes every quarter second to look at Stop, so a long pause ends as
    // soon as somebody asks it to.
    sleep: (ms, stopped) => new Promise((resolve) => {
      const end = Date.now() + ms
      const tick = () => {
        const left = end - Date.now()
        if (left <= 0 || stopped()) resolve()
        else setTimeout(tick, Math.min(250, left))
      }
      tick()
    }),
  }
}

// A change the rules refuse, found on the fresh read. Its message is already
// in the user's terms, unlike a server error, which describePowerError words.
export class PowerRefused extends Error {}

// One person, one room. The one-room editor and the profile card call this;
// the bulk setter runs the same read-judge-write per room in bulkPower.ts.
export async function setUserLevel(
  io: BulkIO,
  room: { roomId: string; isSpace: boolean; creators: readonly string[] },
  me: string,
  target: string,
  to: number,
): Promise<{ from: number; to: number }> {
  const where = room.isSpace ? 'space' : 'room'
  const content = await io.readLevels(room.roomId)
  if (content === null) {
    throw new PowerRefused(`This ${where} has no power-levels event, so there is no list to add them to. Writing one from here would take its creator's power away.`)
  }
  if (room.creators.includes(target)) throw new PowerRefused(creatorRefusal(me === target, room.isSpace))
  const from = levelIn(content, target, room.creators)
  const why = refusal({
    isSelf: me === target,
    myLevel: levelIn(content, me, room.creators),
    targetLevel: from,
    requiredToSet: requiredToSetPower(content),
    isSpace: room.isSpace,
  }, to)
  if (why) throw new PowerRefused(why)
  await io.writeLevels(room.roomId, withUserLevel(content, target, to))
  return { from, to }
}
