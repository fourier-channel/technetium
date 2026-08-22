import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientContext'
import { useFlipList, flipIdOf, type FlipControl } from './flip'
import { usePopOnIncrease } from './pop'
import { useReducedMotion } from './reducedMotion'
import { stepFocus, trackOffset, visualDistance } from './carousel'
import { useDeferredThreadOrder, arrangeByCustom } from './threadOrder'
import { useThreadDrag } from './threadDrag'
import { orderScopeKey, loadCustomOrder, saveCustomOrder } from './threadOrderStore'
import {
  useThreadList,
  threadListDefaults,
  type ThreadListItem,
  type ThreadScope,
  type ThreadSort,
} from '../client/useThreadList'
import { AuthedImage } from './AuthedImage'
import { MediaTags } from './MediaTags'
import { parseMxc } from '../client/media'

// UI-level order mode: the three data sorts plus a user-arranged 'custom' order.
// 'custom' is a presentation concern (persisted order + new-thread placement),
// so it lives here, not in useThreadList's data-sort union.
type SortMode = ThreadSort | 'custom'

// Stable empty set so non-custom renders don't churn the memoized tiles.
const EMPTY_NEW_IDS: ReadonlySet<string> = new Set()

// Thread inbox strip. Scoped to the current room by default (user-changeable
// default eventually via account-data prefs); toggleable to all joined rooms.
// Tiles carry an inline stat cluster (posts / media / posters) whose hover (or
// tap, on touch) reveals the per-user breakdown.
// The card is a fixed size so the geometry is arithmetic rather than
// measurement: every card the same width means the focused one can be centred
// without reading the DOM for each.
const CAROUSEL_CARD_W = 288
const CAROUSEL_GAP = 12

