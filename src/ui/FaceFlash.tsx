import { useEffect, useState } from 'react'
import { faceEnter, faceExit, type FaceDef } from '../client/faces'
import { AuthedImage } from './AuthedImage'
import { useReducedMotion } from './reducedMotion'
import { useReplayOnView } from './useReplayOnView'

// ---------------------------------------------------------------------------
// A face, superimposed on its sender's avatar for a moment.
//
// Follows the arrival animations' design: it replays each time the row scrolls
// into view, because scrolling to a message is a deliberate act, and a reader
// going straight down the log sees each one exactly once.
//
// THREE PHASES DRIVEN IN JS, not one composed CSS shorthand. Enter and exit are
// independently chosen, so they are two animations -- and declaring both at once
// does not work: the second one's `both` fill applies backwards from time zero
// and overrides the first before it has run. One class at a time, advanced by
// timers, which is also the pattern the compiler rules want (G-tc01).
//
// Absolutely positioned over the avatar and pointer-events: none, so it holds no
// layout and cannot move, block or reflow anything (G-tp19).
// ---------------------------------------------------------------------------

const ENTER_MS = 620
const HOLD_MS = 900
const EXIT_MS = 620

type Phase = 'in' | 'hold' | 'out' | 'gone'

export function FaceFlash({ face, seed }: { face: FaceDef; seed: string }) {
  const reduced = useReducedMotion()
  const { ref, playKey } = useReplayOnView(!reduced)
  return (
    <span ref={ref} className="tc-face-anchor" aria-hidden="true">
      {/* Remounted by playKey so each pass starts from frame one. playKey 0
          means it has not been in view yet, so nothing plays at something
          nobody is looking at. */}
      {playKey > 0 && !reduced && <FacePlay key={playKey} face={face} seed={seed} />}
    </span>
  )
}

function FacePlay({ face, seed }: { face: FaceDef; seed: string }) {
  const [phase, setPhase] = useState<Phase>('in')

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), ENTER_MS)
    const t2 = setTimeout(() => setPhase('out'), ENTER_MS + HOLD_MS)
    // Unmounted on a timer rather than on animationend, for the same reason the
    // panels are (G-04f01d): an animation that is a no-op never fires its end
    // event, and the face would then sit on the avatar permanently.
    const t3 = setTimeout(() => setPhase('gone'), ENTER_MS + HOLD_MS + EXIT_MS)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [])

  if (phase === 'gone') return null

  return (
    <span
      className="tc-face"
      data-phase={phase}
      data-anim={phase === 'out' ? faceExit(seed) : faceEnter(seed)}
      role="img"
      aria-label={face.label}
    >
      {face.art ? (
        <AuthedImage mxc={face.art} width={180} fill transparentLoading alt={face.label} />
      ) : (
        <span className="tc-face-text">{face.token}</span>
      )}
    </span>
  )
}
