import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { parseMxc } from '../client/media'
import { booruPostUrl, booruTagUrl } from '../client/booruUrl'
import { isHypeTag } from '../client/hypeTags'
import { useTagDiff, tagKey, type DiffedTag, type TagPhase } from '../client/useTagDiff'
import '../mediatags.css'
import { editBooruTags, refreshBooruTags, useMediaTags } from '../client/useMediaTags'
import { parseTagInput } from '../client/booruLive'
import { splitForBubble } from '../client/tagBubble'
import { useOnScreen } from './useOnScreen'
import { sortTags, type MediaRating, type MediaTag } from '../client/mediaTags'
import { useMediaTagPrefs } from './mediaTagSettings'
import { AnchoredPopup } from './AnchoredPopup'

// ---------------------------------------------------------------------------
// The tag display. ONE component attaches to every image surface; `variant`
// picks the density, because a 52px thread-card cover cannot carry what a
// chat image can:
//
//   'bubble'  a line UNDER the image, its top-left on the image's bottom-left:
//             the creator tag always, the character tag whenever there is
//             one, and an "expose tags" control that unfurls the rest to the
//             right as a popup over the page (launch-polish L5; the split is
//             client/tagBubble.ts). Chat images, the thread view, the DM
//             dock and the lightbox.
//   'chip'    a count badge only, overlaid bottom-left (gallery cells, thread
//             cards, canvas cards) -- click unfurls the same popup.
//
// WHY UNDER, AND WHY A POPUP. The tags used to stand BESIDE the picture as an
// out-of-flow column panel that reserved its width with a measured margin. In
// anything narrower than about 780px -- the thread view, a chat squeezed by
// the thread list -- the row shrank below the picture, `left: 100%` landed
// inside it, and the panel was painted over the image (measured: the panel
// started 8px inside the picture's left edge in a 380px thread view). In the
// lightbox the same rule put the panel entirely off-screen. A line under the
// picture cannot collide with it, and the full list lives in a popup that the
// panel's clipping cannot reach.
//
// Visibility is global-default + per-image pin (mediaTagSettings). Hiding an
// image's tags pins THAT image hidden; it does not change the global.
// ---------------------------------------------------------------------------

export interface MediaTagsProps {
  mxc: string | undefined
  // Enables the on-demand state fetch, so tags resolve for images whose tag
  // event is outside the loaded timeline. Pass it wherever it is known.
  roomId?: string
  variant?: 'bubble' | 'chip'
  // Hold the line under the picture from the first paint, before the image's
  // tag set has arrived. The caller passes it where tags are expected (a room
  // the bridge tags), so the set landing fills a line that is already there
  // instead of pushing the conversation down by a line -- and an image in a
  // room that is never tagged gets no empty line under it.
  reserve?: boolean
  onTagClick?: (tag: MediaTag) => void
}

export function MediaTags({ mxc, roomId, variant = 'bubble', reserve = false, onTagClick }: MediaTagsProps) {
  const set = useMediaTags(mxc, roomId)
  const prefs = useMediaTagPrefs()
  const mediaId = mxc ? parseMxc(mxc)?.mediaId : undefined
  const visible = prefs.visibleFor(mediaId)
  // SORTED ONCE PER SET, NOT ONCE PER RENDER. A bare `sortTags(set.tags)`
  // handed useTagDiff a brand-new array every render -- a new identity for the
  // same tags -- and its effect keys on that identity, which is what stopped
  // the hype pill bouncing (2026-09-20). Hoisted above the early returns
  // because a hook cannot run conditionally; `set.tags` is replaced only by a
  // real store write, so this recomputes exactly when the tags change.
  const tags = useMemo(() => sortTags(set?.tags ?? []), [set?.tags])

  // Nothing to show: no tags for this image (yet). Render nothing rather than
  // an empty line, so untagged images keep their exact layout.
  //
  // A set with NO TAGS BUT A POST ID is not nothing: it is the pointer, and the
  // bubble is what triggers the live read that fills it. Returning null there
  // would be a deadlock -- no bubble, so no read, so no tags, so no bubble.
  // Chips stay out of it: a "0" badge on every picture is worse than silence.
  const empty = !set || (set.tags.length === 0 && (set.postId === undefined || variant === 'chip'))
  if (empty) return variant === 'bubble' && reserve ? <div className="mtags-bubble" aria-hidden="true" /> : null

  const meta: TagMeta = { rating: set.rating, postId: set.postId, updatedBy: set.updatedBy }
  const hide = () => prefs.setOverride(mediaId ?? '', 'hide')
  const show = () => prefs.setOverride(mediaId ?? '', 'show')

  if (variant === 'chip') {
    return (
      <TagChip
        tags={tags}
        mediaId={mediaId}
        meta={meta}
        onTagClick={onTagClick}
        onReveal={visible ? undefined : show}
      />
    )
  }

  return (
    <TagBubble
      tags={tags}
      mediaId={mediaId}
      meta={meta}
      onTagClick={onTagClick}
      hidden={!visible}
      onHide={hide}
      onShow={show}
    />
  )
}