export function ThreadList({
  onSelect,
  activeRootId,
  roomId,
  width = 190,
  layout = 'column',
  onClose,
}: {
  onSelect: (roomId: string, rootId: string) => void
  activeRootId?: string
  roomId?: string
  width?: number
  // 'carousel' is the horizontal strip: one card under the reader's eyes and
  // the track sliding to put it there. 'column' is the original side list.
  layout?: 'column' | 'carousel'
  // Present when the surface hosting this list has no other way to dismiss it.
  onClose?: () => void
}) {
  const carousel = layout === 'carousel'
  const { client } = useClient()
  const defaults = threadListDefaults()
  const initialScope: ThreadScope = roomId ? defaults.scope : 'all'
  const [scope, setScope] = useState<ThreadScope>(initialScope)
  // Custom (drag-arranged) order as an ordered list of flip ids. Lazily loaded
  // from localStorage for the initial scope so a reload restores the arrangement
  // (O2: per-scope; D5: persisted order).
  const [customOrder, setCustomOrder] = useState<string[] | null>(() =>
    loadCustomOrder(orderScopeKey(initialScope, roomId)),
  )
  // If a saved custom order exists at mount, open in custom mode (order survives
  // reload); otherwise the default sort.
  const [sort, setSort] = useState<SortMode>(() =>
    loadCustomOrder(orderScopeKey(initialScope, roomId)) ? 'custom' : defaults.sort,
  )
  // 'custom' isn't a data sort; feed useThreadList a stable base order under it.
  const baseSort: ThreadSort = sort === 'custom' ? 'latest-activity' : sort
  const dataEntries = useThreadList(client, { roomId, scope, sort: baseSort })

  // D3 auto-resort etiquette: while the pointer is over the list (or scrolling),
  // hold the on-screen order; adopt the live data order on idle. Stats/pops
  // still update in place during the hold -- only POSITION is deferred.
  const { entries: frozenEntries, handlers } = useDeferredThreadOrder(dataEntries)

  // In custom mode the user's arrangement wins (auto-resort/freeze is moot);
  // otherwise the sort+freeze pipeline drives order. New (unsaved) threads sort
  // to the top and are marked "new" (O3).
  const isCustom = sort === 'custom' && customOrder !== null
  const arranged = isCustom ? arrangeByCustom(dataEntries, customOrder) : null
  const entries = arranged ? arranged.items : frozenEntries
  const newIds = arranged ? arranged.newIds : EMPTY_NEW_IDS

  // Switching scope loads that scope's saved order (O2). If the new scope has no
  // saved custom order while in custom mode, fall back to the default sort.
  const handleScope = (next: ThreadScope) => {
    setScope(next)
    const loaded = loadCustomOrder(orderScopeKey(next, roomId))
    setCustomOrder(loaded)
    if (sort === 'custom' && !loaded) setSort(defaults.sort)
  }

  // FLIP: any change to the ordered id list (sort switch, scope switch, an
  // idle-released activity resort, or a drag commit) shuffles the surviving
  // cards through one animation. The drag layer suppresses FLIP for its own
  // gesture via flipControlRef.
  const listRef = useRef<HTMLDivElement>(null)
  const flipControlRef = useRef<FlipControl | null>(null)
  const orderKey = entries.map((e) => flipIdOf(e.roomId, e.rootId)).join(',')
  useFlipList(listRef, orderKey, flipControlRef)

  // Drag-to-reorder (D4). Committing an order switches the list to custom mode
  // (O1) and persists it for the current scope (O2).
  const onReorder = useCallback(
    (finalIds: string[]) => {
      setCustomOrder(finalIds)
      setSort('custom')
      saveCustomOrder(orderScopeKey(scope, roomId), finalIds)
    },
    [scope, roomId],
  )
  const orderedIds = entries.map((e) => flipIdOf(e.roomId, e.rootId))
  const { getCardHandlers, consumeClickSuppressed } = useThreadDrag({
    containerRef: listRef,
    orderedIds,
    onReorder,
    flipControlRef,
  })

  // A click that concludes an engaged drag must not also open the thread.
  const handleSelect = useCallback(
    (rid: string, rootId: string) => {
      if (consumeClickSuppressed(flipIdOf(rid, rootId))) return
      onSelect(rid, rootId)
    },
    [consumeClickSuppressed, onSelect],
  )

  // --- carousel state ------------------------------------------------------
  // One number: which card is under the reader. Everything else -- the track's
  // position, each card's scale, what Enter opens -- is derived from it, so
  // there is no second place for "where are we" to disagree with itself.
  const [focus, setFocus] = useState(0)
  const [viewportW, setViewportW] = useState(0)
  const stripRef = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!carousel) return
    const el = stripRef.current
    if (!el) return
    // Measured, not assumed: the strip spans whatever the chat is wide, and
    // centring against a guessed width puts every card slightly off.
    const measure = () => setViewportW(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [carousel])

  const count = entries.length

  // A focus left over from a longer list would point past the end. Clamped
  // here rather than only in trackOffset, so the keyboard agrees with the view.
  useEffect(() => {
    if (focus <= Math.max(0, count - 1)) return
    queueMicrotask(() => setFocus(Math.max(0, count - 1)))
  }, [count, focus])

  // Opening a thread from anywhere else brings its card to the reader, which is
  // the whole premise: the results come to you.
  useEffect(() => {
    if (!carousel || !activeRootId) return
    const i = entries.findIndex((e) => e.rootId === activeRootId)
    if (i < 0 || i === focus) return
    queueMicrotask(() => setFocus(i))
  }, [carousel, activeRootId, entries, focus])

  const offset = trackOffset(focus, {
    cardWidth: CAROUSEL_CARD_W,
    gap: CAROUSEL_GAP,
    viewportWidth: viewportW,
    count,
  })

  const step = useCallback((delta: number) => {
    setFocus((f) => stepFocus(f, delta, count))
  }, [count])

  // Wheel steps rather than scrolls. A trackpad emits a stream of small deltas,
  // so they are accumulated to a threshold and then spent -- otherwise one
  // flick crosses the entire list and the reader has no idea where they are.
  const wheelAcc = useRef(0)
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!carousel) return
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    wheelAcc.current += d
    const THRESHOLD = 40
    while (Math.abs(wheelAcc.current) >= THRESHOLD) {
      const dir = wheelAcc.current > 0 ? 1 : -1
      wheelAcc.current -= dir * THRESHOLD
      step(dir)
    }
  }, [carousel, step])

  // Not memoized: it goes on a DOM element, so a stable identity buys nothing,
  // and the compiler could not preserve the manual memo anyway.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!carousel || count === 0) return
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
    else if (e.key === 'Home') { e.preventDefault(); setFocus(0) }
    else if (e.key === 'End') { e.preventDefault(); setFocus(count - 1) }
    else if (e.key === 'Enter' || e.key === ' ') {
      const e0 = entries[focus]
      if (e0) { e.preventDefault(); handleSelect(e0.roomId, e0.rootId) }
    }
  }

  // In the carousel, clicking a card that is NOT under the reader brings it
  // there rather than opening it -- the results come to you. Clicking the one
  // already there opens it. Enter always opens, because the keyboard has
  // already done the bringing.
  // The card reports its own index rather than being looked up here. Searching
  // `entries` would make this depend on an array the compiler cannot prove
  // stable, which costs the whole component its memoization -- and the card
  // already knows where it is.
  const onCardSelect = useCallback(
    (rid: string, rootId: string, index: number) => {
      if (carousel && index !== focus) {
        setFocus(index)
        return
      }
      handleSelect(rid, rootId)
    },
    [carousel, focus, handleSelect],
  )

  const chip = (active: boolean): React.CSSProperties => ({
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 10,
    border: '1px solid rgba(128,128,128,0.35)',
    background: active ? 'var(--cpd-color-bg-subtle-secondary)' : 'transparent',
    color: 'var(--cpd-color-text-primary)',
    cursor: 'pointer',
  })

  return (
    <aside
      ref={stripRef}
      className={carousel ? 'tc-carousel' : undefined}
      tabIndex={carousel ? 0 : undefined}
      onKeyDown={carousel ? onKeyDown : undefined}
      onWheel={carousel ? onWheel : undefined}
      style={
        carousel
          ? { display: 'flex', flexDirection: 'column', minWidth: 0 }
          : {
              width,
              flexShrink: 0,
              borderLeft: '1px solid rgba(128,128,128,0.25)',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
            }
      }
    >
      <div
        className={carousel ? 'tc-carousel-head' : undefined}
        style={{
          padding: '10px 12px 6px',
          borderBottom: '1px solid rgba(128,128,128,0.25)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: carousel ? 'nowrap' : 'wrap',
            fontWeight: 600,
            fontSize: 13,
            marginBottom: carousel ? 0 : 6,
          }}
        >
          <span style={{ flexShrink: 0 }}>Threads</span>
          {/* The scope chips ride on the title's line rather than below it.
              In the strip that is a whole row of height back, and the strip is
              short enough that a row is the difference between a card fitting
              and being clipped. */}
          {roomId && (
            <button type="button" style={chip(scope === 'room')} onClick={() => handleScope('room')}>
              Here
            </button>
          )}
          <button type="button" style={chip(scope === 'all')} onClick={() => handleScope('all')}>
            Everywhere
          </button>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            style={{
              fontSize: 11,
              background: 'transparent',
              color: 'var(--cpd-color-text-primary)',
              border: '1px solid rgba(128,128,128,0.35)',
              borderRadius: 10,
              padding: '2px 4px',
            }}
          >
            <option value="latest-activity">Latest</option>
            <option value="created">Created</option>
            <option value="reply-count">Replies</option>
            {/* Custom appears once the user has drag-arranged an order (O1). */}
            {customOrder !== null && <option value="custom">Custom</option>}
          </select>
          <span style={{ flex: 1 }} />
          {/* The strip covers the top of the timeline, and the timeline's own
              Threads toggle is up there under it -- so opening the strip hid
              the only way to close it. It carries its own. */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Hide threads"
              aria-label="Hide threads"
              style={{
                fontSize: 14,
                lineHeight: 1,
                padding: '2px 7px',
                borderRadius: 6,
                border: '1px solid rgba(128,128,128,0.35)',
                background: 'transparent',
                color: 'var(--cpd-color-text-primary)',
                cursor: 'pointer',
              }}
            >
              {'\u00D7'}
            </button>
          )}
        </div>
      </div>
      <div
        ref={listRef}
        {...handlers}
        className={carousel ? 'tc-carousel-track' : undefined}
        style={
          carousel
            ? {
                // The track slides; the reader does not. transform only, so
                // nothing here is a layout animation.
                transform: `translateX(${offset}px)`,
                transition: reduced
                  ? 'none'
                  : 'transform 420ms cubic-bezier(0.22, 0.61, 0.36, 1)',
              }
            : { flex: 1, overflowY: 'auto', minHeight: 0 }
        }
      >
        {entries.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, opacity: 0.6 }}>No threads yet.</div>
        ) : (
          entries.map((e, i) => (
            <ThreadTile
              key={e.roomId + e.rootId}
              item={e}
              active={e.rootId === activeRootId}
              showRoom={scope === 'all'}
              isNew={newIds.has(flipIdOf(e.roomId, e.rootId))}
              onSelect={onCardSelect}
              getCardHandlers={getCardHandlers}
              index={i}
              carousel={carousel}
              distance={carousel ? visualDistance(i, focus) : 0}
            />
          ))
        )}
      </div>
    </aside>
  )
}

