import { useEffect, useMemo, useRef, useState } from 'react'
import type { EmojiPack, PackImage } from '../client/emojiPacks'
import { AuthedImage } from './AuthedImage'

// ---------------------------------------------------------------------------
// Lightweight, dependency-free emoji picker. Native unicode glyphs (no image
// sprites, no data package -- emoji-mart et al. are heavy and would need a
// DEPENDENCIES.md rationale). A curated, categorized set covers the common
// cases; a name/keyword search filters across all of them. Kept intentionally
// small and swappable -- the data lives in one const below.
// ---------------------------------------------------------------------------

interface Emoji {
  e: string
  n: string // space-separated keywords for search
}

const CATEGORIES: { key: string; label: string; icon: string; list: Emoji[] }[] = [
  {
    key: 'smileys',
    label: 'Smileys',
    icon: '😀',
    list: [
      { e: '😀', n: 'grin happy smile' },
      { e: '😃', n: 'smile happy' },
      { e: '😄', n: 'laugh happy' },
      { e: '😁', n: 'grin beam' },
      { e: '😆', n: 'laugh lol' },
      { e: '😅', n: 'sweat laugh nervous' },
      { e: '🤣', n: 'rofl rolling laugh' },
      { e: '😂', n: 'joy tears laugh' },
      { e: '🙂', n: 'slight smile' },
      { e: '🙃', n: 'upside down silly' },
      { e: '😉', n: 'wink' },
      { e: '😊', n: 'blush smile' },
      { e: '😇', n: 'angel halo innocent' },
      { e: '😍', n: 'heart eyes love' },
      { e: '🥰', n: 'love hearts' },
      { e: '😘', n: 'kiss blow' },
      { e: '😜', n: 'wink tongue' },
      { e: '🤪', n: 'zany goofy' },
      { e: '😎', n: 'cool sunglasses' },
      { e: '🤩', n: 'star struck wow' },
      { e: '🥳', n: 'party celebrate' },
      { e: '🤔', n: 'thinking hmm' },
      { e: '🤨', n: 'raised eyebrow skeptical' },
      { e: '😐', n: 'neutral meh' },
      { e: '😶', n: 'no mouth silent' },
      { e: '🙄', n: 'eye roll' },
      { e: '😏', n: 'smirk' },
      { e: '😴', n: 'sleep zzz' },
      { e: '😪', n: 'sleepy tired' },
      { e: '😵', n: 'dizzy dead' },
      { e: '🤯', n: 'mind blown explode' },
      { e: '😳', n: 'flushed embarrassed' },
      { e: '🥵', n: 'hot sweat' },
      { e: '🥶', n: 'cold freeze' },
      { e: '😱', n: 'scream shock fear' },
      { e: '😭', n: 'cry sob' },
      { e: '😢', n: 'cry sad tear' },
      { e: '😞', n: 'sad disappointed' },
      { e: '😤', n: 'huff angry steam' },
      { e: '😡', n: 'angry rage mad' },
      { e: '🤬', n: 'swear curse angry' },
      { e: '😈', n: 'devil evil grin' },
      { e: '💀', n: 'skull dead' },
      { e: '🤡', n: 'clown' },
      { e: '👻', n: 'ghost boo' },
      { e: '🤖', n: 'robot bot' },
    ],
  },
  {
    key: 'gestures',
    label: 'People',
    icon: '👍',
    list: [
      { e: '👍', n: 'thumbs up yes like' },
      { e: '👎', n: 'thumbs down no dislike' },
      { e: '👌', n: 'ok perfect' },
      { e: '🤌', n: 'pinch italian' },
      { e: '✌️', n: 'peace victory' },
      { e: '🤞', n: 'fingers crossed luck' },
      { e: '🤟', n: 'love you' },
      { e: '🤘', n: 'rock horns' },
      { e: '👏', n: 'clap applause' },
      { e: '🙌', n: 'raise hands praise' },
      { e: '🙏', n: 'pray thanks please' },
      { e: '🤝', n: 'handshake deal' },
      { e: '💪', n: 'muscle strong flex' },
      { e: '👋', n: 'wave hi bye hello' },
      { e: '🫡', n: 'salute respect' },
      { e: '🫶', n: 'heart hands love' },
      { e: '👀', n: 'eyes look watch' },
      { e: '🧠', n: 'brain smart' },
      { e: '🔥', n: 'fire lit hot' },
      { e: '✨', n: 'sparkle shiny' },
    ],
  },
  {
    key: 'animals',
    label: 'Nature',
    icon: '🐱',
    list: [
      { e: '🐱', n: 'cat' },
      { e: '🐶', n: 'dog' },
      { e: '🦊', n: 'fox' },
      { e: '🐸', n: 'frog' },
      { e: '🐼', n: 'panda' },
      { e: '🐨', n: 'koala' },
      { e: '🦁', n: 'lion' },
      { e: '🐯', n: 'tiger' },
      { e: '🐵', n: 'monkey' },
      { e: '🐧', n: 'penguin' },
      { e: '🐢', n: 'turtle' },
      { e: '🐙', n: 'octopus' },
      { e: '🦄', n: 'unicorn' },
      { e: '🐝', n: 'bee' },
      { e: '🦋', n: 'butterfly' },
      { e: '🌸', n: 'flower blossom' },
      { e: '🌟', n: 'star glowing' },
      { e: '🌈', n: 'rainbow' },
      { e: '🌊', n: 'wave ocean water' },
      { e: '🍄', n: 'mushroom' },
    ],
  },
  {
    key: 'food',
    label: 'Food',
    icon: '🍕',
    list: [
      { e: '🍕', n: 'pizza' },
      { e: '🍔', n: 'burger' },
      { e: '🍟', n: 'fries' },
      { e: '🌮', n: 'taco' },
      { e: '🍣', n: 'sushi' },
      { e: '🍜', n: 'ramen noodles' },
      { e: '🍩', n: 'donut' },
      { e: '🍪', n: 'cookie' },
      { e: '🍰', n: 'cake' },
      { e: '🍫', n: 'chocolate' },
      { e: '🍿', n: 'popcorn' },
      { e: '🍺', n: 'beer' },
      { e: '🍻', n: 'cheers beer' },
      { e: '🥂', n: 'champagne toast' },
      { e: '☕', n: 'coffee tea' },
      { e: '🍎', n: 'apple' },
      { e: '🍌', n: 'banana' },
      { e: '🍓', n: 'strawberry' },
      { e: '🥑', n: 'avocado' },
      { e: '🌶️', n: 'pepper spicy hot' },
    ],
  },
  {
    key: 'activity',
    label: 'Activity',
    icon: '🎮',
    list: [
      { e: '🎮', n: 'game controller' },
      { e: '🕹️', n: 'joystick arcade' },
      { e: '🎧', n: 'headphones music' },
      { e: '🎵', n: 'music note' },
      { e: '🎸', n: 'guitar' },
      { e: '🎨', n: 'art paint' },
      { e: '📷', n: 'camera photo' },
      { e: '🎬', n: 'movie film' },
      { e: '⚽', n: 'soccer football' },
      { e: '🏀', n: 'basketball' },
      { e: '🎲', n: 'dice game' },
      { e: '🏆', n: 'trophy win' },
      { e: '🥇', n: 'gold medal first' },
      { e: '🎯', n: 'target dart bullseye' },
      { e: '🚀', n: 'rocket launch' },
      { e: '💡', n: 'idea lightbulb' },
      { e: '📚', n: 'books study' },
      { e: '💻', n: 'laptop computer' },
      { e: '⏰', n: 'alarm clock time' },
      { e: '🎉', n: 'party tada celebrate' },
    ],
  },
  {
    key: 'symbols',
    label: 'Symbols',
    icon: '❤️',
    list: [
      { e: '❤️', n: 'red heart love' },
      { e: '🧡', n: 'orange heart' },
      { e: '💛', n: 'yellow heart' },
      { e: '💚', n: 'green heart' },
      { e: '💙', n: 'blue heart' },
      { e: '💜', n: 'purple heart' },
      { e: '🖤', n: 'black heart' },
      { e: '🤍', n: 'white heart' },
      { e: '💔', n: 'broken heart' },
      { e: '💕', n: 'two hearts' },
      { e: '💯', n: '100 hundred perfect' },
      { e: '✅', n: 'check yes done' },
      { e: '❌', n: 'cross no wrong' },
      { e: '❓', n: 'question' },
      { e: '❗', n: 'exclamation important' },
      { e: '⭐', n: 'star favorite' },
      { e: '⚡', n: 'lightning bolt zap' },
      { e: '💥', n: 'boom collision' },
      { e: '💤', n: 'zzz sleep' },
      { e: '🔔', n: 'bell notification' },
    ],
  },
]

