import { useEffect, useMemo, useRef, useState } from 'react'
import { ThreadEvent, type IContent, type Room, type MatrixEvent } from 'matrix-js-sdk'
import { useClient } from '../client/ClientContext'
import { useTimeline, type TimelineItem, type GalleryLayout } from '../client/useTimeline'
import type { ReplyRef } from '../client/relations'
import { eventPreview } from '../client/eventPreview'
import { renderMessageBody } from '../client/messageBody'
import { parseMxc } from '../client/media'
import { AuthedImage } from './AuthedImage'
import { AvatarPill } from './AvatarPill'
import { MemberEvent } from './MemberEvent'
import { useLightbox, type LightboxItem } from './Lightbox'
import { linkify } from './linkify'
import { useChatBackground } from './chatBackground'
import { ChatBackdrop, ChatBackgroundMenu } from './ChatBackground'
import { MediaTags } from './MediaTags'
import { useMediaTagPrefs } from './mediaTagSettings'
import { useMessageActions } from './messageActions'
import { MessageActionBar } from './MessageActionBar'
import { MessageVerbsProvider } from './MessageVerbs'
import { JumpContext, scrollToEventInDom, useJump, type JumpApi } from './jumpToEvent'
import { ReactionAdd, ReactionPills, ReactionRail } from './Reactions'
import { ReceiptCluster } from './ReceiptCluster'
import { SPOILER_ATTR, toggleSpoiler } from '../client/spoilers'
import { usePinnedEvents } from '../client/usePinnedEvents'
import { PinnedPanel } from './PinnedPanel'
import { SearchPanel } from './SearchPanel'
import { LinkPreview } from './LinkPreview'
import { firstLink } from '../client/urlPreview'
import { isPollStart } from '../client/polls'
import { PollBody } from './PollBody'
import { useLinkPreviewPref } from './linkPreviewPref'
import { RoomHeaderInfo } from './RoomHeaderInfo'
import { ProfileOpenerContext, useProfileOpener } from './profileOpener'
import { ProfileCard } from './ProfileCard'
import { ProfileActions } from './ProfileActions'
import { usePresence } from '../client/usePresence'
import { useRoomReceipts } from '../client/useReceipts'
import { ReceiptsContext, useReceipts } from './receiptsContext'
import { useChatInteractions } from '../client/useChatInteractions'
import { InteractionLayer } from './InteractionLayer'
import { InteractionMenu } from './InteractionMenu'
import { InteractionTargetContext, useInteractionTarget } from './interactionTarget'

// How many pages of history a click-to-jump will paginate before giving up.
const MAX_JUMP_PAGES = 8

// Stable empty array: a fresh [] per render would re-render every footer.
const EMPTY_SEEN: string[] = []

// Distance from the bottom, in px, within which the view counts as "at the
// bottom" for follow mode.
const FOLLOW_SLACK_PX = 120

// Pin the scroller to its true bottom, container padding included.
//
// Assigning scrollTop rather than scrollIntoView on a sentinel div, for two
// reasons: scrollIntoView aligns the SENTINEL's box, which leaves the
// container's bottom padding unscrolled and reads as "not quite at the
// bottom"; and it is allowed to scroll ancestor scrollers as well, which is
// never what a chat log wants. Module-level so it is not a new closure per
// render (which would churn the effects' dependency arrays).
function pinBottom(el: HTMLElement | null): void {
  if (el) el.scrollTop = el.scrollHeight
}

