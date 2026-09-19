import { useEffect, useRef, useState } from 'react'
import { parseMxc } from '../client/media'
import { booruPostUrl, booruTagUrl } from '../client/booruUrl'
import { isHypeTag } from '../client/hypeTags'
import { useTagDiff, tagKey, type TagPhase } from '../client/useTagDiff'
import '../mediatags.css'
import { editBooruTags, refreshBooruTags, useMediaTags } from '../client/useMediaTags'
import { parseTagInput } from '../client/booruLive'
import { useOnScreen } from './useOnScreen'
import { sortTags, type MediaRating, type MediaTag, type TagCategory } from '../client/mediaTags'
import { useMediaTagPrefs } from './mediaTagSettings'
import { useReducedMotion } from './reducedMotion'

// ---------------------------------------------------------------------------
// The tag display. ONE component attaches to every image surface; `variant`
// picks the density, because a 180x90 thread-card preview cannot carry what a
// full-width chat image can:
//
//   'strip'   full tag row under the image (inline chat, lightbox)
//   'chip'    a count badge only, overlaid bottom-left (canvas cards, thread
//             previews) -- click expands into a floating strip
//
// Visibility is global-default + per-image pin (mediaTagSettings). Collapsing a
// strip pins THAT image hidden; it does not change the global.
//
// Tags are rendered as buttons already: v1 does nothing on click beyond the
// per-tag `onTagClick` seam, so the filter/search layer can land later without
// restyling anything (operator: wire for interaction, stay scoped for v1).
// ---------------------------------------------------------------------------

// Category -> canon token. The chip variant used to carry its own light and
// dark palettes for the five categories, which is exactly the drift the
// formant tokens were extracted to end (artist #fb923c here against #ff6b7a
// on the booru); it now names the same tokens the panel's stylesheet does.
const CATEGORY_TOKEN: Record<TagCategory, string> = {
  artist: 'var(--mod-tag-artist-fg)',
  character: 'var(--mod-tag-character-fg)',
  copyright: 'var(--mod-tag-copyright-fg)',
  meta: 'var(--mod-tag-meta-fg)',
  general: 'var(--mod-tag-general-fg)',
}

// Categories pulled out of the flow into their own bucket at the head of the
// panel, in this order. Mirrors Modulation's .mod-cats: the question "who is
// this" is answered before "what is in it".
const HEAD_CATEGORIES: readonly TagCategory[] = ['character']

export interface MediaTagsProps {
  mxc: string | undefined
  // Enables the on-demand state fetch, so tags resolve for images whose tag
  // event is outside the loaded timeline. Pass it wherever it is known.
  roomId?: string
  variant?: 'strip' | 'chip'
  // Cap before "+N more"; the full set expands in place. Omit for no cap.
  max?: number
  onTagClick?: (tag: MediaTag) => void
}

export function MediaTags({ mxc, roomId, variant = 'strip', max = 12, onTagClick }: MediaTagsProps) {
  const set = useMediaTags(mxc, roomId)
  const prefs = useMediaTagPrefs()
  const mediaId = mxc ? parseMxc(mxc)?.mediaId : undefined
  const visible = prefs.visibleFor(mediaId)
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)

  // Nothing to show: no tags for this image (yet). Render nothing at all rather
  // than an empty container, so untagged images keep their exact layout.
  //
  // A set with NO TAGS BUT A POST ID is not nothing: it is the pointer, and the
  // panel is what triggers the live read that fills it. Returning null there
  // would be a deadlock -- no panel, so no read, so no tags, so no panel -- and
  // it is the shape the bridge moves towards as it stops copying tag lists into
  // room state. Chips stay out of it: they are previews with nothing but a
  // count to show, and a "0" badge on every picture is worse than silence.
  if (!set) return null
  if (set.tags.length === 0 && (set.postId === undefined || variant === 'chip')) return null

  const tags = sortTags(set.tags)
  const meta = { rating: set.rating, postId: set.postId, updatedBy: set.updatedBy }
  const hidden = !visible

  if (variant === 'chip') {
    return (
      <TagChip
        count={tags.length}
        expanded={expanded && visible}
        onToggle={() => {
          if (hidden) prefs.setOverride(mediaId ?? '', 'show')
          setExpanded((e) => !e)
        }}
      >
        {expanded && visible && (
          <TagList
            tags={tags}
            max={showAll ? undefined : max}
            onMore={() => setShowAll(true)}
            onTagClick={onTagClick}
            source={set.source}
            meta={meta}
            floating
          />
        )}
      </TagChip>
    )
  }

  // Strip pinned hidden: leave a small affordance so the tags are recoverable
  // without hunting for the global switch (no dead states, CD-10 lineage).
  if (hidden) {
    return (
      <div style={{ marginTop: 4 }}>
        <button
          type="button"
          onClick={() => prefs.setOverride(mediaId ?? '', 'show')}
          title="Show tags for this image"
          style={ghostBtn}
        >
          {'\u{1F3F7}'} {tags.length}
        </button>
      </div>
    )
  }

  return (
    <TagPanel
      tags={tags}
      mediaId={mediaId}
      max={showAll ? undefined : max}
      onMore={() => setShowAll(true)}
      onTagClick={onTagClick}
      meta={meta}
      onCollapse={() => prefs.setOverride(mediaId ?? '', 'hide')}
    />
  )
}

