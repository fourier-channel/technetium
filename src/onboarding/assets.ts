// ---------------------------------------------------------------------------
// Onboarding asset slots (CD-13: one variable, many uses).
//
// Each visual is ONE `Asset`: `text` is the placeholder shown NOW and the
// caption/subtext for the real image LATER -- same var, both uses, so there is
// no separate "placeholder string" to drift from the eventual caption. `src` is
// the "Image TBD" drop-in: fill it when the real art (or an mxc) arrives.
//
// Resolution follows the go-fish rule (CD-10): a slot is usable if it has a
// non-empty `src` (one cheap boolean check); otherwise the `text` stands in.
// A slot never throws and never blocks a render -- worst case it degrades to
// its own caption text.
// ---------------------------------------------------------------------------

export interface Asset {
  /** "Image TBD" drop-in: an image URL or mxc. Absent until the art lands. */
  src?: string
  /** Placeholder NOW, caption/subtext LATER. Always present. */
  text: string
  /** Optional alt override; defaults to `text`. */
  alt?: string
}

// Single-bit fitness check (go-fish): is there a usable image, or not?
export function hasImage(a: Asset | undefined): a is Asset & { src: string } {
  return !!a && typeof a.src === 'string' && a.src.length > 0
}

// Named onboarding slots. Add `src` in place when the real art arrives; the
// same `text` becomes its caption automatically.
export const ONBOARDING_ASSETS = {
  logo: { text: 'Technetium', alt: 'Technetium' },
  // Fourier-chan portraits per guided-flow step. Each `text` is her line now AND
  // that image's caption later -- one var, both uses. Drop `src` in when the art
  // lands and nothing else changes.
  fourierWelcome: {
    text: "Hi! I'm Fourier-chan. I'll get you set up — it's quick, and you can skip to the form whenever you like.",
    alt: 'Fourier-chan, waving hello',
  },
  fourierWhat: {
    text: "This is 41chan's home, built on Matrix — an open chat network. Your account is yours; nobody owns your identity but you.",
    alt: 'Fourier-chan explaining the network',
  },
  fourierAccount: {
    text: "Next you'll make your account on our secure sign-in. Pick a name and a password you like — I'll be right here.",
    alt: 'Fourier-chan pointing at a sign-in form',
  },
  fourierRooms: {
    text: "Once you're in, every public room is already waiting. Click any room in the list to join it — that's it.",
    alt: 'Fourier-chan gesturing at a room list',
  },
  fourierReady: {
    text: "That's the whole map! Ready when you are — let's make your account.",
    alt: 'Fourier-chan giving a thumbs up',
  },
} satisfies Record<string, Asset>

export type OnboardingAssetKey = keyof typeof ONBOARDING_ASSETS

// Quote slots: placeholder text NOW, real 41chan master-doc / devlog quotes
// LATER (same var, both uses). `null` means "no quote on this step yet" -- the
// step just renders without one (silent-null, CD-9), never a broken blank.
export const ONBOARDING_QUOTES: Record<string, string | null> = {
  what: 'Quote TBD — a line from the 41chan master document on what the community is.',
  rooms: 'Quote TBD — a devlog line on public rooms being open by design.',
}