// The box an inline image will occupy, computed from the event's OWN info.w /
// info.h before anything is fetched, fitted to the inline thumbnail's limits.
//
// This is the other half of the follow-the-bottom fix, and the better half: a
// row whose height is known at first paint never shifts the timeline at all,
// so there is nothing for follow mode to chase. The scroll-intent logic above
// covers the images that arrive without dimensions.
const INLINE_IMAGE_MAX_W = 320
const INLINE_IMAGE_MAX_H = 320
function reserveBox(content: IContent): { width: number; height: number } | undefined {
  const info = content.info as { w?: unknown; h?: unknown } | undefined
  const w = info && typeof info.w === 'number' ? info.w : 0
  const h = info && typeof info.h === 'number' ? info.h : 0
  // Sender-supplied and therefore not to be trusted blindly: a missing,
  // zero or negative dimension means reserve nothing rather than reserve
  // nonsense.
  if (!(w > 0) || !(h > 0)) return undefined
  // Never upscale -- a small image keeps its own size, as it does today.
  const scale = Math.min(INLINE_IMAGE_MAX_W / w, INLINE_IMAGE_MAX_H / h, 1)
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

// Delegated spoiler handlers, shared by every row rather than allocated per
// row: they resolve their target from the event, so they need no closure.
function onSpoilerClick(e: React.MouseEvent) {
  const el = (e.target as Element | null)?.closest?.(`[${SPOILER_ATTR}]`)
  // A revealed spoiler must stay clickable as ordinary text -- a link inside
  // one should work once it is visible.
  if (el && !el.classList.contains('tc-spoiler-revealed')) {
    e.preventDefault()
    toggleSpoiler(el)
  }
}

function onSpoilerKey(e: React.KeyboardEvent) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  const el = (e.target as Element | null)?.closest?.(`[${SPOILER_ATTR}]`)
  if (el && !el.classList.contains('tc-spoiler-revealed')) {
    e.preventDefault()
    toggleSpoiler(el)
  }
}

