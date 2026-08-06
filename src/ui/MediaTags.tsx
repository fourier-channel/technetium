import { useEffect, useRef, useState } from 'react'
import { parseMxc } from '../client/media'
import { useMediaTags } from '../client/useMediaTags'
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

// Category -> accent. Compound tokens where one fits; the booru buckets have no
// semantic token of their own, so these are explicit and theme-neutral (they
// read on both grounds).
const CATEGORY_COLOR: Record<TagCategory, string> = {
  artist: '#c2410c',
  character: '#15803d',
  copyright: '#7e22ce',
  meta: '#64748b',
  general: '#0369a1',
}

const CATEGORY_COLOR_DARK: Record<TagCategory, string> = {
  artist: '#fb923c',
  character: '#4ade80',
  copyright: '#c084fc',
  meta: '#94a3b8',
  general: '#38bdf8',
}

function useCategoryColors(): Record<TagCategory, string> {
  const [dark, setDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!m) return
    const on = () => setDark(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return dark ? CATEGORY_COLOR_DARK : CATEGORY_COLOR
}

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
  if (!set || set.tags.length === 0) return null

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
    <TagList
      tags={tags}
      max={showAll ? undefined : max}
      onMore={() => setShowAll(true)}
      onTagClick={onTagClick}
      source={set.source}
      meta={meta}
      onCollapse={() => prefs.setOverride(mediaId ?? '', 'hide')}
    />
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
  const colors = useCategoryColors()
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
              border: '1px solid var(--cpd-color-gray-400, rgba(128,128,128,0.35))',
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
            border: `1px solid ${colors[t.category]}55`,
            background: `${colors[t.category]}1f`,
            color: colors[t.category],
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
          color: '#fff',
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
