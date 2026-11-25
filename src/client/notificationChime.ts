import type { ChimeKind } from './notificationChimeDecision'
import { reportIgnored } from './report'

// ---------------------------------------------------------------------------
// The chime itself (tc.91): WebAudio, no file to fetch.
//
// AUTOPLAY. A browser will not start audio in a tab the user has not touched.
// The context is therefore created only from inside a gesture (primeChime), and
// a chime wanted before the first one is dropped and reported, never queued:
// resume() on a blocked context stays PENDING and settles on the next click, so
// a note scheduled behind it would sound minutes late, at the click, for
// something long since read.
//
// The context is suspended again once a chime has rung out. A running context
// keeps the audio thread awake whether or not anything is playing.
// ---------------------------------------------------------------------------

const SCOPE = 'notification chime'
const RESUME_WITHIN_MS = 1_000
const REST_AFTER_MS = 1_500

// Hz per note, in order. A mention rises; an unread is one lower note.
const NOTES: Record<ChimeKind, readonly number[]> = {
  highlight: [880, 1318.5],
  unread: [659.3],
}
const NOTE_GAP_S = 0.11
const NOTE_LENGTH_S = 0.45
// The two partials of a note: frequency ratio, share of the gain. They sum to
// 1, so a note at volume 100 peaks at full scale and no further; a second note
// starts as the first has decayed, and the bus below is scaled for the overlap.
const PARTIALS: readonly (readonly [number, number])[] = [
  [1, 0.8],
  [2, 0.2],
]
const BUS = 0.6

let ctx: AudioContext | null = null
let rest: ReturnType<typeof setTimeout> | undefined

function restLater(c: AudioContext): void {
  if (rest) clearTimeout(rest)
  rest = setTimeout(() => {
    void c.suspend().catch((err) => reportIgnored(SCOPE, err))
  }, REST_AFTER_MS)
}

async function running(c: AudioContext): Promise<boolean> {
  if (rest) clearTimeout(rest)
  if (c.state !== 'running') {
    await Promise.race([
      c.resume(),
      new Promise<void>((done) => setTimeout(done, RESUME_WITHIN_MS)),
    ])
  }
  // Also when it did not start: that withdraws the pending resume.
  restLater(c)
  return c.state === 'running'
}

// Call from inside a user gesture. Answers whether audio can now play, so the
// caller knows whether to go on listening for a gesture that counts (a bare
// modifier key does not).
export async function primeChime(): Promise<boolean> {
  try {
    ctx ??= new AudioContext()
    return await running(ctx)
  } catch (err) {
    reportIgnored(SCOPE, err)
    return false
  }
}

// volume 0..100, the slider's own scale.
export async function playChime(kind: ChimeKind, volume: number): Promise<void> {
  if (!(volume > 0)) return
  try {
    if (!ctx || !(await running(ctx))) {
      throw new Error('the browser allows no sound in this tab until it is clicked; later chimes will play')
    }
    const c = ctx
    const bus = c.createGain()
    bus.gain.value = (Math.min(100, volume) / 100) * BUS
    bus.connect(c.destination)
    NOTES[kind].forEach((hz, i) => {
      const at = c.currentTime + i * NOTE_GAP_S
      for (const [ratio, share] of PARTIALS) {
        const osc = c.createOscillator()
        const env = c.createGain()
        osc.frequency.value = hz * ratio
        env.gain.setValueAtTime(0, at)
        env.gain.linearRampToValueAtTime(share, at + 0.008)
        env.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_LENGTH_S)
        osc.connect(env).connect(bus)
        osc.start(at)
        osc.stop(at + NOTE_LENGTH_S)
      }
    })
  } catch (err) {
    reportIgnored(SCOPE, err)
  }
}
