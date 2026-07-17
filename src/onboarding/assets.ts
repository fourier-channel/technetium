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
  // Fourier-chan (L3 guided flow). Placeholder text doubles as future caption.
  fourierGreeting: {
    text: "Hi — I'm Fourier-chan. Let's get you signed in. I'll be right here.",
    alt: 'Fourier-chan',
  },
} satisfies Record<string, Asset>

export type OnboardingAssetKey = keyof typeof ONBOARDING_ASSETS