// Field-level equality so a rebuild of the WHOLE item list (every ThreadEvent
// produces fresh item objects) re-renders only the cards whose rendered values
// actually changed. Without this the parent's new object refs would re-render
// every sibling on any thread's update.
function threadTileEqual(a: ThreadTileProps, b: ThreadTileProps): boolean {
  if (
    a.active !== b.active ||
    a.showRoom !== b.showRoom ||
    a.isNew !== b.isNew ||
    a.onSelect !== b.onSelect ||
    a.getCardHandlers !== b.getCardHandlers ||
    a.carousel !== b.carousel ||
    a.distance !== b.distance ||
    a.index !== b.index
  )
    return false
  const x = a.item
  const y = b.item
  return (
    x.roomId === y.roomId &&
    x.rootId === y.rootId &&
    x.roomName === y.roomName &&
    x.author === y.author &&
    x.createdTs === y.createdTs &&
    x.lastTs === y.lastTs &&
    x.replyCount === y.replyCount &&
    x.postCount === y.postCount &&
    x.mediaCount === y.mediaCount &&
    x.posterCount === y.posterCount &&
    x.favorite === y.favorite
  )
}

interface CardHandlers {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
}

interface ThreadTileProps {
  item: ThreadListItem
  active: boolean
  showRoom: boolean
  isNew: boolean
  onSelect: (roomId: string, rootId: string, index: number) => void
  getCardHandlers: (id: string) => CardHandlers
  index: number
  carousel: boolean
  // How far from the reader's position, capped. Drives the fade and shrink, so
  // the card under the eyes is unmistakably the one in play.
  distance: number
}

