import { type MatrixEvent } from 'matrix-js-sdk'
import { parseMxc } from './media'

// ---------------------------------------------------------------------------
// Media tags: the bridge publishes per-image tag data into ROOM STATE as
// `net.41chan.media.tags`, one state event per image, state_key = the mxc media
// ID. Tags describe the MEDIA, not the message, so the same image posted into
// three rooms carries one tag set -- which is why the store below is keyed by
// media ID globally rather than by (roomId, eventId).
//
// SCHEMA SEAM: the bridge's exact content shape is not yet pinned down, so
// `parseTagContent` is deliberately TOLERANT -- it accepts every plausible
// encoding and normalizes to one internal shape. When the real payload is
// confirmed, tighten THIS FUNCTION ONLY; nothing downstream knows the wire
// format. Shapes accepted:
//
//   { tags: ["1girl", "outdoors"] }                       flat strings
//   { tags: [{ name, category?, score?, url? }, ...] }     per-tag objects
//   { tags: { artist: [...], general: [...] } }            category -> names
//   { general: [...], artist: [...] }                      bare category keys
//
// plus `source` / `source_url` / `post_url` at the top level for the origin link.
// ---------------------------------------------------------------------------

export const MEDIA_TAGS_EVENT = 'net.41chan.media.tags'

// Booru-style buckets. 'general' is the fallback for anything uncategorized, so
// an untyped tag list still renders (just uniformly colored).
export type TagCategory = 'artist' | 'character' | 'copyright' | 'meta' | 'general'

const CATEGORIES: readonly TagCategory[] = ['artist', 'character', 'copyright', 'meta', 'general']

export interface MediaTag {
  name: string
  category: TagCategory
  // 0..1 from the tagger when present. Kept so a confidence threshold can be
  // added later without a schema change; unused by the v1 strip.
  score?: number
  // Per-tag link (rare); the per-image source link lives on MediaTagSet.
  url?: string
}

// Content rating, booru convention: general / sensitive / questionable /
// explicit. The bridge sends the single-letter form.
export type MediaRating = 'g' | 's' | 'q' | 'e'

export interface MediaTagSet {
  mediaId: string
  tags: MediaTag[]
  // Link back to the origin post, when the bridge supplies one.
  source?: string
  // Booru post id (`post_id`). Rendered as a #-chip; becomes a real link once a
  // source base URL is configured.
  postId?: number
  rating?: MediaRating
  // Who last wrote the tags (`updated_by`), for the strip's tooltip.
  updatedBy?: string
  // Last-write-wins clock. Prefers the bridge's own `updated_at` over the event
  // ts: a re-send of unchanged tags bumps origin_server_ts but not updated_at,
  // so using the bridge's clock avoids counting a replay as an update.
  ts: number
}

function asCategory(v: unknown): TagCategory {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v)
    ? (v as TagCategory)
    : 'general'
}

function asScore(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

// One tag entry, from either a bare string or an object form.
function parseTag(raw: unknown, fallbackCategory: TagCategory): MediaTag | null {
  if (typeof raw === 'string') {
    const name = raw.trim()
    return name ? { name, category: fallbackCategory } : null
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    // `name` is canonical; `tag` and `value` are accepted aliases.
    const rawName = o.name ?? o.tag ?? o.value
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    if (!name) return null
    return {
      name,
      category: o.category !== undefined ? asCategory(o.category) : fallbackCategory,
      score: asScore(o.score ?? o.confidence),
      url: typeof o.url === 'string' ? o.url : undefined,
    }
  }
  return null
}

// A list of tags under one category heading.
function parseList(raw: unknown, category: TagCategory, out: MediaTag[]): void {
  if (!Array.isArray(raw)) return
  for (const entry of raw) {
    const tag = parseTag(entry, category)
    if (tag) out.push(tag)
  }
}

export function parseTagContent(content: unknown, mediaId: string, ts: number): MediaTagSet | null {
  if (!content || typeof content !== 'object') return null
  const c = content as Record<string, unknown>
  const tags: MediaTag[] = []

  const raw = c.tags
  if (Array.isArray(raw)) {
    // Flat list: strings or objects, category carried per-entry if at all.
    parseList(raw, 'general', tags)
  } else if (raw && typeof raw === 'object') {
    // Nested: { artist: [...], general: [...] }.
    for (const [key, list] of Object.entries(raw as Record<string, unknown>)) {
      parseList(list, asCategory(key), tags)
    }
  }

  // Bare category keys at the top level, e.g. { artist: [...] } with no `tags`.
  for (const cat of CATEGORIES) {
    if (Array.isArray(c[cat])) parseList(c[cat], cat, tags)
  }

  const sourceRaw = c.source ?? c.source_url ?? c.post_url ?? c.url
  const source = typeof sourceRaw === 'string' && /^https?:\/\//i.test(sourceRaw) ? sourceRaw : undefined

  const postId = typeof c.post_id === 'number' && Number.isFinite(c.post_id) ? c.post_id : undefined
  const rating =
    typeof c.rating === 'string' && ['g', 's', 'q', 'e'].includes(c.rating)
      ? (c.rating as MediaRating)
      : undefined
  const updatedBy = typeof c.updated_by === 'string' ? c.updated_by : undefined
  const updatedAt =
    typeof c.updated_at === 'number' && Number.isFinite(c.updated_at) ? c.updated_at : undefined

  // An empty set with nothing else to show carries no information -- treat as
  // absent so untagged images keep their exact layout.
  if (tags.length === 0 && !source && postId === undefined && !rating) return null

  return {
    mediaId,
    tags: dedupe(tags),
    source,
    postId,
    rating,
    updatedBy,
    ts: updatedAt ?? ts,
  }
}

// Same name twice (e.g. listed flat AND under a category) collapses to one,
// preferring the entry that carries a real category.
function dedupe(tags: MediaTag[]): MediaTag[] {
  const byName = new Map<string, MediaTag>()
  for (const t of tags) {
    const key = t.name.toLowerCase()
    const existing = byName.get(key)
    if (!existing || (existing.category === 'general' && t.category !== 'general')) {
      byName.set(key, t)
    }
  }
  return [...byName.values()]
}

// The bridge writes the state key as a FULL mxc uri
// (`mxc://41chan.net/auARX...`), so normalize to the bare media id -- that is
// what the store is keyed by, and it makes the same image resolve identically
// no matter which room's state event was read. A bare media id is accepted too,
// so the convention can change without breaking the client.
export function mediaIdFromStateKey(stateKey: string | undefined): string | null {
  if (!stateKey) return null
  const key = stateKey.trim()
  if (!key) return null
  if (key.startsWith('mxc://')) return parseMxc(key)?.mediaId ?? null
  return key
}

// Read a `net.41chan.media.tags` state event into a normalized set. Events with
// no state key are ignored -- they cannot be attributed to an image.
export function tagSetFromEvent(ev: MatrixEvent): MediaTagSet | null {
  const mediaId = mediaIdFromStateKey(ev.getStateKey())
  if (!mediaId) return null
  return parseTagContent(ev.getContent(), mediaId, ev.getTs())
}

// Sort for display: artist and character read first (they identify the image),
// then copyright, then the general bulk, then meta. Alphabetical within a
// bucket so the strip is stable across re-renders.
const ORDER: Record<TagCategory, number> = {
  artist: 0,
  character: 1,
  copyright: 2,
  general: 3,
  meta: 4,
}

export function sortTags(tags: MediaTag[]): MediaTag[] {
  return [...tags].sort(
    (a, b) => ORDER[a.category] - ORDER[b.category] || a.name.localeCompare(b.name),
  )
}