// The line under the picture.
//
// ONE LINE, RESERVED FROM THE MOMENT THE SET EXISTS. The live read is what
// turns Matrix's flat list into categories, so the creator and character pills
// usually arrive a moment after the line does; they fill a line that is
// already there instead of pushing the conversation down (no-forced-reflow).
// The line never wraps, and never makes the picture's column wider: pills
// shrink and ellipsize, and the control stays whole.
function TagBubble({
  tags,
  mediaId,
  meta,
  onTagClick,
  hidden,
  onHide,
  onShow,
}: {
  tags: MediaTag[]
  mediaId?: string
  meta: TagMeta
  onTagClick?: (tag: MediaTag) => void
  hidden: boolean
  onHide: () => void
  onShow: () => void
}) {
  // Diffed ONCE for the whole list and split after, so a tag the live read
  // recategorises from general to character pops out of the fold and into the
  // line as one change rather than two unrelated ones.
  const diffed = useTagDiff(tags)
  const { always, folded } = splitForBubble(diffed, (d) => d.tag.category)
  const foldedCount = folded.filter((d) => d.phase !== 'leaving').length

  // Scrolled into view -> read this image's CURRENT tags from the booru, which
  // is the only copy that is definitely right, and the only place the creator
  // and character categories come from. refreshBooruTags is idempotent -- it
  // refuses a duplicate read and a repeat inside its TTL.
  const { ref: lineRef, onScreen } = useOnScreen<HTMLDivElement>()
  useEffect(() => {
    if (onScreen && mediaId) refreshBooruTags(mediaId)
  }, [onScreen, mediaId])

  const [open, setOpen] = useState(false)
  const exposeRef = useRef<HTMLButtonElement>(null)
  const popId = useId()
  // The booru's refusal of an edit lives HERE, on the line, not in the popup:
  // the popup can close while an edit is still on its way, and a refusal that
  // lands on an unmounted panel is a failure nobody is told about (G-tc05).
  const [editError, setEditError] = useState<string | null>(null)

  // Hidden for this image (or globally): the line keeps its place and offers
  // the way back, so hiding is never a dead end and never moves the row.
  if (hidden) {
    return (
      <div className="mtags-bubble" ref={lineRef}>
        <button type="button" className="mtags-expose" onClick={onShow} title="Show tags for this image">
          {'\u{1F3F7}'} {tags.length}
        </button>
      </div>
    )
  }

  return (
    <div className="mtags-bubble" ref={lineRef}>
      {always.map((d) => (
        <TagPill key={tagKey(d.tag)} tag={d.tag} phase={d.phase} onTagClick={onTagClick} />
      ))}
      <button
        ref={exposeRef}
        type="button"
        className="mtags-expose"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        data-error={editError ? 'true' : undefined}
        title={
          editError
            ? `The booru refused the last edit: ${editError}`
            : foldedCount > 0
              ? `Show all ${tags.length} tags`
              : 'Tag details'
        }
        onClick={() => setOpen((v) => !v)}
      >
        {/* Two parts, so under a narrow picture the words give way before the
            count does. */}
        <span className="mtags-expose-label">expose tags</span>
        {foldedCount > 0 && <span className="mtags-expose-n">({foldedCount})</span>}
      </button>
      {open && (
        <AnchoredPopup anchorRef={exposeRef} onClose={() => setOpen(false)} label="Tags" id={popId}>
          <TagPanel
            tags={tags}
            mediaId={mediaId}
            meta={meta}
            onTagClick={onTagClick}
            error={editError}
            onError={setEditError}
            onCollapse={() => setOpen(false)}
            onHide={() => {
              setOpen(false)
              onHide()
            }}
          />
        </AnchoredPopup>
      )}
    </div>
  )
}