// Read-only timeline. Message bodies render sanitized rich HTML (via DOMPurify)
// when present, else plaintext. Encrypted events show a placeholder until the
// crypto phase.
export function Timeline({ room, onOpenThread, threadListOpen, onToggleThreadList }: { room: Room; onOpenThread?: (roomId: string, rootId: string) => void; threadListOpen?: boolean; onToggleThreadList?: () => void }) {
  const { client } = useClient()
  const { items, loadOlder, loadingOlder, atStart } = useTimeline(client, room)
  const receipts = useRoomReceipts(client, room)
  const pins = usePinnedEvents(client, room)
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // W4.2 -- one card for the whole timeline, owned here so two rows cannot
  // each open their own.
  const [profile, setProfile] = useState<{ userId: string; x: number; y: number } | null>(null)
  const profilePresence = usePresence(client, profile ? [profile.userId] : [])
  const interactions = useChatInteractions(client, room)
  // One menu for the whole timeline, owned here so two rows cannot each open
  // their own -- the same reason the profile card is owned here (W4.2).
  const [ixMenu, setIxMenu] = useState<{ userId: string; x: number; y: number } | null>(null)
  const chatBg = useChatBackground()
  const tagPrefs = useMediaTagPrefs()
  const [bgMenuOpen, setBgMenuOpen] = useState(false)
  const bg = chatBg.get(room.roomId)
  useEffect(() => {
    followRef.current = true
  }, [room])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Non-null while a load-older is in flight: the scrollHeight captured
  // just before the prepend, used to restore the viewport afterward.
  const prependHeightRef = useRef<number | null>(null)
  // Follow mode: while true, every content/layout change re-pins the view
  // to the bottom (initial load, back-fill landing, images painting, new
  // messages). Starts true on room open; disengages when the user scrolls
  // up; re-engages when they return near the bottom. This makes late
  // layout shifts (async images) harmless instead of each needing a fix.
  const followRef = useRef(true)

  // Click-to-jump. A target already on screen is a DOM lookup; otherwise
  // paginate backwards a BOUNDED number of pages, retrying after each. The
  // bound is what stops a jump to an id that is not in this room from walking
  // a busy room back to its creation.
  const jumpApi = useMemo<JumpApi>(
    () => ({
      canPaginate: !atStart,
      jump: async (eventId: string) => {
        if (scrollToEventInDom(eventId)) return true
        for (let page = 0; page < MAX_JUMP_PAGES; page++) {
          if (atStartRef.current) break
          prependHeightRef.current = scrollRef.current?.scrollHeight ?? null
          await loadOlder()
          // Let the prepend paint before searching for the row.
          await new Promise((r) => requestAnimationFrame(() => r(null)))
          if (scrollToEventInDom(eventId)) return true
        }
        return false
      },
    }),
    [loadOlder, atStart],
  )

  // Read inside the jump loop, where a stale `atStart` closure would keep
  // paginating past the start of the room.
  const atStartRef = useRef(atStart)
  useEffect(() => {
    atStartRef.current = atStart
  }, [atStart])

  // Scroll behavior on item-count change:
  //  - after a load-older PREPEND: keep the viewport pinned to the same
  //    message (offset scrollTop by the height the prepend added).
  //  - otherwise (initial load / new message APPEND): follow the bottom,
  //    but only if the user was already near it -- don't yank someone
  //    who is reading history.
  useEffect(() => {
    const el = scrollRef.current
    if (el && prependHeightRef.current !== null) {
      el.scrollTop += el.scrollHeight - prependHeightRef.current
      prependHeightRef.current = null
      return
    }
    if (!followRef.current) return
    pinBottom(el)
  }, [items.length])

  // Track user intent: scrolling away from the bottom disengages follow mode;
  // returning near it re-engages. Prepend restores land away from the bottom,
  // so they naturally leave follow off (correct: the user is reading history).
  //
  // The height check is what makes this trustworthy. A scroll event says the
  // viewport moved relative to the content; it does NOT say the user moved it.
  // When an inline image finishes loading, the row grows, the distance from the
  // bottom jumps by the image's height, and a scroll event fires -- with the
  // pointer untouched. Reading that as "the user scrolled up" is what stranded
  // the timeline part-way up a conversation: follow disengaged, and the
  // ResizeObserver below then had nothing left to re-pin, because it checks the
  // very flag the growth had just cleared.
  //
  // So: if the content's height changed since the last sample, this event is
  // content-driven and carries no intent. Re-pin (if following) and wait for a
  // scroll that happens at a STABLE height before believing anything about what
  // the user wants.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let lastHeight = el.scrollHeight
    const onScroll = () => {
      const height = el.scrollHeight
      if (height !== lastHeight) {
        lastHeight = height
        if (followRef.current) pinBottom(el)
        return
      }
      followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK_PX
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // While following, re-pin on ANY content growth (async image paints shift
  // layout well after the items effect has run). Belt and braces with the
  // height check above: this fires when the growth produces no scroll event at
  // all, that one fires when it does.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (followRef.current) pinBottom(el)
    })
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [items.length])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid rgba(128,128,128,0.25)',
          fontWeight: 600,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          minWidth: 0,
          flexShrink: 0,
        }}
      >
        <RoomHeaderInfo client={client} room={room} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!atStart && (
            <button
              type="button"
              onClick={() => {
                prependHeightRef.current = scrollRef.current?.scrollHeight ?? null
                void loadOlder()
              }}
              disabled={loadingOlder}
              style={{ fontSize: 12, fontWeight: 400 }}
            >
              {loadingOlder ? 'Loading...' : 'Load older'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSearchOpen((o) => !o)}
            title="Search messages"
            aria-expanded={searchOpen}
            style={{ fontSize: 12, fontWeight: 400 }}
          >
            {'\u{1F50D}'}
          </button>
          {pins.pinned.length > 0 && (
            <button
              type="button"
              onClick={() => setPinnedOpen((o) => !o)}
              title="Pinned messages"
              aria-expanded={pinnedOpen}
              style={{ fontSize: 12, fontWeight: 400 }}
            >
              {'\u{1F4CC}'} {pins.pinned.length}
            </button>
          )}
          {onToggleThreadList && (
            <button
              type="button"
              onClick={onToggleThreadList}
              style={{ fontSize: 12, fontWeight: 400 }}
            >
              {threadListOpen ? 'Threads X' : 'Threads'}
            </button>
          )}
          <button
            type="button"
            onClick={tagPrefs.toggleGlobal}
            title={
              tagPrefs.enabled
                ? 'Image tags on — click to hide everywhere'
                : 'Image tags off — click to show everywhere'
            }
            aria-label="Toggle image tags"
            aria-pressed={tagPrefs.enabled}
            style={{
              fontSize: 13,
              fontWeight: 400,
              lineHeight: 1,
              padding: '2px 4px',
              opacity: tagPrefs.enabled ? 1 : 0.45,
            }}
          >
            {'\u{1F3F7}'}
          </button>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setBgMenuOpen((o) => !o)}
              title="Chat background"
              aria-label="Chat background"
              style={{ fontSize: 13, fontWeight: 400, lineHeight: 1, padding: '2px 4px' }}
            >
              🖼
            </button>
            {bgMenuOpen && client && (
              <ChatBackgroundMenu
                client={client}
                roomId={room.roomId}
                current={bg}
                onApply={(next) => {
                  chatBg.set(room.roomId, next)
                  setBgMenuOpen(false)
                }}
                onClear={() => {
                  chatBg.clear(room.roomId)
                  setBgMenuOpen(false)
                }}
                onClose={() => setBgMenuOpen(false)}
              />
            )}
          </div>
        </div>
      </header>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {bg && client && <ChatBackdrop bg={bg} />}
        <div
          ref={scrollRef}
          style={{
            position: 'relative',
            zIndex: 1,
            flex: 1,
            overflowY: 'auto',
            padding: '12px 16px',
            color: 'var(--cpd-color-text-primary)',
          }}
        >
          {atStart && (
            <div style={{ fontSize: 12, color: 'var(--cpd-color-text-secondary)', padding: '4px 0', marginBottom: 8 }}>
              Beginning of the room.
            </div>
          )}

          <ProfileOpenerContext.Provider
            value={(userId, x, y) => setProfile({ userId, x, y })}
          >
          <InteractionTargetContext.Provider
            value={(userId, x, y) => setIxMenu({ userId, x, y })}
          >
          <JumpContext.Provider value={jumpApi}>
            {searchOpen && client && (
              <SearchPanel client={client} room={room} onClose={() => setSearchOpen(false)} />
            )}
            {pinnedOpen && (
              <PinnedPanel
                client={client}
                room={room}
                pinned={pins.pinned}
                canPin={pins.canPin}
                onUnpin={(id) => void pins.toggle(id)}
                onClose={() => setPinnedOpen(false)}
              />
            )}
            <ReceiptsContext.Provider value={receipts}>
            <MessageVerbsProvider room={room}>
              {/* Branched at the CALL SITE, not inside Row: an early return
                  above Row's hooks breaks rules-of-hooks (G-tp17), and neither
                  a separator nor a membership change is a message -- no
                  pillbox, no action bar, no footer, no target for any verb. */}
              {items.map((item) =>
                item.kind === 'day' ? (
                  <DaySeparator key={item.id} item={item} />
                ) : item.kind === 'member' ? (
                  <MemberEvent key={item.id} event={item.event} />
                ) : (
                  <Row key={item.id} item={item} onOpenThread={onOpenThread} />
                ),
              )}
            </MessageVerbsProvider>
            </ReceiptsContext.Provider>
          </JumpContext.Provider>
          </InteractionTargetContext.Provider>
          </ProfileOpenerContext.Provider>
          {/* Above the log, never inside it. */}
          <InteractionLayer
            plays={interactions.plays}
            containerRef={scrollRef}
            nameFor={(userId) => room.getMember(userId)?.name || userId}
          />
          {ixMenu && client && (
            <InteractionMenu
              x={ixMenu.x}
              y={ixMenu.y}
              targetUserId={ixMenu.userId}
              targetName={room.getMember(ixMenu.userId)?.name || ixMenu.userId}
              isSelf={ixMenu.userId === client.getUserId()}
              disabled={!interactions.canTrigger()}
              onPick={(def, userId) =>
                interactions.trigger(def.id, def.shape === 'targeted' ? userId : undefined)
              }
              onClose={() => setIxMenu(null)}
            />
          )}
          {profile && client && (
            <ProfileCard
              x={profile.x}
              y={profile.y}
              userId={profile.userId}
              room={room}
              presence={profilePresence.get(profile.userId)}
              actions={
                <ProfileActions
                  client={client}
                  userId={profile.userId}
                  room={room}
                  onClose={() => setProfile(null)}
                />
              }
              onClose={() => setProfile(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// The sender identity shown at the top of a message row: the shared AvatarPill
// with the timestamp trailing outside it. The pill itself lives in
// ./AvatarPill so the membership rows show the same one, not a copy of it.
function SenderPill({
  event,
  time,
  onOpenProfile,
  onOpenInteractions,
}: {
  event: MatrixEvent
  time: string
  onOpenProfile?: (userId: string, x: number, y: number) => void
  onOpenInteractions?: (userId: string, x: number, y: number) => void
}) {
  const { client } = useClient()
  const senderId = event.getSender() ?? '(unknown)'
  const member = client?.getRoom(event.getRoomId() ?? '')?.getMember(senderId) ?? null
  const name = member?.name || senderId
  const avatarMxc = member?.getMxcAvatarUrl() ?? null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <AvatarPill
        userId={senderId}
        name={name}
        avatarMxc={avatarMxc}
        onOpen={onOpenProfile}
        onContext={onOpenInteractions}
      />
      <span style={{ fontSize: 11, color: 'var(--cpd-color-text-secondary)', flexShrink: 0 }}>{time}</span>
    </div>
  )
}

export function Row({ item, onOpenThread }: { item: TimelineItem; onOpenThread?: (roomId: string, rootId: string) => void }) {
  const { event, kind, cells, layout } = item
  const { open } = useLightbox()
  const { client } = useClient()
  const actions = useMessageActions(item)
  const openProfile = useProfileOpener()
  const openInteractions = useInteractionTarget()
  // One preview per message: a wall of cards under a link-heavy message is its
  // own problem. Opt-in, because a preview makes the SERVER fetch a third-party
  // URL on the reader's behalf.
  const linkPreviewsEnabled = useLinkPreviewPref()
  const previewUrl =
    item.kind === 'message' && typeof item.content.body === 'string'
      ? firstLink(item.content.body)
      : null
  const time = new Date(event.getTs()).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  const roomId = event.getRoomId() ?? ''
  const canReact = kind === 'message' || kind === 'gallery'
  // Where this row's reaction affordance goes. A MEDIA body takes the rail
  // beside the picture; a text body takes the reserved slot trailing the text.
  // Either way the slot is occupied at all times -- the row's height must be
  // identical hovered and not, because the timeline re-pins to the bottom while
  // following and any hover-driven growth slides the whole conversation.
  const isMediaRow =
    kind === 'gallery' ||
    (kind === 'message' &&
      item.content.msgtype === 'm.image' &&
      !!parseMxc(typeof item.content.url === 'string' ? item.content.url : ''))

  let body: React.ReactNode
  if (kind === 'gallery' && cells) {
    body = <GalleryBody cells={cells} layout={layout ?? 'grid'} />
  } else if (kind === 'message') {
    const content = item.content
    const mxc = typeof content.url === 'string' ? content.url : ''
    if (content.msgtype === 'm.image' && parseMxc(mxc)) {
      // Image message: render the picture inline via the gateway as a thumbnail
      // (320 snaps to the gateway's allowed sizes). Click opens the full-res
      // image in the lightbox via an authed full fetch.
      body = (
        <div>
          <AuthedImage
            mxc={mxc}
            width={320}
            reserve={reserveBox(content)}
            alt={typeof content.body === 'string' ? content.body : undefined}
            onClick={() => open([{ mxc, ...imageMeta(event) }], 0)}
          />
          <MediaTags mxc={mxc} roomId={event.getRoomId()} />
        </div>
      )
    } else {
    // item.content, not event.getContent(): the effective content with the
    // winning edit applied (S1). isReply strips the spec's "> " fallback quote.
    const rendered = renderMessageBody(item.content, { isReply: !!item.replyTo })
    body =
      rendered.html !== undefined ? (
        // Sanitized by DOMPurify in renderMessageBody — safe to inject.
        // The click/key handlers are DELEGATED: an innerHTML subtree cannot
        // carry React handlers, so spoiler reveal is resolved by walking up
        // from the event target (W2.L2).
        <span
          className="tc-message-html"
          onClick={onSpoilerClick}
          onKeyDown={onSpoilerKey}
          dangerouslySetInnerHTML={{ __html: rendered.html }}
        />
      ) : (
        <span style={{ whiteSpace: 'pre-wrap' }}>{linkify(rendered.text ?? '')}</span>
      )
    }
  } else if (isPollStart(event)) {
    // A poll arrives as its own event type, so it is classified 'other' by
    // toItems and would otherwise render as `[m.poll.start]`.
    body = <PollBody client={client} room={client?.getRoom(event.getRoomId() ?? '') ?? null} event={event} />
  } else if (kind === 'encrypted') {
    body = <span style={{ fontStyle: 'italic', opacity: 0.7 }}>🔒 Encrypted (decryption coming later)</span>
  } else if (kind === 'redacted') {
    body = <span style={{ fontStyle: 'italic', opacity: 0.6 }}>(message deleted)</span>
  } else {
    body = (
      <span style={{ fontStyle: 'italic', opacity: 0.5 }}>
        [{event.getType()}]
      </span>
    )
  }

  return (
    // data-event-id is what click-to-jump searches for; keeping it on the row
    // means no separate index has to stay in sync with the timeline.
    <div
      className="tc-row"
      data-event-id={item.id}
      data-grouped={item.showHeader === false ? 'true' : undefined}
      style={{ padding: '4px 0' }}
    >
      {/* A grouped message loses its pillbox, so its time is shown in the
          gutter on hover -- otherwise the timestamp becomes unreachable for
          every message after the first in a run. */}
      {item.showHeader === false && <span className="tc-row-gutter-time">{time}</span>}
      {/* Overlays the row's top-right; revealed by CSS on hover/focus-within so
          no React state churns per pointer crossing. */}
      <MessageActionBar actions={actions} />
      {/* Grouping hides the HEADER only. Every decoration below -- reply
          pill, body, edited marker, reactions, receipts, thread chip -- is
          untouched, which is why grouping could land last without revisiting
          any of them. */}
      {item.showHeader !== false && (
        <SenderPill
          event={event}
          time={time}
          onOpenProfile={openProfile}
          onOpenInteractions={openInteractions}
        />
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
          paddingLeft: 16,
          marginTop: 1,
        }}
      >
        {item.replyTo && <ReplyPill replyTo={item.replyTo} />}
        <div style={{ fontSize: 14, wordBreak: 'break-word', minWidth: 0 }}>
          {isMediaRow && roomId ? (
            // The picture and its rail sit side by side. The picture is FIRST,
            // so the rail appearing on hover cannot shift it.
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
              <div style={{ minWidth: 0 }}>{body}</div>
              <ReactionRail item={item} client={client} roomId={roomId} />
            </div>
          ) : (
            <>
              {body}
              {item.editedTs !== undefined && (
                <span
                  className="tc-edited-marker"
                  title={`Edited ${new Date(item.editedTs).toLocaleString()}`}
                >
                  (edited)
                </span>
              )}
              {canReact && roomId && (
                <ReactionAdd item={item} client={client} roomId={roomId} inline />
              )}
            </>
          )}
          {previewUrl && (
            <LinkPreview client={client} url={previewUrl} enabled={linkPreviewsEnabled} />
          )}
          {isMediaRow && item.editedTs !== undefined && (
            <span
              className="tc-edited-marker"
              title={`Edited ${new Date(item.editedTs).toLocaleString()}`}
            >
              (edited)
            </span>
          )}
        </div>
        <RowFooter item={item} onOpenThread={onOpenThread} pillsInRail={isMediaRow} />
      </div>
    </div>
  )
}

// W2.4's designed footer region: one wrapping flex row under the body, holding
// the reaction pills, the thread chip, and (W2.6) the receipts cluster.
//
// It renders NOTHING unless it has real content. It no longer carries the "+"
// affordance at all: a footer that existed only to hold a hover-revealed button
// had to grow from zero height on hover, which moved the row (and, because the
// timeline re-pins to the bottom while following, every row above it). The
// affordance now lives beside the body, where revealing it costs no height.
//
// A MEDIA row's pills live in its rail, so the footer skips them there.
function RowFooter({
  item,
  onOpenThread,
  pillsInRail = false,
}: {
  item: TimelineItem
  onOpenThread?: (roomId: string, rootId: string) => void
  pillsInRail?: boolean
}) {
  const { client } = useClient()
  const receipts = useReceipts()
  const roomId = item.event.getRoomId() ?? ''
  const isThreadRoot = item.event.isThreadRoot
  const hasReactions = (item.reactions?.length ?? 0) > 0
  const seenBy = receipts.get(item.id) ?? EMPTY_SEEN
  const showPills = hasReactions && !pillsInRail

  if (!showPills && !isThreadRoot && seenBy.length === 0) return null

  return (
    <div className="tc-row-footer">
      {showPills && roomId && <ReactionPills item={item} client={client} roomId={roomId} />}
      {isThreadRoot && <ThreadChip event={item.event} onOpen={onOpenThread} />}
      {seenBy.length > 0 && (
        <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
          <ReceiptCluster room={client?.getRoom(roomId) ?? null} userIds={seenBy} />
        </span>
      )}
    </div>
  )
}

// One grid cell: a static "pending upload" graphic as the background, with the
// thumbnail layered over it (transparentLoading, so the graphic shows through
// until the real image paints). A null / loading / failed slot shows the graphic.
// Pull a friendly filename + mimetype off an m.image content for the lightbox
// (download name + extension hinting). filename wins (MSC2530 caption case),
// else body; the mediaId is the downstream fallback.
function imageMeta(ev: MatrixEvent): { name?: string; mimetype?: string } {
  const c = ev.getContent()
  const name =
    typeof c.filename === 'string' ? c.filename : typeof c.body === 'string' ? c.body : undefined
  const info = c.info as { mimetype?: unknown } | undefined
  const mimetype = info && typeof info.mimetype === 'string' ? info.mimetype : undefined
  return { name, mimetype }
}

function GalleryCell({ ev, onOpen }: { ev: MatrixEvent | null; onOpen?: () => void }) {
  const c = ev?.getContent()
  const mxc = c && typeof c.url === 'string' ? c.url : ''
  const showImg = !!ev && !!parseMxc(mxc)
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--cpd-color-bg-subtle-secondary)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--cpd-color-text-secondary)',
          opacity: 0.4,
        }}
      >
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
      {showImg && (
        <div style={{ position: 'absolute', inset: 0 }}>
          <AuthedImage
            mxc={mxc}
            width={360}
            alt={typeof c?.body === 'string' ? c.body : undefined}
            fill
            transparentLoading
            onClick={onOpen}
          />
          {/* Gallery cells are small and tile tightly -- a count chip, not a
              strip, so the batch's geometry is untouched. */}
          <MediaTags mxc={mxc} roomId={ev?.getRoomId()} variant="chip" />
        </div>
      )}
    </div>
  )
}