const ThreadTile = memo(function ThreadTile({
  item,
  active,
  showRoom,
  isNew,
  onSelect,
  getCardHandlers,
  index,
  carousel,
  distance,
}: ThreadTileProps) {
  const { thread, roomName, roomId, rootId, lastTs, createdTs, author } = item
  // Pop on last-activity increase, rate-limited, on the inner content element
  // so it never collides with the FLIP translate on the outer card.
  const popRef = useRef<HTMLDivElement>(null)
  usePopOnIncrease(popRef, lastTs)
  const root = thread.rootEvent
  const content = root?.getContent()
  const bodyRaw = typeof content?.body === 'string' ? content.body : ''
  const preview = bodyRaw.replace(/\s+/g, ' ').trim() || '(no preview)'
  const mxc = typeof content?.url === 'string' ? content.url : ''
  const isImage = content?.msgtype === 'm.image' && !!parseMxc(mxc)

  const fmt = (ts: number) =>
    ts
      ? new Date(ts).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : ''

  const ell = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const

  return (
    <div
      data-flip-id={flipIdOf(roomId, rootId)}
      {...getCardHandlers(flipIdOf(roomId, rootId))}
      className={carousel ? 'tc-carousel-card' : undefined}
      data-distance={carousel ? distance : undefined}
      style={
        carousel
          ? { background: active ? 'var(--cpd-color-bg-subtle-secondary)' : undefined }
          : {
              borderBottom: '1px solid rgba(128,128,128,0.15)',
              background: active ? 'var(--cpd-color-bg-subtle-secondary)' : 'transparent',
            }
      }
    >
      {carousel ? (
        // The card design from fourier-sampling's thread list: a square cover,
        // a small accent line naming where it came from, the subject in bold,
        // and a faint line of counts. Adapted rather than copied -- there is no
        // board or post number here, so the accent line is the ROOM, and the
        // counts are the pills this client already uses (posts, media, posters)
        // rather than the archive's present/missing, which has no meaning for a
        // Matrix thread that is never "complete".
        <div
          ref={popRef}
          onClick={() => onSelect(roomId, rootId, index)}
          className="tc-tcard"
        >
          <div className="tc-tcard-cover">
            {isImage ? (
              <>
                <AuthedImage mxc={mxc} width={180} roomId={roomId} fill transparentLoading alt={preview} />
                <MediaTags mxc={mxc} roomId={roomId} variant="chip" max={8} />
              </>
            ) : (
              // No picture: the opening glyph of the thread stands in, so the
              // cover column is never an empty hole.
              <span className="tc-tcard-cover-glyph" aria-hidden="true">
                {'\u{1F5E8}'}
              </span>
            )}
          </div>
          <div className="tc-tcard-body">
            <div className="tc-tcard-room">
              {isNew && <span className="tc-tcard-new">new</span>}
              {roomName}
            </div>
            <div className="tc-tcard-sub" title={preview}>{preview}</div>
            <div className="tc-tcard-cnt">
              <StatCluster item={item} />
            </div>
            <div className="tc-tcard-foot">
              <span className="tc-tcard-author">{author}</span>
              <span>{fmt(lastTs)}</span>
            </div>
          </div>
        </div>
      ) : (
      <div
        ref={popRef}
        onClick={() => onSelect(roomId, rootId, index)}
        style={{ padding: '8px 10px', cursor: 'pointer', color: 'var(--cpd-color-text-primary)' }}
      >
        {showRoom && (
          <div style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)', ...ell }}>{roomName}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          {isNew && (
            <span
              style={{
                flexShrink: 0,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.3,
                textTransform: 'uppercase',
                padding: '1px 5px',
                borderRadius: 8,
                color: 'var(--cpd-color-text-on-solid-primary)',
                background: 'var(--cpd-color-bg-action-primary-rest)',
              }}
            >
              new
            </span>
          )}
          <span style={{ fontSize: 12, fontWeight: 600, ...ell }}>{author}</span>
        </div>
        {/* Placeholder for a future thread title (not yet a feature). */}
        <div
          style={{
            fontSize: 11,
            fontStyle: 'italic',
            opacity: 0.45,
            color: 'var(--cpd-color-text-secondary)',
            ...ell,
          }}
        >
          (untitled)
        </div>
        <div style={{ fontSize: 10, color: 'var(--cpd-color-text-secondary)', ...ell }}>{fmt(createdTs)}</div>
        {isImage ? (
          // 180x90 preview: a strip would swamp the card (and fight the drag
          // reorder), so tags ride as a count chip that expands on click.
          <div style={{ position: 'relative' }}>
            <AuthedImage mxc={mxc} width={180} roomId={roomId} maxHeight={90} alt={preview} />
            <MediaTags mxc={mxc} roomId={roomId} variant="chip" max={8} />
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--cpd-color-text-secondary)', ...ell }}>{preview}</div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 6,
            marginTop: 2,
          }}
        >
          <StatCluster item={item} />
          <span style={{ fontSize: 10, color: 'var(--cpd-color-text-secondary)', flexShrink: 0 }}>
            {fmt(lastTs)}
          </span>
        </div>
      </div>
      )}
    </div>
  )
}, threadTileEqual)

