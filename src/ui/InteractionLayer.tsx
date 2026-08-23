import { useEffect, useRef, useState } from 'react'
import type { ActivePlay } from '../client/useChatInteractions'
import { interactionPhrase } from '../client/interactionCatalog'
import { AvatarDisc } from './AvatarDisc'
import { soak } from './drench'
import {
  anchorPoint,
  anchorsSatisfied,
  approachStart,
  inSplash,
  stopShort,
  GUARD_STANDOFF_PX,
  arcSign,
  armSegment,
  travelPoses,
  type Point,
  type RectLike,
} from './interactionGeometry'
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
// The layer MUST be mounted OUTSIDE the scroller, as a sibling of it. Inside
// one, `inset: 0` pins it to the top of the scrolled content instead of to the
// visible box, and every play draws scrollTop pixels off screen. See
// interactionGeometry.ts -- the geometry is separated out and checked precisely
// so that mistake cannot come back silently.
//
// If an anchor cannot be resolved -- the person is scrolled out of view -- the
// play is DROPPED rather than aimed at the edge of the screen (O-in1). An
// interaction with nobody visible to receive it is not worth faking.
// ---------------------------------------------------------------------------

// Marks an element as "this is where user X currently is on screen". Set by
// AvatarPill, so every sender pill and membership row is an anchor for free.
export const USER_ANCHOR_ATTR = 'data-user-anchor'