// The whole tag set, as the popup's contents.
//
// It opens ON the control that summoned it, so its first item is the control's
// counterpart -- "collapse" sits where "expose tags" was, and the popup reads
// as that button unfurling rightward into the list rather than as a second
// window. Then the controls (rating, edit), then who made it and who is in it,
// then everything else, then the post and "hide".
function TagPanel({
  tags,
  mediaId,
  meta,
  onTagClick,
  error,
  onError,
  onCollapse,
  onHide,
}: {
  tags: MediaTag[]
  mediaId?: string
  meta: TagMeta
  onTagClick?: (tag: MediaTag) => void
  // Owned by the line or chip that opened this, which outlives it.
  error: string | null
  onError: (message: string | null) => void
  onCollapse: () => void
  onHide?: () => void
}) {
  // A retag arrives as a whole new set, so the panel works out which pill
  // moved before drawing the change rather than the result. Leaving pills stay
  // in the list until their exit finishes.
  const diffed = useTagDiff(tags)
  const { always, folded } = splitForBubble(diffed, (d) => d.tag.category)

  // Editing is OFF by default. The x on every pill is a destructive control
  // one pixel from a link people click all day, so it appears only once
  // somebody has said they are tagging.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // The booru's answer replaces the guess, so nothing here waits on the round
  // trip -- `busy` only dims the input, it does not gate the pill.
  const [busy, setBusy] = useState(false)

  const run = (edit: { add?: string[]; remove?: string[] }) => {
    if (!mediaId) return
    onError(null)
    setBusy(true)
    editBooruTags(mediaId, edit)
      .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }

  // Only where there is a post to write to. Without one the booru has nothing
  // to edit, and a control that always fails is worse than no control.
  const canEdit = meta.postId !== undefined && !!mediaId

  const submit = () => {
    const names = parseTagInput(draft)
    if (names.length === 0) return
    setDraft('')
    run({ add: names })
  }

  const pill = (d: DiffedTag) => (
    <TagPill
      key={tagKey(d.tag)}
      tag={d.tag}
      phase={d.phase}
      onTagClick={onTagClick}
      onRemove={editing ? () => run({ remove: [d.tag.name] }) : undefined}
    />
  )

  return (
    <div className="mtags-pop">
      <div className="mtags-head">
        <button type="button" className="mtags-expose is-open" aria-expanded="true" onClick={onCollapse}>
          collapse
        </button>
        {meta.rating && <RatingBadge rating={meta.rating} by={meta.updatedBy} />}
        {canEdit && (
          <button
            type="button"
            className={'mtags-edit' + (editing ? ' is-on' : '')}
            onClick={() => {
              setEditing((v) => !v)
              onError(null)
            }}
            title={editing ? 'Stop editing tags' : 'Add or remove tags on the booru'}
            aria-pressed={editing}
          >
            {editing ? 'done' : 'edit tags'}
          </button>
        )}
      </div>
      {canEdit && editing && (
        <input
          className="mtags-add"
          value={draft}
          autoFocus
          disabled={busy}
          placeholder="add tags"
          aria-label="Add tags to this post"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft('')
              setEditing(false)
            }
            // The timeline binds single keys; a tag being typed is not a shortcut.
            e.stopPropagation()
          }}
          onBlur={submit}
        />
      )}
      {error && (
        <div className="mtags-error" role="alert">
          {error}
        </div>
      )}
      {always.length > 0 && (
        <div className="mtags-shelf">
          {always.map(pill)}
        </div>
      )}
      {folded.length > 0 && <div className="mtags-flow">{folded.map(pill)}</div>}
      <div className="mtags-foot">
        {meta.postId !== undefined && (
          <a
            className="mtags-id"
            href={booruPostUrl(meta.postId)}
            target="_blank"
            rel="noreferrer noopener"
            title="Open this post on the booru"
          >
            #{meta.postId}
          </a>
        )}
        {onHide && (
          <button type="button" className="mtags-ghost" onClick={onHide} title="Hide tags for this image">
            hide
          </button>
        )}
      </div>
    </div>
  )
}

// Where the pointer is, for every hyped pill at once. One passive listener;
// the pills read it on their own clock. -1 means "not over the page".
const pointer = { x: -1, y: -1 }
if (typeof document !== 'undefined') {
  document.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY }, { passive: true })
  document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) { pointer.x = -1; pointer.y = -1 } })
}