// The panel that stands beside the image.
//
// Sorting is sortTags': category order, then alphabetical inside it. The head
// bucket is then split off the front, so `character` leads and everything else
// keeps that same alphabetical-within-category order below the rule.
function TagPanel({
  tags,
  mediaId,
  max,
  onMore,
  onTagClick,
  meta,
  onCollapse,
}: {
  tags: MediaTag[]
  mediaId?: string
  max?: number
  onMore: () => void
  onTagClick?: (tag: MediaTag) => void
  meta?: TagMeta
  onCollapse?: () => void
}) {
  const shown = max === undefined ? tags : tags.slice(0, max)
  const rest = tags.length - shown.length
  // A retag arrives as a whole new set, so the panel has to work out which
  // pill moved before it can draw the change rather than the result. Leaving
  // pills stay in the list until their exit finishes.
  const diffed = useTagDiff(shown)
  const head = diffed.filter((d) => HEAD_CATEGORIES.includes(d.tag.category))
  const body = diffed.filter((d) => !HEAD_CATEGORIES.includes(d.tag.category))

  // Scrolled into view -> read this image's CURRENT tags from the booru, which
  // is the only copy that is definitely right. Whatever comes back differs
  // from what is drawn arrives through the same diff above, so a tag added on
  // the booru pops in here and a tag removed there pops out, without this
  // component knowing a request happened.
  //
  // refreshBooruTags is idempotent -- it refuses a duplicate read and a repeat
  // inside its TTL -- so an image scrolled past and back costs nothing.
  const { ref: panelRef, onScreen } = useOnScreen<HTMLDivElement>()
  useEffect(() => {
    if (onScreen && mediaId) refreshBooruTags(mediaId)
  }, [onScreen, mediaId])

  // Editing is OFF by default and per-panel. The x on every pill is a
  // destructive control one pixel from a link people click all day, so it
  // appears only once somebody has said they are tagging.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  // The booru's answer replaces the guess, so nothing here waits on the round
  // trip -- `busy` only dims the input, it does not gate the pill.
  const [busy, setBusy] = useState(false)

  const run = (edit: { add?: string[]; remove?: string[] }) => {
    if (!mediaId) return
    setError(null)
    setBusy(true)
    editBooruTags(mediaId, edit)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }

  const submit = () => {
    const names = parseTagInput(draft)
    if (names.length === 0) return
    setDraft('')
    run({ add: names })
  }

  return (
    <div className="mtags-panel" ref={panelRef}>
      {meta?.rating && <RatingBadge rating={meta.rating} by={meta.updatedBy} />}
      {head.length > 0 && (
        <>
          <div className="mtags-label">{head.length === 1 ? 'character' : 'characters'}</div>
          {head.map((d) => (
            <TagPill
              key={tagKey(d.tag)}
              tag={d.tag}
              phase={d.phase}
              onTagClick={onTagClick}
              onRemove={editing ? () => run({ remove: [d.tag.name] }) : undefined}
            />
          ))}
          <div className="mtags-rule" />
        </>
      )}
      {body.map((d) => (
        <TagPill
          key={tagKey(d.tag)}
          tag={d.tag}
          phase={d.phase}
          onTagClick={onTagClick}
          onRemove={editing ? () => run({ remove: [d.tag.name] }) : undefined}
        />
      ))}
      {rest > 0 && (
        <button type="button" onClick={onMore} style={ghostBtn}>
          +{rest} more
        </button>
      )}
      {/* Only where there is a post to edit. Without one the booru has nothing
          to write to, and a control that always fails is worse than none. */}
      {meta?.postId !== undefined && mediaId && (
        <>
          {editing && (
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
                // The timeline binds single keys; a tag being typed is not a
                // shortcut.
                e.stopPropagation()
              }}
              onBlur={submit}
            />
          )}
          <button
            type="button"
            style={ghostBtn}
            onClick={() => {
              setEditing((v) => !v)
              setError(null)
            }}
            title={editing ? 'Stop editing tags' : 'Edit tags on the booru'}
          >
            {editing ? 'done' : '+ tag'}
          </button>
          {error && (
            <div className="mtags-error" role="alert">
              {error}
            </div>
          )}
        </>
      )}
      {meta?.postId !== undefined && (
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
      {onCollapse && (
        <button type="button" onClick={onCollapse} style={ghostBtn} title="Hide tags for this image">
          hide
        </button>
      )}
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
function overLayoutBox(el: HTMLElement): boolean {
  const op = (el.offsetParent as HTMLElement | null) ?? document.body
  const pr = op.getBoundingClientRect()
  const l = pr.left + el.offsetLeft
  const t = pr.top + el.offsetTop
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
      <i className="mod-pill-dot" />
      {tag.name}
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

// The row of tags itself.
interface TagMeta {
  rating?: MediaRating
  postId?: number
  updatedBy?: string
}

function TagList({
  tags,
  max,
  onMore,
  onTagClick,
  source,
  meta,
  onCollapse,
  floating = false,
}: {
  tags: MediaTag[]
  max?: number
  onMore: () => void
  onTagClick?: (tag: MediaTag) => void
  source?: string
  meta?: TagMeta
  onCollapse?: () => void
  floating?: boolean
}) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement | null>(null)
  const prevCount = useRef(tags.length)

  // Live arrival: when the bridge adds tags to an image already on screen, the
  // strip flashes its accent once so the change is noticed without motion.
  useEffect(() => {
    const grew = tags.length > prevCount.current
    prevCount.current = tags.length
    if (!grew || !ref.current) return
    const el = ref.current
    const frames = reduced
      ? [{ opacity: 0.55 }, { opacity: 1 }]
      : [{ transform: 'translateY(2px)', opacity: 0.4 }, { transform: 'translateY(0)', opacity: 1 }]
    el.animate(frames, { duration: 220, easing: 'ease-out', fill: 'none' })
  }, [tags.length, reduced])

  const shown = max === undefined ? tags : tags.slice(0, max)
  const rest = tags.length - shown.length

  return (
    <div
      ref={ref}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 3,
        alignItems: 'center',
        marginTop: floating ? 0 : 4,
        maxWidth: floating ? 320 : '100%',
        ...(floating
          ? {
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 6,
              padding: 6,
              borderRadius: 8,
              background: 'var(--cpd-color-bg-canvas-default)',
              border: '1px solid var(--mod-line))',
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              zIndex: 40,
            }
          : {}),
      }}
    >
      {meta?.rating && <RatingBadge rating={meta.rating} by={meta.updatedBy} />}

      {shown.map((t) => (
        <button
          key={t.category + ':' + t.name}
          type="button"
          onClick={onTagClick ? () => onTagClick(t) : undefined}
          title={t.score !== undefined ? `${t.category} · ${Math.round(t.score * 100)}%` : t.category}
          style={{
            font: 'inherit',
            fontSize: 11,
            lineHeight: 1.4,
            padding: '1px 6px',
            borderRadius: 999,
            border: `1px solid color-mix(in srgb, ${CATEGORY_TOKEN[t.category]} 33%, transparent)`,
            background: `color-mix(in srgb, ${CATEGORY_TOKEN[t.category]} 12%, transparent)`,
            color: CATEGORY_TOKEN[t.category],
            cursor: onTagClick ? 'pointer' : 'default',
            whiteSpace: 'nowrap',
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {t.name}
        </button>
      ))}

      {rest > 0 && (
        <button type="button" onClick={onMore} style={ghostBtn} title="Show all tags">
          +{rest} more
        </button>
      )}

      {source ? (
        <a
          href={source}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...ghostBtn, textDecoration: 'none' }}
          title={source}
        >
          {'↗'} source
        </a>
      ) : (
        // No source URL in the payload -- surface the booru post id instead. It
        // becomes a real link the moment a source base URL is configured.
        meta?.postId !== undefined && (
          <span style={{ ...ghostBtn, cursor: 'default' }} title={`Post #${meta.postId}`}>
            #{meta.postId}
          </span>
        )
      )}

      {onCollapse && (
        <button type="button" onClick={onCollapse} style={ghostBtn} title="Hide tags for this image">
          {'×'}
        </button>
      )}
    </div>
  )
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

// The count badge used on small surfaces. Positioned by its container.
function TagChip({
  count,
  expanded,
  onToggle,
  children,
}: {
  count: number
  expanded: boolean
  onToggle: () => void
  children?: React.ReactNode
}) {
  return (
    <div style={{ position: 'absolute', left: 4, bottom: 4, zIndex: 6 }}>
      {children}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title={`${count} tag${count === 1 ? '' : 's'}`}
        style={{
          font: 'inherit',
          fontSize: 10,
          lineHeight: 1.3,
          padding: '1px 5px',
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.25)',
          background: expanded ? 'var(--cpd-color-bg-action-primary-rest)' : 'rgba(0,0,0,0.62)',
          color: 'var(--cpd-color-text-on-solid-primary)',
          cursor: 'pointer',
          pointerEvents: 'auto',
          backdropFilter: 'blur(2px)',
        }}
      >
        {'\u{1F3F7}'} {count}
      </button>
    </div>
  )
}

const ghostBtn: React.CSSProperties = {
  font: 'inherit',
  fontSize: 11,
  lineHeight: 1.4,
  padding: '1px 6px',
  borderRadius: 999,
  border: '1px solid rgba(128,128,128,0.35)',
  background: 'transparent',
  color: 'var(--cpd-color-text-secondary)',
  cursor: 'pointer',
}
