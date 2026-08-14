import { useEffect, useState } from 'react'
import type { ActivePlay } from '../client/useChatInteractions'
import { interactionPhrase } from '../client/interactionCatalog'
import { useReducedMotion } from './reducedMotion'

// ---------------------------------------------------------------------------
// Where a chat interaction is drawn.
//
// An OVERLAY above the timeline, never inside a Row. Rows are recycled as the
// timeline scrolls and re-laid-out by same-sender grouping; an animation
// parented to one would die mid-play the moment its row re-rendered. The
// overlay instead resolves its anchors from the DOM when the play starts, and
// positions itself in the scroller's own coordinate space.
//
// It is `pointer-events: none` throughout and never occupies layout, so nothing
// it does can move, block or reflow a message (G-tp19).
//
// If an anchor cannot be resolved -- the person is scrolled out of view -- the
// play is DROPPED rather than aimed at the edge of the screen (O-in1). An
// interaction with nobody visible to receive it is not worth faking.
// ---------------------------------------------------------------------------

// Marks an element as "this is where user X currently is on screen". Set by
// AvatarPill, so every sender pill and membership row is an anchor for free.
export const USER_ANCHOR_ATTR = 'data-user-anchor'

interface Point {
  x: number
  y: number
}

// The centre of the LAST on-screen anchor for a user, in the scroller's
// coordinate space. Last, because in a chat the most recent thing somebody
// said is where you think of them as being.
function resolveAnchor(container: HTMLElement, userId: string): Point | null {
  const escaped = userId.replace(/["\\]/g, '\\$&')
  const nodes = container.querySelectorAll<HTMLElement>(`[${USER_ANCHOR_ATTR}="${escaped}"]`)
  if (nodes.length === 0) return null
  const box = container.getBoundingClientRect()
  for (let i = nodes.length - 1; i >= 0; i--) {
    const r = nodes[i].getBoundingClientRect()
    // Must actually be within the scroller's visible band -- a pill scrolled
    // out of view is still in the DOM.
    if (r.bottom < box.top || r.top > box.bottom) continue
    return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 }
  }
  return null
}

export function InteractionLayer({
  plays,
  containerRef,
  nameFor,
}: {
  plays: ActivePlay[]
  containerRef: React.RefObject<HTMLElement | null>
  nameFor: (userId: string) => string
}) {
  const reduced = useReducedMotion()

  return (
    <div className="tc-ix-layer" aria-hidden={false}>
      {plays.map((play) => (
        <InteractionPlay
          key={play.key}
          play={play}
          containerRef={containerRef}
          nameFor={nameFor}
          reduced={reduced}
        />
      ))}
    </div>
  )
}

function InteractionPlay({
  play,
  containerRef,
  nameFor,
  reduced,
}: {
  play: ActivePlay
  containerRef: React.RefObject<HTMLElement | null>
  nameFor: (userId: string) => string
  reduced: boolean
}) {
  // Anchors are resolved ONCE, in an effect after mount, and then held. Reading
  // them during render would be a layout read in the render phase; recomputing
  // them every frame would make the animation chase a scrolling list, which
  // looks like a bug rather than like physics.
  const [geom, setGeom] = useState<{ from: Point; to: Point | null } | null>(null)
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      setResolved(true)
      return
    }
    const from = resolveAnchor(container, play.actor)
    const to = play.target ? resolveAnchor(container, play.target) : null
    // Both ends must exist for a targeted play; the actor alone for a self one.
    if (!from || (play.target && !to)) {
      setGeom(null)
      setResolved(true)
      return
    }
    setGeom({ from, to })
    setResolved(true)
  }, [containerRef, play.actor, play.target])

  const phrase = interactionPhrase(
    play.def,
    nameFor(play.actor),
    play.target ? nameFor(play.target) : undefined,
  )

  if (!resolved) return null

  // Reduced motion does not mean no feedback -- it means say it in words.
  // Dropped plays say nothing at all: there is nobody on screen it concerns.
  if (!geom) return null
  if (reduced) {
    return (
      <div
        className="tc-ix-reduced"
        style={{ left: geom.from.x, top: geom.from.y }}
        role="status"
      >
        {play.def.glyph} {phrase}
      </div>
    )
  }

  const { from, to } = geom
  const style = {
    '--ix-from-x': `${from.x}px`,
    '--ix-from-y': `${from.y}px`,
    '--ix-to-x': `${(to ?? from).x}px`,
    '--ix-to-y': `${(to ?? from).y}px`,
    '--ix-dur': `${play.def.durationMs}ms`,
  } as React.CSSProperties

  if (play.def.shape === 'self') {
    return (
      <div className="tc-ix-self" data-action={play.def.id} style={style} role="status" aria-label={phrase}>
        <span className="tc-ix-glyph">{play.def.glyph}</span>
      </div>
    )
  }

  return (
    <div className="tc-ix-travel" data-action={play.def.id} style={style} role="status" aria-label={phrase}>
      {/* The hand/glyph that travels. Its stretch is a separate element so the
          travel transform and the squash transform do not fight. */}
      <span className="tc-ix-glyph">{play.def.glyph}</span>
      {/* Impact, parked at the target end. */}
      <span className="tc-ix-impact" aria-hidden="true" />
    </div>
  )
}