// The centre of the LAST on-screen anchor for a user, in the LAYER's coordinate
// space. Last, because in a chat the most recent thing somebody said is where
// you think of them as being. Anchors are searched inside the scroller and
// judged against its visible band, but measured from the layer -- the two boxes
// are not the same one (interactionGeometry.ts).
function resolveAnchor(
  container: HTMLElement,
  layer: RectLike,
  userId: string,
): Point | null {
  const escaped = userId.replace(/["\\]/g, '\\$&')
  const nodes = container.querySelectorAll<HTMLElement>(`[${USER_ANCHOR_ATTR}="${escaped}"]`)
  if (nodes.length === 0) return null
  const box = container.getBoundingClientRect()
  for (let i = nodes.length - 1; i >= 0; i--) {
    const p = anchorPoint(box, layer, nodes[i].getBoundingClientRect())
    if (p) return p
  }
  return null
}

// Which row an anchor belongs to. Rows carry data-event-id already, for
// click-to-jump, so the water can be keyed on the same id the timeline uses --
// no second index to keep in sync.
function rowIdOf(el: Element): string | null {
  return el.closest('[data-event-id]')?.getAttribute('data-event-id') ?? null
}

// Everyone caught in the line of fire, computed FROM THIS CLIENT'S OWN VIEWPORT
// (D-in09). The wire says only who squirted whom; who was standing in the way
// is a different answer on every screen, and the only honest one is the one
// drawn from the screen it is shown on.
function applySplash(
  container: HTMLElement,
  layer: RectLike,
  play: ActivePlay,
  from: Point,
  to: Point,
): void {
  const box = container.getBoundingClientRect()
  const targetId = play.target

  const nodes = container.querySelectorAll<HTMLElement>(`[${USER_ANCHOR_ATTR}]`)
  for (const el of nodes) {
    const user = el.getAttribute(USER_ANCHOR_ATTR)
    if (!user) continue
    const rowId = rowIdOf(el)
    if (!rowId) continue
    // The person hit is soaked; the shooter is not, however close they stand to
    // their own jet.
    if (user === targetId) {
      soak(rowId, 'primary')
      continue
    }
    if (user === play.actor) continue
    const p = anchorPoint(box, layer, el.getBoundingClientRect())
    if (p && inSplash(p, from, to)) soak(rowId, 'secondary')
  }
}

export function InteractionLayer({
  plays,
  containerRef,
  nameFor,
  avatarFor,
}: {
  plays: ActivePlay[]
  containerRef: React.RefObject<HTMLElement | null>
  nameFor: (userId: string) => string
  // An 'approach' play draws the ACTOR themselves next to the target, so the
  // overlay needs their avatar rather than only their name.
  avatarFor: (userId: string) => string | null
}) {
  const reduced = useReducedMotion()
  const layerRef = useRef<HTMLDivElement | null>(null)

  return (
    <div className="tc-ix-layer" ref={layerRef} aria-hidden={false}>
      {plays.map((play) => (
        <InteractionPlay
          key={play.key}
          play={play}
          containerRef={containerRef}
          layerRef={layerRef}
          nameFor={nameFor}
          avatarFor={avatarFor}
          reduced={reduced}
        />
      ))}
    </div>
  )
}

function InteractionPlay({
  play,
  containerRef,
  layerRef,
  nameFor,
  avatarFor,
  reduced,
}: {
  play: ActivePlay
  containerRef: React.RefObject<HTMLElement | null>
  layerRef: React.RefObject<HTMLElement | null>
  nameFor: (userId: string) => string
  avatarFor: (userId: string) => string | null
  reduced: boolean
}) {
  // Anchors are resolved ONCE, in an effect after mount, and then held. Reading
  // them during render would be a layout read in the render phase; recomputing
  // them every frame would make the animation chase a scrolling list, which
  // looks like a bug rather than like physics.
  const [geom, setGeom] = useState<{ from: Point | null; to: Point | null } | null>(null)
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    const layer = layerRef.current
    if (!container || !layer) {
      setResolved(true)
      return
    }
    const layerBox = layer.getBoundingClientRect()
    const from = resolveAnchor(container, layerBox, play.actor)
    const to = play.target ? resolveAnchor(container, layerBox, play.target) : null
    // Which ends have to be present is the definition's call, not a blanket
    // rule. An 'approach' stages itself entirely around the target and draws
    // the actor itself, so demanding the actor's pill be on screen would drop
    // plays that had everything they needed.
    if (!anchorsSatisfied(play.def.anchors, from, to)) {
      setGeom(null)
      setResolved(true)
      return
    }
    setGeom({ from, to })
    setResolved(true)

    // Water is left where the blast passed, and only for a blast that actually
    // arrived: a deflected squirt hits a guard, not a person.
    if (play.def.id === 'squirt' && from && to && !play.deflected) {
      applySplash(container, layerBox, play, from, to)
    }
  }, [containerRef, layerRef, play])

  const phrase = interactionPhrase(
    play.def,
    nameFor(play.actor),
    play.target ? nameFor(play.target) : undefined,
  )

  if (!resolved) return null

  // Reduced motion does not mean no feedback -- it means say it in words.
  // Dropped plays say nothing at all: there is nobody on screen it concerns.
  if (!geom) return null
  // Where the words go: beside whoever the play is ABOUT, which for an approach
  // is the target (the actor may not be on screen at all).
  const label = geom.to ?? geom.from
  if (reduced) {
    return label ? (
      <div className="tc-ix-reduced" style={{ left: label.x, top: label.y }} role="status">
        {play.def.glyph} {phrase}
      </div>
    ) : null
  }

  const { from, to } = geom
  // The arc side, and the side an approach comes in from. Hashed from the play
  // id so both clients bow the same slap the same way (arcSign).
  const sign = arcSign(play.key)

  if (play.def.choreo === 'self') {
    if (!from) return null
    const style = {
      '--ix-from-x': `${from.x}px`,
      '--ix-from-y': `${from.y}px`,
      '--ix-dur': `${play.def.durationMs}ms`,
    } as React.CSSProperties
    return (
      <div className="tc-ix-self" data-action={play.def.id} style={style} role="status" aria-label={phrase}>
        <span className="tc-ix-glyph">{play.def.glyph}</span>
      </div>
    )
  }

  if (play.def.choreo === 'approach') {
    if (!to) return null
    // Hug always comes in from the RIGHT, per the operator's staging -- it is a
    // described gesture, not a random one. Poke and boop take the hashed side,
    // so a run of them does not look mechanical.
    const side = play.def.id === 'hug' ? 1 : sign
    const start = approachStart(to, side)
    // Held at arm's length rather than refused: a deflected play still plays,
    // it just does not arrive. Stopping AT the target and skipping the impact
    // would read as a hit that failed to render.
    const dest = play.deflected ? stopShort(start, to, GUARD_STANDOFF_PX) : to
    const style = {
      '--ix-from-x': `${start.x}px`,
      '--ix-from-y': `${start.y}px`,
      '--ix-to-x': `${dest.x}px`,
      '--ix-to-y': `${dest.y}px`,
      // Which way the glyph points, so a finger jabbing leftwards is not drawn
      // pointing away from the person it is jabbing.
      '--ix-face': side === 1 ? '-1' : '1',
      '--ix-dur': `${play.def.durationMs}ms`,
    } as React.CSSProperties
    return (
      <div
        className="tc-ix-approach"
        data-action={play.def.id}
        data-deflected={play.deflected ? 'true' : undefined}
        style={style}
        role="status"
        aria-label={phrase}
      >
        {/* The actor, arriving. A bare disc rather than the whole pill: a name
            plate sliding across the timeline reads as UI coming loose. */}
        <span className="tc-ix-actor" aria-hidden="true">
          <AvatarDisc
            userId={play.actor}
            name={nameFor(play.actor)}
            avatarMxc={avatarFor(play.actor)}
            size={30}
          />
        </span>
        {/* The gesture itself, superimposed once the two have converged. */}
        <span className="tc-ix-glyph">{play.def.glyph}</span>
      </div>
    )
  }

  // 'travel': thrown from the actor to the target and pulled back.
  if (!from || !to) return null
  const dest = play.deflected ? stopShort(from, to, GUARD_STANDOFF_PX) : to
  const poses = travelPoses(from, dest, sign)
  // The arm is sampled at the same poses the hand is keyframed at, so the two
  // never disagree about where the hand is.
  const arm = {
    windup: armSegment(from, poses.windup),
    mid: armSegment(from, poses.mid),
    impact: armSegment(from, poses.impact),
    recoil: armSegment(from, poses.recoil),
  }
  const style = {
    '--ix-from-x': `${from.x}px`,
    '--ix-from-y': `${from.y}px`,
    '--ix-mid-x': `${poses.mid.x}px`,
    '--ix-mid-y': `${poses.mid.y}px`,
    '--ix-to-x': `${dest.x}px`,
    '--ix-to-y': `${dest.y}px`,
    '--ix-arm-a1': `${arm.windup.angle}deg`,
    '--ix-arm-l1': `${arm.windup.length}`,
    '--ix-arm-a2': `${arm.mid.angle}deg`,
    '--ix-arm-l2': `${arm.mid.length}`,
    '--ix-arm-a3': `${arm.impact.angle}deg`,
    '--ix-arm-l3': `${arm.impact.length}`,
    '--ix-arm-a4': `${arm.recoil.angle}deg`,
    '--ix-arm-l4': `${arm.recoil.length}`,
    '--ix-dur': `${play.def.durationMs}ms`,
  } as React.CSSProperties

  return (
    <>
      {/* The arm, pinned at the actor and rotating to follow the hand. Its own
          element, and a SIBLING of the travelling hand rather than a child --
          inside it, it would inherit the hand's translation and never stretch.
          Rendered first so the hand sits over the arm it is attached to. */}
      {play.def.tether && (
        <div className="tc-ix-arm-anchor" style={style} aria-hidden="true">
          <span className="tc-ix-arm" />
        </div>
      )}
      {/* The shield, at the end the play now starts from -- which after a
          reflection is the guarded person, because the ends were swapped. It is
          the only sign that this was not simply somebody attacking backwards. */}
      {(play.reflected || play.deflected) && (
        <div className="tc-ix-shield" style={style} aria-hidden="true">
          <span>{'\u{1F6E1}'}</span>
        </div>
      )}
      <div
        className="tc-ix-travel"
        data-action={play.def.id}
        data-deflected={play.deflected ? 'true' : undefined}
        style={style}
        role="status"
        aria-label={phrase}
      >
        {/* The hand/glyph that travels. Its stretch is a separate element so the
            travel transform and the squash transform do not fight. */}
        <span className="tc-ix-glyph">{play.def.glyph}</span>
        {/* Impact, parked at the target end. */}
        <span className="tc-ix-impact" aria-hidden="true" />
      </div>
    </>
  )
}
