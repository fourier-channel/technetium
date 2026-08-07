import type { MatrixClient, Room } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W5.4 -- MSC2545 image packs (O-tp3: the format Cinny/nheko-family clients
// already speak, so packs made anywhere in that family work here).
//
// Two places packs live:
//   - ROOM state `im.ponies.room_emotes` -- a pack belonging to that room
//   - ACCOUNT data `im.ponies.user_emotes` -- the user's personal pack
// plus `im.ponies.emote_rooms` in account data, which points at packs in other
// rooms the user has enabled. Only the first two are read here; following the
// pointer list is v2 and is noted rather than half-done.
// ---------------------------------------------------------------------------

export const ROOM_PACK_EVENT = 'im.ponies.room_emotes'
export const USER_PACK_EVENT = 'im.ponies.user_emotes'

export interface PackImage {
  // Shortcode WITHOUT colons, e.g. "party_blob".
  code: string
  mxc: string
  body?: string
  // MSC2545 usage: 'emoticon' (inline in text) and/or 'sticker'.
  usage: string[]
}

export interface EmojiPack {
  id: string
  title: string
  images: PackImage[]
}

function parsePack(id: string, content: unknown, fallbackTitle: string): EmojiPack | null {
  if (!content || typeof content !== 'object') return null
  const c = content as Record<string, unknown>
  const images = c.images
  if (!images || typeof images !== 'object') return null

  const packInfo = (c.pack ?? {}) as Record<string, unknown>
  const title = typeof packInfo.display_name === 'string' ? packInfo.display_name : fallbackTitle
  // A pack-level usage applies to every image that does not override it.
  const packUsage = Array.isArray(packInfo.usage)
    ? packInfo.usage.filter((u): u is string => typeof u === 'string')
    : []

  const out: PackImage[] = []
  for (const [code, raw] of Object.entries(images as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const img = raw as Record<string, unknown>
    const mxc = typeof img.url === 'string' ? img.url : null
    if (!mxc || !mxc.startsWith('mxc://')) continue
    const usage = Array.isArray(img.usage)
      ? img.usage.filter((u): u is string => typeof u === 'string')
      : packUsage
    out.push({
      code,
      mxc,
      body: typeof img.body === 'string' ? img.body : undefined,
      // Empty usage means BOTH, per the MSC.
      usage: usage.length > 0 ? usage : ['emoticon', 'sticker'],
    })
  }
  if (out.length === 0) return null
  return { id, title, images: out }
}

export function readRoomPacks(room: Room | null): EmojiPack[] {
  if (!room) return []
  const packs: EmojiPack[] = []
  // Multiple packs per room are distinguished by state key.
  for (const ev of room.currentState.getStateEvents(ROOM_PACK_EVENT)) {
    const key = ev.getStateKey() ?? ''
    const pack = parsePack(
      `room:${room.roomId}:${key}`,
      ev.getContent(),
      room.name || 'This room',
    )
    if (pack) packs.push(pack)
  }
  return packs
}

export function readUserPack(client: MatrixClient | null): EmojiPack | null {
  if (!client) return null
  // The sdk types account data to its own known keys; MSC2545 is not one of
  // them, so the custom type is reached through a loosely-typed alias rather
  // than by widening the sdk's union (cf. the domain-background write).
  const getAccountData = client.getAccountData.bind(client) as unknown as (
    type: string,
  ) => { getContent: () => unknown } | undefined
  const ev = getAccountData(USER_PACK_EVENT)
  if (!ev) return null
  return parsePack('user', ev.getContent(), 'Your emoji')
}

export function allPacks(client: MatrixClient | null, room: Room | null): EmojiPack[] {
  const user = readUserPack(client)
  return [...(user ? [user] : []), ...readRoomPacks(room)]
}

// Images usable inline in a message (as opposed to sticker-only ones).
export function emoticons(packs: EmojiPack[]): PackImage[] {
  return packs.flatMap((p) => p.images.filter((i) => i.usage.includes('emoticon')))
}

export function stickers(packs: EmojiPack[]): PackImage[] {
  return packs.flatMap((p) => p.images.filter((i) => i.usage.includes('sticker')))
}

// A custom emote reaction is an m.annotation whose KEY is the mxc uri. That is
// how the MSC2545 family renders custom-emoji reactions, and it is why the
// reaction strip has to be able to tell an mxc key from a literal glyph.
export function isCustomEmojiKey(key: string): boolean {
  return key.startsWith('mxc://')
}