const ALL: Emoji[] = CATEGORIES.flatMap((c) => c.list)

// Tab key for the custom-pack section. Not a CATEGORIES entry because its
// contents are per-room and per-user rather than a static list.
const CUSTOM_CAT = '__custom'

export function EmojiPicker({
  onPick,
  onClose,
  packs,
}: {
  onPick: (emoji: string) => void
  onClose: () => void
  // MSC2545 custom packs. Passed only by surfaces that can USE an mxc key --
  // a reaction can (its key is the mxc, and the strip already renders those as
  // images), the composer cannot until inline sending lands, and offering an
  // emoji there that pastes "mxc://..." as text would be worse than not
  // offering it at all. Absent = unicode only, exactly as before.
  packs?: EmojiPack[]
}) {
  const [cat, setCat] = useState(CATEGORIES[0].key)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const q = query.trim().toLowerCase()
  const customImages = useMemo(() => {
    if (!packs?.length) return []
    // Emoticon usage only: a sticker is a different thing sent a different way.
    const out: PackImage[] = []
    for (const pack of packs) {
      for (const img of pack.images) {
        if (img.usage.includes('emoticon')) out.push(img)
      }
    }
    return out
  }, [packs])

  const shownCustom = useMemo(() => {
    if (!q) return cat === CUSTOM_CAT ? customImages : []
    return customImages.filter((i) => i.code.toLowerCase().includes(q))
  }, [q, cat, customImages])

  const shown = useMemo(() => {
    if (q) return ALL.filter((em) => em.n.includes(q))
    if (cat === CUSTOM_CAT) return []
    return CATEGORIES.find((c) => c.key === cat)?.list ?? []
  }, [q, cat])

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: 0,
        width: 300,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 12,
        fontFamily: 'var(--tc-ui-font, inherit)',
        background: 'var(--cpd-color-bg-canvas-default)',
        border: '1px solid rgba(128,128,128,0.35)',
        boxShadow: '0 10px 34px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 8, borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontSize: 13,
            padding: '6px 8px',
            borderRadius: 8,
            color: 'var(--cpd-color-text-primary)',
            background: 'var(--cpd-color-bg-subtle-secondary)',
            border: '1px solid rgba(128,128,128,0.3)',
          }}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 1fr)',
          gap: 2,
          padding: 8,
          height: 216,
          overflowY: 'auto',
          alignContent: 'start',
        }}
        className="tc-scroll"
      >
        {shownCustom.map((img) => (
          <button
            key={img.mxc + img.code}
            type="button"
            title={`:${img.code}:`}
            // The KEY of a custom-emoji reaction is the mxc itself (MSC2545),
            // which is exactly what the reaction strip already knows how to
            // render as an image.
            onClick={() => onPick(img.mxc)}
            style={{
              aspectRatio: '1',
              display: 'grid',
              placeItems: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              padding: 3,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {/* viaHomeserver, like avatars (D-bf01) -- see Reactions.tsx: a
                pack emoji has no post behind it, so the content gateway has
                nothing to authorize and refuses it. */}
            <AuthedImage mxc={img.mxc} width={180} fill transparentLoading alt={`:${img.code}:`} fallback="?" viaHomeserver />
          </button>
        ))}
        {shown.length === 0 && shownCustom.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--cpd-color-text-secondary)', padding: 8 }}>
            No emoji match "{query}".
          </div>
        ) : (
          shown.map((em) => (
            <button
              key={em.e + em.n}
              type="button"
              title={em.n}
              onClick={() => onPick(em.e)}
              style={{
                aspectRatio: '1',
                fontSize: 20,
                lineHeight: 1,
                display: 'grid',
                placeItems: 'center',
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                padding: 0,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cpd-color-bg-subtle-secondary)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {em.e}
            </button>
          ))
        )}
      </div>

      {!q && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-around',
            padding: '4px 6px',
            borderTop: '1px solid rgba(128,128,128,0.2)',
            background: 'var(--cpd-color-bg-subtle-secondary)',
          }}
        >
          {customImages.length > 0 && (
            <button
              key={CUSTOM_CAT}
              type="button"
              title="Custom emoji"
              onClick={() => setCat(CUSTOM_CAT)}
              style={{
                fontSize: 16,
                lineHeight: 1,
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                padding: '4px 6px',
                opacity: cat === CUSTOM_CAT ? 1 : 0.55,
              }}
            >
              {'\u2605'}
            </button>
          )}
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              title={c.label}
              onClick={() => setCat(c.key)}
              style={{
                fontSize: 17,
                lineHeight: 1,
                padding: '5px 6px',
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                opacity: cat === c.key ? 1 : 0.55,
                filter: cat === c.key ? 'none' : 'grayscale(0.4)',
              }}
            >
              {c.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
