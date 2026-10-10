// A stand-in room and client around the REAL RoomHeaderInfo, so a browser can
// drive the topic popup and editor. Window globals let the driver steer it.
import { createRoot } from 'react-dom/client'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import { RoomHeaderInfo } from '../../../src/ui/RoomHeaderInfo'
import { ClientContext } from '../../../src/client/clientContextValue'
import { RoomListSettingsContext } from '../../../src/ui/roomListSettings'

type W = { topic: string; may: boolean; fail: boolean; saves: string[]; emit: () => void }
const w = window as unknown as W
w.topic = 'Rules:\n1. Be kind\n2. No spam'; w.may = true; w.fail = false; w.saves = []
const handlers = new Set<() => void>()
w.emit = () => handlers.forEach((h) => h())
const room = {
  roomId: '!r:x', name: 'general', getJoinedMemberCount: () => 12, hasEncryptionStateEvent: () => false,
  currentState: {
    getStateEvents: () => (w.topic ? { getContent: () => ({ topic: w.topic }) } : null),
    maySendStateEvent: () => w.may,
  },
} as unknown as Room
const client = {
  getUserId: () => '@me:x', getCrypto: () => undefined,
  on: (_e: string, h: () => void) => handlers.add(h), off: (_e: string, h: () => void) => handlers.delete(h),
  setRoomTopic: (_id: string, t: string) => new Promise((ok, no) => setTimeout(() => {
    if (w.fail) return no({ httpStatus: 403, errcode: 'M_FORBIDDEN', message: 'nope' })
    w.saves.push(t); w.topic = t; w.emit(); ok({ event_id: '$e' })
  }, 200)),
} as unknown as MatrixClient
createRoot(document.getElementById('hdr')!).render(
  <ClientContext.Provider value={{ client, identityFacts: null } as never}>
    <RoomListSettingsContext.Provider value={{ getRename: () => undefined } as never}>
      <RoomHeaderInfo client={client} room={room} />
    </RoomListSettingsContext.Provider>
  </ClientContext.Provider>,
)