// Is the pointer over the element's LAYOUT box -- where it sits on the page,
// which a transform does not move? getBoundingClientRect would follow the
// tumble and answer "no" twice a turn; offsetLeft/offsetTop do not.
//
// offsetLeft/Top are measured inside the offsetParent's padding box and do not
// move when it scrolls, so its border and scroll are folded in: inside the tag
// popup, which scrolls, a hovered pill was otherwise judged "away" and wound
// down under the pointer.
function overLayoutBox(el: HTMLElement): boolean {
  const op = (el.offsetParent as HTMLElement | null) ?? document.body
  const pr = op.getBoundingClientRect()
  const l = pr.left + op.clientLeft + el.offsetLeft - op.scrollLeft
  const t = pr.top + op.clientTop + el.offsetTop - op.scrollTop
  const pad = 6
  return pointer.x >= l - pad && pointer.x <= l + el.offsetWidth + pad && pointer.y >= t - pad && pointer.y <= t + el.offsetHeight + pad
}

function hypeGraceMs(el: HTMLElement): number {
  return parseFloat(getComputedStyle(el).getPropertyValue('--mod-hype-grace')) || 800
}

// One tag.
//
// An ANCHOR, not a button: a tag is a place on the booru, so it has to be
// middle-clickable, copyable and openable in a new tab like any other link.
// onTagClick still runs for callers that want to intercept (the lightbox
// filters in place rather than navigating), and only then is the navigation
// suppressed.
function TagPill({
  tag,
  phase = 'steady',
  onTagClick,
  onRemove,
}: {
  tag: MediaTag
  phase?: TagPhase
  onTagClick?: (t: MediaTag) => void
  // Present only while the panel is in edit mode. Its absence is what keeps a
  // destructive control away from a link people click all day.
  onRemove?: () => void
}) {
  const hype = isHypeTag(tag.name)
  // A hyped pill's states, all classes -- never :hover, which a tumbling pill
  // leaves twice a turn, restarting the animation on every flicker. Spinning
  // goes on at pointer-enter and stays on; while it is on, a 100ms poll asks
  // whether the pointer is still over the pill's layout box, and only after
  // it has been away for the grace period does the wind-down start. Same
  // contract as the booru's post page.
  const [spin, setSpin] = useState<'idle' | 'spinning' | 'winding'>('idle')
  const ref = useRef<HTMLAnchorElement>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (spin !== 'spinning') return
    let away: number | null = null
    const grace = ref.current ? hypeGraceMs(ref.current) : 800
    const tick = () => {
      const el = ref.current
      if (!el || !el.isConnected) { setSpin('idle'); return }
      if (overLayoutBox(el)) away = null
      else if (away === null) away = performance.now()
      if (away !== null && performance.now() - away >= grace) { setSpin('winding'); return }
      timer.current = window.setTimeout(tick, 100)
    }
    tick()
    return () => { if (timer.current !== null) window.clearTimeout(timer.current) }
  }, [spin])
  // A leaving pill is already gone from the data and is on screen only long
  // enough to be seen going, so it must not be clickable on the way out.
  const leaving = phase === 'leaving'
  const pill = (
    <a
      className={
        // TWO AXES, AND THEY MUST NOT BORROW EACH OTHER'S COLOURS. Provenance
        // paints the pill -- who put the tag there is the question a reader
        // asks of a tag list -- and the category keeps the dot. That is the
        // same split Modulation makes on the booru's own post page, inverted
        // only in which axis got the larger surface, and it is why a general
        // tag here is no longer a blue pill: on the booru it is orange
        // because the autotagger supplied it.
        //
        // No provenance yet (the sidecar has no row, or it has not been read)
        // falls back to the category colour, which is exactly what shipped
        // before provenance existed.
        // The PILL is the category; the DOT is the lamp. Provenance used to
        // paint the pill (mod-pill--src-*) for one evening; the operator's
        // ruling of 2026-09-20 moved it to the dot as WHICH MODEL, and the
        // tint went back to category so each axis has one surface.
        `mod-pill mod-pill--cat-${tag.category}` +
        (hype ? ' mod-pill--hype' : '') +
        (hype && spin === 'spinning' ? ' is-spinning' : '') +
        (hype && spin === 'winding' ? ' is-spinning-down' : '') +
        (phase === 'entering' ? ' mod-pill--in' : '') +
        (leaving ? ' mod-pill--out' : '')
      }
      ref={ref}
      onPointerEnter={hype ? () => setSpin('spinning') : undefined}
      onAnimationEnd={hype ? (e) => { if (e.animationName === 'mod-hype-spin-down') setSpin('idle') } : undefined}
      aria-hidden={leaving ? 'true' : undefined}
      tabIndex={leaving ? -1 : undefined}
      href={tag.url ?? booruTagUrl(tag.name)}
      target="_blank"
      rel="noreferrer noopener"
      title={tag.score !== undefined ? `${tag.category} - ${Math.round(tag.score * 100)}%` : tag.category}
      onClick={
        leaving
          ? (e) => e.preventDefault()
          : onTagClick
            ? (e) => {
                e.preventDefault()
                onTagClick(tag)
              }
            : undefined
      }
    >
      <i className={'mod-pill-dot' + (tag.lamp ? ` mod-pill-dot--${tag.lamp}` : '')} />
      {/* Its own box, so a pill squeezed by the bubble under a narrow picture
          ellipsizes instead of being cut mid-letter. */}
      <span className="mod-pill-name">{tag.name}</span>
    </a>
  )

  // Not in edit mode: the pill IS the flex item, exactly as it was. Wrapping it
  // unconditionally would change every panel's layout to buy a control almost
  // nobody has open.
  //
  // A leaving pill gets no x either: it is already gone from the data and is on
  // screen only long enough to be seen going, so removing it again is a write
  // that would either do nothing or undo somebody else's.
  if (!onRemove || leaving) return pill

  return (
    <span className="mtags-tagrow">
      {pill}
      <button
        type="button"
        className="mtags-x"
        onClick={onRemove}
        title={`Remove ${tag.name} from this post`}
        aria-label={`Remove tag ${tag.name}`}
      >
        {'\u00d7'}
      </button>
    </span>
  )
}