// Coalesced image batch (net.41chan.gallery). Three sender-chosen layouts:
//  - grid:  fixed-size square cells arranged by count (2/3 in a row, 4 as 2x2,
//           5 as a double-height cell on the left + a 2x2 on the right).
//  - stack: constant total height; N full-width rows split it (fewer = taller).
//  - strip: constant total width+height; N columns split it (fewer = wider).
// Cells fill their grid track; all geometry lives here. Caption (index-0) below.
const GALLERY_CELL = 118 // px square; 3 cols + 2 gaps = 360, matching stack/strip width
const GALLERY_GAP = 3

function GalleryBody({ cells, layout }: { cells: (MatrixEvent | null)[]; layout: GalleryLayout }) {
  const n = cells.length
  const { open } = useLightbox()
  // Present (non-null, valid) images in cell order, plus a map from cell index
  // to its position in that list, so clicking a cell opens the lightbox at the
  // right spot and prev/next steps through the batch's real images only.
  const present: LightboxItem[] = []
  const presentIndexByCell = new Map<number, number>()
  cells.forEach((ev, idx) => {
    if (!ev) return
    const cc = ev.getContent()
    const cmxc = typeof cc.url === 'string' ? cc.url : ''
    if (!parseMxc(cmxc)) return
    presentIndexByCell.set(idx, present.length)
    present.push({ mxc: cmxc, ...imageMeta(ev) })
  })
  const first = cells[0]
  const fc = first?.getContent()
  const caption = first && typeof fc?.filename === 'string' ? renderMessageBody(first) : null

  let gridStyle: React.CSSProperties
  let cellPlacement: (idx: number) => React.CSSProperties = () => ({})

  if (layout === 'stack') {
    gridStyle = {
      display: 'grid',
      gridTemplateColumns: '1fr',
      gridTemplateRows: `repeat(${n}, 1fr)`,
      gap: GALLERY_GAP,
      width: 360,
      height: 300,
    }
  } else if (layout === 'strip') {
    gridStyle = {
      display: 'grid',
      gridTemplateColumns: `repeat(${n}, 1fr)`,
      gridTemplateRows: '1fr',
      gap: GALLERY_GAP,
      width: 360,
      height: 280,
    }
  } else if (n === 5) {
    gridStyle = {
      display: 'grid',
      gridTemplateColumns: `repeat(3, ${GALLERY_CELL}px)`,
      gridTemplateRows: `repeat(2, ${GALLERY_CELL}px)`,
      gap: GALLERY_GAP,
      width: 'max-content',
    }
    cellPlacement = (idx) => (idx === 0 ? { gridColumn: '1', gridRow: '1 / span 2' } : {})
  } else {
    const cols = n <= 3 ? n : 2
    gridStyle = {
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, ${GALLERY_CELL}px)`,
      gridAutoRows: `${GALLERY_CELL}px`,
      gap: GALLERY_GAP,
      width: 'max-content',
    }
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...gridStyle, borderRadius: 8, overflow: 'hidden' }}>
        {cells.map((ev, idx) => (
          <div
            key={ev?.getId() ?? `empty-${idx}`}
            style={{ position: 'relative', minWidth: 0, ...cellPlacement(idx) }}
          >
            <GalleryCell
              ev={ev}
              onOpen={
                presentIndexByCell.has(idx)
                  ? () => open(present, presentIndexByCell.get(idx)!)
                  : undefined
              }
            />
          </div>
        ))}
      </div>
      {caption && (
        <div style={{ fontSize: 14, wordBreak: 'break-word', marginTop: 4 }}>
          {caption.html !== undefined ? (
            <span className="tc-message-html" dangerouslySetInnerHTML={{ __html: caption.html }} />
          ) : (
            <span style={{ whiteSpace: 'pre-wrap' }}>{linkify(caption.text ?? '')}</span>
          )}
        </div>
      )}
    </div>
  )
}

// "N replies" chip under a thread-root message. Reads the live reply count from
// the event's Thread and re-renders on thread updates. Click-to-open wiring lands
// in Phase 2 (an onOpen prop threaded from App to open the thread panel).
function ThreadChip({ event, onOpen }: { event: MatrixEvent; onOpen?: (roomId: string, rootId: string) => void }) {
  const thread = event.getThread()
  const [count, setCount] = useState(thread?.length ?? 0)

  useEffect(() => {
    if (!thread) return
    const update = () => setCount(thread.length)
    update()
    thread.on(ThreadEvent.Update, update)
    thread.on(ThreadEvent.NewReply, update)
    return () => {
      thread.off(ThreadEvent.Update, update)
      thread.off(ThreadEvent.NewReply, update)
    }
  }, [thread])

  if (!thread || count < 1) return null
  return (
    <button
      type="button"
      onClick={() => {
        const rootId = event.getId()
        const roomId = event.getRoomId()
        if (rootId && roomId && onOpen) onOpen(roomId, rootId)
      }}
      style={{
        alignSelf: 'flex-start',
        fontSize: 12,
        padding: '2px 8px',
        borderRadius: 12,
        border: '1px solid var(--cpd-color-border-interactive-secondary, #444)',
        background: 'var(--cpd-color-bg-subtle-secondary)',
        color: 'var(--cpd-color-text-secondary)',
        cursor: 'pointer',
      }}
    >
      💬 {count} {count === 1 ? 'reply' : 'replies'}
    </button>
  )
}

// W6.1 -- a date marker. A separate component branched at the CALL SITE, not a
// branch inside Row: an early return above Row's hooks would break the
// rules-of-hooks order, and a separator is not a message anyway -- it has no
// pillbox, no action bar, no footer, and is not a target for any verb.
export function DaySeparator({ item }: { item: TimelineItem }) {
  const ts = item.dayTs ?? item.event.getTs()
  return (
    <div className="tc-day-separator" role="separator">
      <span>
        {new Date(ts).toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      </span>
    </div>
  )
}

// W2.1 -- the reply pill above a reply's body: who was answered, a one-line
// preview, and click-to-jump to the original.
//
// The preview is deliberately plain text (eventPreview), never the rendered
// HTML -- a pill is chrome, and injecting message markup into chrome is how a
// formatted body escapes the message area.
function ReplyPill({ replyTo }: { replyTo: ReplyRef }) {
  const { client } = useClient()
  const { jump, canPaginate } = useJump()
  const [jumping, setJumping] = useState(false)

  const target = replyTo.event
  // Unresolved: the original is outside the loaded window. Say so honestly
  // rather than rendering a pill that looks like a real quote.
  const senderId = target?.getSender() ?? null
  const member = senderId
    ? client?.getRoom(target?.getRoomId() ?? '')?.getMember(senderId) ?? null
    : null
  const name = member?.name || senderId || 'a message'
  const preview = target ? eventPreview(target, 80) : 'Original not loaded'

  // Nothing to jump to and no way to find it -> render inert, not a dead link.
  const jumpable = !!target || canPaginate

  const onClick = () => {
    if (!jumpable || jumping) return
    setJumping(true)
    void jump(replyTo.eventId).finally(() => setJumping(false))
  }

  return (
    <button
      type="button"
      className="tc-reply-pill"
      onClick={onClick}
      disabled={!jumpable}
      title={jumpable ? 'Jump to the message being replied to' : 'Original message not loaded'}
      aria-label={`Replying to ${name}: ${preview}`}
    >
      <span className="tc-reply-pill-arrow" aria-hidden="true">
        {'↱'}
      </span>
      <span className="tc-reply-pill-name">{name}</span>
      <span className="tc-reply-pill-text">{jumping ? 'Searching...' : preview}</span>
    </button>
  )
}
