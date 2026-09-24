import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { axisFromKey, isTypingTarget, HORIZONTAL } from './axisKeys'
import { useClient } from '../client/clientContextValue'
import { useFlipList, flipIdOf } from './flip'
import { usePopOnIncrease } from './pop'
import { useReducedMotion } from './reducedMotion'
import {
  stepFocus,
  trackOffset,
  visualDistance,
  wheelStep,
  WHEEL_IDLE,
  type WheelState,
} from './carousel'
import { formatCardWhen, formatDuration, isRecent } from './threadCardFormat'
import { useNow } from './useNow'
import { useDeferredThreadOrder } from './threadOrder'
import { arrangePinned, partitionPinned } from './threadPins'
import { usePinnedFold } from '../client/pinnedFold'
import { THREAD_CARD_H, THREAD_HEAD_H, THREAD_TRACK_PAD_TOP } from './threadStrip'
import {
  canPinThreads,
  threadPinsOf,
  toggleThreadPin,
  useThreadPinsVersion,
} from '../client/threadPinState'
import { PushpinIcon } from './PushpinIcon'
import type { MatrixClient } from 'matrix-js-sdk'
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

// The pinned threads of every room in the list, as flip ids, in the order they
// lead it: the current room's first, then each other room's as the list first
// meets it. Pure over its inputs, so the handler that pins can ask where a
// card will land by calling it again.
function pinnedFlipIds(
  client: MatrixClient | null,
  roomId: string | undefined,
  items: readonly ThreadListItem[],
): string[] {
  const rooms: string[] = []
  if (roomId) rooms.push(roomId)
  for (const it of items) if (!rooms.includes(it.roomId)) rooms.push(it.roomId)
  const out: string[] = []
  for (const r of rooms) for (const root of threadPinsOf(client, r)) out.push(flipIdOf(r, root))
  return out
}

