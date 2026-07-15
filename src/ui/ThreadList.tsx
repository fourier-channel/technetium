import { memo, useCallback, useRef, useState } from 'react'
import { useClient } from '../client/ClientContext'
import { useFlipList, flipIdOf, type FlipControl } from './flip'
import { usePopOnIncrease } from './pop'
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
export function ThreadList({
  onSelect,
  activeRootId,
  roomId,
  width = 190,
}: {
  onSelect: (roomId: string, rootId: string) => void
  activeRootId?: string
  roomId?: string
  width?: number
}) {
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
      style={{
        width,
        flexShrink: 0,
        borderLeft: '1px solid rgba(128,128,128,0.25)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <div
        style={{
          padding: '10px 12px 6px',
          borderBottom: '1px solid rgba(128,128,128,0.25)',
          flexShrink: 0,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Threads</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingBottom: 6 }}>
          {roomId && (
            <button type="button" style={chip(scope === 'room')} onClick={() => handleScope('room')}>
              This room
            </button>
          )}
          <button type="button" style={chip(scope === 'all')} onClick={() => handleScope('all')}>
            All rooms
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
        </div>
      </div>
      <div ref={listRef} {...handlers} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {entries.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, opacity: 0.6 }}>No threads yet.</div>
        ) : (
          entries.map((e) => (
            <ThreadTile
              key={e.roomId + e.rootId}
              item={e}
              active={e.rootId === activeRootId}
              showRoom={scope === 'all'}
              isNew={newIds.has(flipIdOf(e.roomId, e.rootId))}
              onSelect={handleSelect}
              getCardHandlers={getCardHandlers}
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
    a.getCardHandlers !== b.getCardHandlers
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
  onSelect: (roomId: string, rootId: string) => void
  getCardHandlers: (id: string) => CardHandlers
}

const ThreadTile = memo(function ThreadTile({
  item,
  active,
  showRoom,
  isNew,
  onSelect,
  getCardHandlers,
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
      style={{
        borderBottom: '1px solid rgba(128,128,128,0.15)',
        background: active ? 'var(--cpd-color-bg-subtle-secondary)' : 'transparent',
      }}
    >
      <div
        ref={popRef}
        onClick={() => onSelect(roomId, rootId)}
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
          <AuthedImage mxc={mxc} width={180} maxHeight={90} alt={preview} />
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