// Inline stat cluster: posts / media posts / unique posters. Hovering (or, on
// touch, tapping) shows the per-user breakdown: "@user: 15(p) 10(m)".
function StatCluster({ item }: { item: ThreadListItem }) {
  const [show, setShow] = useState(false)
  return (
    <span
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => {
        // Tap-toggle for touch; stop the tile's open-thread click.
        e.stopPropagation()
        setShow((v) => !v)
      }}
      style={{ position: 'relative', display: 'inline-flex', gap: 8, minWidth: 0 }}
    >
      <span style={{ fontSize: 10, color: 'var(--cpd-color-text-secondary)', whiteSpace: 'nowrap' }}>
        {'\u{1F4AC}'} {item.postCount} {'\u00B7'} {'\u{1F4CE}'} {item.mediaCount} {'\u00B7'} {'\u{1F464}'} {item.posterCount}
      </span>
      {show && item.perUser.length > 0 && (
        <span
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: 4,
            zIndex: 20,
            background: 'var(--cpd-color-bg-canvas-default)',
            border: '1px solid rgba(128,128,128,0.35)',
            borderRadius: 6,
            padding: '6px 8px',
            fontSize: 11,
            color: 'var(--cpd-color-text-secondary)',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
          }}
        >
          {item.perUser.map((u) => (
            <span key={u.userId} style={{ display: 'block' }}>
              {u.userId}: {'\u{1F4AC}'}{u.posts} {'\u{1F4CE}'}{u.media}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}