// Thread inbox strip. Scoped to the current room by default (user-changeable
// default eventually via account-data prefs); toggleable to all joined rooms.
// Tiles carry an inline stat cluster (posts / media / posters) whose hover (or
// tap, on touch) reveals the per-user breakdown.
// The card is a fixed size so the geometry is arithmetic rather than
// measurement: every card the same width means the focused one can be centred
// without reading the DOM for each.
const CAROUSEL_CARD_W = 348
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
  const [sort, setSort] = useState<ThreadSort>(defaults.sort)
  const dataEntries = useThreadList(client, { roomId, scope, sort })

  // D3 auto-resort etiquette: while the pointer is over the list (or scrolling),
  // hold the on-screen order; adopt the live data order on idle. Stats/pops
  // still update in place during the hold -- only POSITION is deferred.
  const { entries: frozenEntries, handlers, release } = useDeferredThreadOrder(dataEntries)

  const ordered = frozenEntries

  // Pinned threads are the ROOM's, set by whoever its power levels allow
  // (client/threadPinState.ts), and they go first whatever the sort, so they
  // are applied LAST (threadPins.ts says why). Every consumer below -- the
  // FLIP key, the focus, the keyboard, the render -- reads `entries`, so they
  // all agree on where a pinned card is without knowing pins exist.
  const pinsVersion = useThreadPinsVersion(client)
  const pinned = useMemo(
    () => pinnedFlipIds(client, roomId, ordered),
    // pinsVersion is what moves when any room's pins change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, roomId, ordered, pinsVersion],
  )
  // Pinned threads this person folded away behind the pushpin are out of the
  // track altogether; the rest lead it.
  const { folded, fold, unfold } = usePinnedFold(client)
  const pinParts = partitionPinned(pinned, folded)
  const entries = arrangePinned(ordered, pinned, folded)
  const pinnedIds = new Set(pinned)
  const myUserId = client?.getUserId() ?? null

  // The order as of the last render, for the pin handler to read at click
  // time: closing over it would hand every card a new function on every render
  // (threadTileEqual compares them).
  const orderRef = useRef({ ordered, roomId, folded })
  useEffect(() => {
    orderRef.current = { ordered, roomId, folded }
  })

  // Choosing a scope or a sort is a deliberate act, so the hover freeze is
  // dropped and the new order shows at once rather than after the idle timer.
  const handleScope = (next: ThreadScope) => {
    release()
    setScope(next)
  }
  const handleSort = (next: ThreadSort) => {
    release()
    setSort(next)
  }

  // FLIP: any change to the ordered id list (sort switch, scope switch, an
  // idle-released activity resort, a pin) shuffles the surviving cards
  // through one animation.
  //
  // DRAG-TO-REORDER IS GONE (operator, 2026-09-24: "we can drop that
  // functionality now"). The drag was one-dimensional and vertical inside a
  // horizontal strip, so any press with 5px of vertical wobble threw a card to
  // an end and switched the list to a custom order; pins now cover "keep this
  // one first". threadDrag.ts stays for the room list, which still uses it.
  const listRef = useRef<HTMLDivElement>(null)
  const orderKey = entries.map((e) => flipIdOf(e.roomId, e.rootId)).join(',')
  useFlipList(listRef, orderKey)
  const handleSelect = onSelect

  // --- carousel state ------------------------------------------------------
  // One number: which card is under the reader. Everything else -- the track's
  // position, each card's scale, what Enter opens -- is derived from it, so
  // there is no second place for "where are we" to disagree with itself.
  const [focus, setFocus] = useState(0)
  // One clock for the whole list rather than a Date.now() inside each card:
  // reading the time during render is impure (the compiler rule), and a timer
  // per card would be dozens of them firing to say the same thing.
  const now = useNow()
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

  // Opening a thread brings its card to the reader once -- and ONLY once.
  //
  // This used to depend on `focus`, which made it a leash: scroll away from the
  // thread you are reading and the effect saw focus drift, decided the active
  // card was not centred, and hauled it straight back. Opening a thread
  // therefore froze the carousel on it. Recording which thread we have already
  // centred for makes the pull a one-off, so browsing stays free while the
  // thread you are reading stays open.
  const centredFor = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!carousel || !activeRootId) return
    if (centredFor.current === activeRootId) return
    const i = entries.findIndex((e) => e.rootId === activeRootId)
    if (i < 0) return
    // Written in an effect, never in render -- the rule is about render (G-tc01).
    centredFor.current = activeRootId
    queueMicrotask(() => setFocus(i))
  }, [carousel, activeRootId, entries])

  const offset = trackOffset(focus, {
    cardWidth: CAROUSEL_CARD_W,
    gap: CAROUSEL_GAP,
    viewportWidth: viewportW,
    count,
  })

  const step = useCallback((delta: number) => {
    setFocus((f) => stepFocus(f, delta, count))
  }, [count])

  // Wheel steps rather than scrolls, one card per notch. The rule is wheelStep
  // in carousel.ts, where the check suite can hold it; this only feeds it.
  const wheelState = useRef<WheelState>(WHEEL_IDLE)
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!carousel) return
    const r = wheelStep(wheelState.current, {
      dx: e.deltaX,
      dy: e.deltaY,
      mode: e.deltaMode,
      t: e.timeStamp,
    })
    wheelState.current = r.state
    if (r.step) step(r.step)
  }, [carousel, step])

  // Not memoized: it goes on a DOM element, so a stable identity buys nothing,
  // and the compiler could not preserve the manual memo anyway.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!carousel || count === 0) return
    // formant grammar: the guard against typing, and preventDefault on the
    // vertical only, are the parts every surface got wrong differently. This
    // list has no vertical axis -- a thread list is one sequence -- so up and
    // down are left alone to scroll the page, which is what a reader expects
    // of a list taller than the window.
    //
    // A move made from a control inside the strip (a pill or a Pin a click
    // left focused) hands focus back to the strip, so the Enter that follows
    // opens the card now under the reader instead of pressing that control
    // again -- which, on a Pin, unpinned the card the reader had just pinned.
    const strip = e.currentTarget as HTMLElement
    const reclaim = () => {
      if (e.target !== strip) strip.focus({ preventScroll: true })
    }
    const axis = axisFromKey(e, HORIZONTAL)
    if (axis === 'next') { step(1); reclaim(); return }
    if (axis === 'prev') { step(-1); reclaim(); return }
    if (isTypingTarget(e.target)) return
    if (e.key === 'Home') { e.preventDefault(); setFocus(0); reclaim(); return }
    if (e.key === 'End') { e.preventDefault(); setFocus(count - 1); reclaim(); return }
    // A control inside the strip answers its own Enter and Space. Without this
    // the strip opened the focused thread instead of pressing the button the
    // reader was on.
    if (e.target !== strip && (e.target as HTMLElement | null)?.closest?.('button, a')) return
    if (e.key === 'Enter' || e.key === ' ') {
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

  const onCardFocus = useCallback((i: number) => setFocus(i), [])

  // Pin or unpin -- for everyone in the room -- and bring the card to the
  // reader wherever it lands: the results come to you, and a card leaving from
  // under the pointer for the far end of the strip would read as the card
  // vanishing. Stable: it reads orderRef rather than closing over the order.
  //
  const onTogglePin = useCallback(
    (rid: string, rootId: string) => {
      if (!client) return
      // The store updates optimistically and synchronously, so the list it
      // will render next can be asked for here, the same way render asks.
      toggleThreadPin(client, rid, rootId)
      const cur = orderRef.current
      const id = flipIdOf(rid, rootId)
      const landed = arrangePinned(cur.ordered, pinnedFlipIds(client, cur.roomId, cur.ordered), cur.folded).findIndex(
        (e) => flipIdOf(e.roomId, e.rootId) === id,
      )
      if (carousel && landed >= 0) setFocus(landed)
    },
    [client, carousel],
  )

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
      {/* The title bar (launch-polish L3): the label centred, the scope to its
          left, the sort to its right. The column layout keeps the same parts
          in a wrapping row; only the strip has the room for three columns. */}
      <div
        className={carousel ? 'tc-carousel-head tc-panel-head' : 'tc-panel-head'}
        style={
          carousel
            ? undefined
            : { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '10px 12px 6px' }
        }
      >
        <div className="tc-threadlist-side" data-side="left">
          <span className="tc-threadlist-caption">Show Threads:</span>
          {roomId && (
            <button
              type="button"
              className="tc-threadlist-pill"
              aria-pressed={scope === 'room'}
              onClick={() => handleScope('room')}
            >
              Here
            </button>
          )}
          <button
            type="button"
            className="tc-threadlist-pill"
            aria-pressed={scope === 'all'}
            onClick={() => handleScope('all')}
          >
            Everywhere
          </button>
        </div>
        <div className="tc-threadlist-title">Thread Listing</div>
        <div className="tc-threadlist-side" data-side="right">
          <span className="tc-threadlist-caption">Sort By:</span>
          <select
            className="tc-threadlist-pill tc-threadlist-sort"
            aria-label="Sort threads by"
            value={sort}
            onChange={(e) => handleSort(e.target.value as ThreadSort)}
          >
            <option value="latest-activity">Latest</option>
            <option value="created">Created</option>
            <option value="reply-count">Replies</option>
          </select>
          {/* Present only where the host has no other way to dismiss the list.
              The strip has its tab, so it never passes one. */}
          {onClose && (
            <button
              type="button"
              className="tc-threadlist-close"
              onClick={onClose}
              title="Hide threads"
              aria-label="Hide threads"
            >
              {'\u00D7'}
            </button>
          )}
        </div>
      </div>
      {/* The pushpin at the strip's left end: pinned threads are out by
          default, and this folds them away (and they stop pulling the strip
          down) or brings them back, with the count it is holding. Centred on
          the card row from the strip's own numbers. */}
      {carousel && pinned.length > 0 && (
        <button
          type="button"
          className="tc-pinfold"
          aria-pressed={pinParts.visible.length > 0}
          style={{ top: THREAD_HEAD_H + THREAD_TRACK_PAD_TOP + THREAD_CARD_H / 2 }}
          title={
            pinParts.visible.length > 0
              ? `Fold away ${pinParts.visible.length === 1 ? 'the pinned thread' : `the ${pinParts.visible.length} pinned threads`}: they wait behind this pin and stop opening the strip`
              : `Show ${pinParts.folded.length === 1 ? 'the pinned thread' : `the ${pinParts.folded.length} pinned threads`}`
          }
          onClick={() => (pinParts.visible.length > 0 ? fold(pinParts.visible) : unfold(pinParts.folded))}
        >
          <PushpinIcon size={13} />
          {pinParts.folded.length > 0 && <span className="tc-pinfold-n">{pinParts.folded.length}</span>}
        </button>
      )}
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
              pinned={pinnedIds.has(flipIdOf(e.roomId, e.rootId))}
              canPin={canPinThreads(client?.getRoom(e.roomId), myUserId)}
              onTogglePin={onTogglePin}
              onCardFocus={onCardFocus}
              onSelect={onCardSelect}
              index={i}
              now={now}
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
    a.pinned !== b.pinned ||
    a.canPin !== b.canPin ||
    a.onTogglePin !== b.onTogglePin ||
    a.onCardFocus !== b.onCardFocus ||
    a.onSelect !== b.onSelect ||
    a.carousel !== b.carousel ||
    a.distance !== b.distance ||
    a.index !== b.index ||
    a.now !== b.now
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

interface ThreadTileProps {
  item: ThreadListItem
  active: boolean
  showRoom: boolean
  // Pinned by the room: first whatever the sort (launch-polish L4).
  pinned: boolean
  // May this viewer pin in the card's room? Everyone sees that a thread is
  // pinned; only those the room's power levels allow get the control.
  canPin: boolean
  onTogglePin: (roomId: string, rootId: string) => void
  // A control inside the card took focus: bring the card to the reader.
  onCardFocus: (index: number) => void
  onSelect: (roomId: string, rootId: string, index: number) => void
  index: number
  /** Ticking wall clock, passed in because a component may not read one. */
  now: number
  carousel: boolean
  // How far from the reader's position, capped. Drives the fade and shrink, so
  // the card under the eyes is unmistakably the one in play.
  distance: number
}

const ThreadTile = memo(function ThreadTile({
  item,
  active,
  showRoom,
  pinned,
  canPin,
  onTogglePin,
  onCardFocus,
  onSelect,
  index,
  now,
  carousel,
  distance,
}: ThreadTileProps) {
  const { thread, roomName, roomId, rootId, lastTs, createdTs, author } = item
  // The list carries the sender's MXID, which is what the event has. A card is
  // read at a glance, and "@saber:41chan.net" is the same person's name with
  // routing information stapled to it.
  const { client: tileClient } = useClient()
  const authorName = tileClient?.getRoom(roomId)?.getMember(author)?.name || author
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
      className={carousel ? 'tc-carousel-card' : undefined}
      data-distance={carousel ? distance : undefined}
      data-pinned={pinned ? 'true' : undefined}
      // Tabbing onto a card's control brings the card to the middle, the way
      // an arrow key would: the results come to the reader, and a focused
      // control out past the strip's edge is one nobody can see.
      onFocus={carousel ? () => onCardFocus(index) : undefined}
      // Being READ and being under the reader's eyes are different things now
      // that the carousel is free to scroll away from the open thread. The card
      // has to say which one is open on its own, at any distance.
      data-active={carousel && active ? 'true' : undefined}
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
          {active && <span className="tc-tcard-reading">reading</span>}
          <div className="tc-tcard-top">
            <div className="tc-tcard-cover" data-nocover={isImage ? undefined : 'true'}>
              {isImage ? (
                <>
                  <AuthedImage mxc={mxc} width={180} roomId={roomId} fill transparentLoading alt={preview} />
                  <MediaTags mxc={mxc} roomId={roomId} variant="chip" />
                </>
              ) : (
                'no\nimage'
              )}
            </div>

            <div className="tc-tcard-main">
              {/* Room and the thread's start date share a line; the subject gets
                  the next one to itself, clamped to ONE. Two lines where there
                  were three, which is the height that made the card fit. */}
              <div className="tc-tcard-idrow">
                <span className="tc-tcard-room">{roomName}</span>
                <span className="tc-tcard-date">{formatCardWhen(createdTs)}</span>
              </div>
              <div
                className={'tc-tcard-title' + (isImage ? ' untitled' : '')}
                title={preview}
              >
                {preview}
              </div>

              {/* FIRST and LAST on one line in fixed columns, so the two
                  absolute times sit at the same x on every card in the strip --
                  which is the only property that makes a row of them
                  comparable. Matrix gives exactly these two instants. */}
              <div className="tc-tcard-times">
                <div className="tc-tcard-tcol">
                  <span>first</span>
                  <b>{formatCardWhen(createdTs)}</b>
                </div>
                <div className="tc-tcard-tcol">
                  <span>last</span>
                  <b>{formatCardWhen(lastTs)}</b>
                </div>
              </div>

              <div className="tc-tcard-meters">
                <StatCluster item={item} />
              </div>
            </div>

            {/* Is this thread still happening, and for how long has it been
                quiet -- one column, because they are one question. The bar the
                sampling card puts here is capture completion, which a live
                thread cannot have, so it is deliberately absent. */}
            <div
              className="tc-tcard-life"
              data-live={isRecent(lastTs, now) ? 'true' : 'false'}
              title="Since the last post"
            >
              <span className="tc-tcard-pulse" aria-hidden="true" />
              <b>{formatDuration(now - lastTs)}</b>
            </div>
          </div>

          <div className="tc-tcard-foot">
            <span className="tc-tcard-chip tc-tcard-chip-author">{authorName}</span>
            {/* The pin: a control for whoever may pin in this room, a plain
                mark for everyone else. Its click stops here so the card's own
                focus-or-open does not also fire. */}
            {canPin ? (
              <button
                type="button"
                className="tc-tcard-pin"
                aria-pressed={pinned}
                title={
                  pinned
                    ? `Unpin for everyone in ${roomName}: it sorts with the rest again`
                    : `Pin for everyone in ${roomName}: first in the list, whatever the sort`
                }
                onClick={(ev) => {
                  ev.stopPropagation()
                  onTogglePin(roomId, rootId)
                }}
              >
                <PushpinIcon />
                {pinned ? 'Pinned' : 'Pin'}
              </button>
            ) : (
              pinned && (
                <span className="tc-tcard-pin is-mark" title={`Pinned by the moderators of ${roomName}`}>
                  <PushpinIcon />
                  Pinned
                </span>
              )
            )}
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
            <MediaTags mxc={mxc} roomId={roomId} variant="chip" />
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
      className="tc-stat"
      style={{ position: 'relative', display: 'inline-flex', gap: 8, minWidth: 0 }}
    >
      <span style={{ fontSize: 10, color: 'var(--cpd-color-text-secondary)', whiteSpace: 'nowrap' }}>
        {/* Zeroes are dropped rather than shown. "0 media" is not information
            anybody wanted; it is three characters of noise crowding the two
            counts that do say something. */}
        {[
          [`\u{1F4AC}`, item.postCount] as const,
          [`\u{1F4CE}`, item.mediaCount] as const,
          [`\u{1F464}`, item.posterCount] as const,
        ]
          .filter(([, n]) => n > 0)
          .map(([icon, n]) => `${icon} ${n}`)
          .join('  \u00B7  ')}
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
