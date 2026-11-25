import { useEffect, useRef } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import type { NotifMap } from '../client/notificationCounts'
import { NO_COUNTS_YET } from '../client/notificationCounts'
import { countWhileHidden } from '../client/useRoomNotifications'
import { decideChimes, loudestChime, roomsLookedAt } from '../client/notificationChimeDecision'
import { playChime, primeChime } from '../client/notificationChime'
import { reportAlways } from '../client/report'
import { useRoomListSettings } from './roomListSettings'

// The notification sound (tc.91). Draws nothing. It is a component rather than
// a hook in App because the sound settings live in a provider App renders, and
// it is mounted there rather than in the room list because the room list is a
// panel that can be put away and a chime must not go with it.
export function NotificationChime({
  client,
  notifs,
  selectedRoomId,
  dockRoomId,
  dockOpen,
}: {
  client: MatrixClient | null
  notifs: NotifMap
  selectedRoomId: string | null
  dockRoomId: string | null
  dockOpen: boolean
}) {
  const { soundEnabled, soundVolume, isMutedNow } = useRoomListSettings()
  const last = useRef<{ client: MatrixClient | null; counts: NotifMap | null }>({ client: null, counts: null })

  useEffect(() => {
    if (last.current.client !== client) last.current = { client, counts: null }
    const prev = last.current.counts
    // The placeholder is not an answer; taking it as a baseline would chime
    // for everything already waiting when the client opened.
    if (notifs === NO_COUNTS_YET) return
    last.current.counts = notifs
    if (!soundEnabled) return
    const kind = loudestChime(
      decideChimes(prev, notifs, {
        isMutedNow,
        lookingAt: roomsLookedAt(document.visibilityState === 'visible', selectedRoomId, dockRoomId, dockOpen),
      }),
    )
    if (kind) playChime(kind, soundVolume).catch((err) => reportAlways('notification chime', err))
  }, [client, notifs, soundEnabled, soundVolume, isMutedNow, selectedRoomId, dockRoomId, dockOpen])

  // Counts are not asked for in a hidden tab unless something would be done
  // with the answer. With sound on, a message arriving there is worth asking.
  useEffect(() => {
    countWhileHidden(soundEnabled)
    return () => countWhileHidden(false)
  }, [soundEnabled])

  // The first click or key press after a load is what lets this tab make a
  // sound at all. Listens until one counts, then stops.
  useEffect(() => {
    if (!soundEnabled) return
    const stop = () => {
      window.removeEventListener('click', onGesture)
      window.removeEventListener('keydown', onGesture)
    }
    const onGesture = () => {
      primeChime()
        .then((ok) => {
          if (ok) stop()
        })
        .catch((err) => reportAlways('notification chime', err))
    }
    window.addEventListener('click', onGesture)
    window.addEventListener('keydown', onGesture)
    return stop
  }, [soundEnabled])

  return null
}