// What the popup says about the post besides its tags.
interface TagMeta {
  rating?: MediaRating
  postId?: number
  updatedBy?: string
}

// Content rating. Leads the strip because it is the one field a user may want
// to act on before looking closely; explicit/questionable carry a warm accent,
// general/sensitive stay quiet.
const RATING_LABEL: Record<MediaRating, string> = {
  g: 'general',
  s: 'sensitive',
  q: 'questionable',
  e: 'explicit',
}

const RATING_COLOR: Record<MediaRating, string> = {
  g: '#64748b',
  s: '#0369a1',
  q: '#c2410c',
  e: '#be123c',
}

function RatingBadge({ rating, by }: { rating: MediaRating; by?: string }) {
  return (
    <span
      title={by ? `Rated ${RATING_LABEL[rating]} · tagged by ${by}` : `Rated ${RATING_LABEL[rating]}`}
      style={{
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1.4,
        padding: '1px 5px',
        borderRadius: 4,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        border: `1px solid ${RATING_COLOR[rating]}66`,
        background: `${RATING_COLOR[rating]}22`,
        color: RATING_COLOR[rating],
      }}
    >
      {rating}
    </span>
  )
}


// The count badge used on small surfaces, positioned by its container. Its
// list is the same popup the bubble opens, so a 52px thread-card cover no
// longer clips it -- and opening it is what reads the image's live tags, since
// a chip is never on screen long enough for anything else to.
function TagChip({
  tags,
  mediaId,
  meta,
  onTagClick,
  onReveal,
}: {
  tags: MediaTag[]
  mediaId?: string
  meta: TagMeta
  onTagClick?: (tag: MediaTag) => void
  // Present while this image's tags are hidden: opening shows them again.
  onReveal?: () => void
}) {
  const [open, setOpen] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)
  const popId = useId()
  const [editError, setEditError] = useState<string | null>(null)
  useEffect(() => {
    if (open && mediaId) refreshBooruTags(mediaId)
  }, [open, mediaId])
  return (
    <div className="mtags-chip-slot">
      <button
        ref={chipRef}
        type="button"
        className="mtags-chip"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={(e) => {
          // The chip sits on a card that opens its thread on click.
          e.stopPropagation()
          onReveal?.()
          setOpen((v) => !v)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        data-error={editError ? 'true' : undefined}
        title={editError ? `The booru refused the last edit: ${editError}` : `${tags.length} tag${tags.length === 1 ? '' : 's'}`}
      >
        {'\u{1F3F7}'} {tags.length}
      </button>
      {open && (
        <AnchoredPopup anchorRef={chipRef} onClose={() => setOpen(false)} label="Tags" id={popId}>
          <TagPanel
            tags={tags}
            mediaId={mediaId}
            meta={meta}
            onTagClick={onTagClick}
            error={editError}
            onError={setEditError}
            onCollapse={() => setOpen(false)}
          />
        </AnchoredPopup>
      )}
    </div>
  )
}
