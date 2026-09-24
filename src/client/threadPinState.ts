import { useSyncExternalStore } from 'react'
import { RoomStateEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { NO_PINS } from '../ui/threadPins'
import { makePinSync, type PinSync } from './pinSync'

// ---------------------------------------------------------------------------
// Pinned threads are the ROOM's (launch-polish L4, operator 2026-09-24): "an
// admin-pinned thread that has priority over all others. For example, I would
// pin the 'Welcome' thread in the one room everyone automatically lands in."
//
// So a pin is room STATE, one event per room listing its pinned thread roots
// in order, which everyone in the room reads and only somebody the room's
// power levels allow to send it can write. It is not m.room.pinned_events:
// that is pinned MESSAGES, with its own panel, and a pinned thread showing up
// there as well would be one fact in two places.
//
// Writes go through pinSync -- optimistic, one at a time, never ahead of the
// echo -- so a moderator's quick pin-unpin cannot land out of order.
//
// The first version of this feature kept pins in the viewer's own account
// data: a favourite, not a pin. Retired the same day.
// ---------------------------------------------------------------------------

export const THREAD_PINS_EVENT = 'net.41chan.thread.pins'

/** Custom state, reached through a loosely-typed alias (cf. G-bf03). */
function pinContent(room: Room): unknown {
  const get = room.currentState.getStateEvents.bind(room.currentState) as unknown as (
    type: string,
    stateKey: string,
  ) => MatrixEvent | null
  return get(THREAD_PINS_EVENT, '')?.getContent()
}

/** May this user pin threads in this room? Asked of the room's power levels. */
export function canPinThreads(room: Room | null | undefined, userId: string | null | undefined): boolean {
  if (!room || !userId) return false
  const may = room.currentState.maySendStateEvent.bind(room.currentState) as unknown as (
    type: string,
    userId: string,
  ) => boolean
  return may(THREAD_PINS_EVENT, userId)
}

interface Registry {
  syncFor: (roomId: string) => PinSync | null
  subscribe: (cb: () => void) => () => void
  version: () => number
}

const registries = new WeakMap<MatrixClient, Registry>()

function registryFor(client: MatrixClient): Registry {
  const found = registries.get(client)
  if (found) return found
  const syncs = new Map<string, PinSync>()
  const listeners = new Set<() => void>()
  let version = 0
  const bump = () => {
    version++
    for (const cb of listeners) cb()
  }
  const syncFor = (roomId: string): PinSync | null => {
    const existing = syncs.get(roomId)
    if (existing) return existing
    if (!client.getRoom(roomId)) return null
    const sync = makePinSync({
      read: () => {
        const room = client.getRoom(roomId)
        return room ? pinContent(room) : undefined
      },
      write: (pins) => {
        const send = client.sendStateEvent.bind(client) as unknown as (
          roomId: string,
          type: string,
          content: Record<string, unknown>,
          stateKey: string,
        ) => Promise<unknown>
        return send(roomId, THREAD_PINS_EVENT, { pins }, '')
      },
      subject: 'thread pins',
    })
    sync.subscribe(bump)
    syncs.set(roomId, sync)
    return sync
  }
  const onState = (ev: MatrixEvent) => {
    if (ev.getType() !== THREAD_PINS_EVENT) return
    const roomId = ev.getRoomId()
    if (!roomId) return
    const sync = syncs.get(roomId)
    if (sync) sync.onStored()
    else bump()
  }
  let attached = false
  const reg: Registry = {
    syncFor,
    subscribe(cb) {
      listeners.add(cb)
      if (!attached) {
        client.on(RoomStateEvent.Events, onState)
        attached = true
      }
      return () => {
        listeners.delete(cb)
        if (listeners.size === 0 && attached) {
          client.removeListener(RoomStateEvent.Events, onState)
          attached = false
        }
      }
    },
    version: () => version,
  }
  registries.set(client, reg)
  return reg
}

/** The room's pinned thread roots, in pin order (optimistic while a write is out). */
export function threadPinsOf(client: MatrixClient | null, roomId: string): readonly string[] {
  if (!client) return NO_PINS
  return registryFor(client).syncFor(roomId)?.snapshot() ?? NO_PINS
}

/** Pin or unpin a thread root in its room. The caller has asked canPinThreads. */
export function toggleThreadPin(client: MatrixClient, roomId: string, rootId: string): void {
  registryFor(client).syncFor(roomId)?.toggle(rootId)
}

const noSubscribe = () => () => {}
const zero = () => 0

/**
 * A number that changes whenever any room's pins do, for a component to
 * re-read threadPinsOf when it moves. One subscription per client, not one per
 * room: the Everywhere list reads pins across every joined room.
 */
export function useThreadPinsVersion(client: MatrixClient | null): number {
  const reg = client ? registryFor(client) : null
  return useSyncExternalStore(reg ? reg.subscribe : noSubscribe, reg ? reg.version : zero, reg ? reg.version : zero)
}
