import type { BubbleTone } from './bubbleTone'

// ---------------------------------------------------------------------------
// Interface Options (INTERFACE_OPTIONS IO7-IO11): how the conversation is
// drawn, chosen by the person under Settings -> Interface Options.
//
// REMEMBERED, in account data, so it follows the person to every device and
// every session (the coherence rule: a toggle keeps its state until the user
// resets it). One event holds all of it, so a preset is one write.
//
// FOREIGN INPUT, in the narrow sense: the stored content reaches CSS, and
// another client (or a hand-edited event) can put anything in it. So it is
// admitted only in the exact shapes this module writes -- a colour is
// `#rrggbb` and nothing else, a gap a whole number in range -- and anything
// else makes the whole value unreadable, which is reported and treated as no
// opinion (the defaults). Nothing here ever builds CSS from a string it did
// not make itself.
//
// Pure, so the check suite loads it (O-tp9).
// ---------------------------------------------------------------------------

export const INTERFACE_EVENT = 'net.41chan.tc.interface'

export type ChatMode = 'bubbles' | 'irc'

export interface InterfacePrefs {
  /** Bubbles (the client as designed) or IRC style (IO11). */
  mode: ChatMode
  /** The styled bubbles (IO8). Off: every line is the plain bubble. */
  styled: boolean
  /** A picked colour per tone (IO9); a tone not here keeps its default. */
  colors: Partial<Record<BubbleTone, string>>
  /** The space between messages, in whole pixels (IO10). */
  spacing: number
}

export const SPACING_MIN = 0
export const SPACING_MAX = 24
// The gap the timeline had before it was a setting: 4px above and below.
export const SPACING_DEFAULT = 8

export const TONES: readonly BubbleTone[] = ['standard', 'questioning', 'thinking', 'yelling']

export const TONE_LABEL: Record<BubbleTone, string> = {
  standard: 'Plain',
  questioning: 'Question',
  thinking: 'Thought',
  yelling: 'Exclamation',
}

// What the colour picker shows for a tone nobody has picked: the hue each
// default is drawn in (index.css), so opening the picker starts where the
// bubble already is.
export const TONE_DEFAULT_HEX: Record<BubbleTone, string> = {
  standard: '#808080',
  questioning: '#6096dc',
  thinking: '#aaa8a0',
  yelling: '#e8805c',
}

// Each tone's strengths: a picked colour is drawn at the same fill and
// outline alphas as that tone's default, so a picked colour still reads as
// that tone (a shout stays louder than a thought).
export const TONE_ALPHA: Record<BubbleTone, { bg: number; line: number; ring?: number }> = {
  standard: { bg: 0.14, line: 0.28 },
  questioning: { bg: 0.16, line: 0.42 },
  thinking: { bg: 0.24, line: 0.55 },
  yelling: { bg: 0.26, line: 0.75, ring: 0.45 },
}

export const DEFAULT_PREFS: InterfacePrefs = Object.freeze({
  mode: 'bubbles',
  styled: true,
  colors: Object.freeze({}),
  spacing: SPACING_DEFAULT,
}) as InterfacePrefs

const HEX = /^#[0-9a-f]{6}$/

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The stored content as prefs, or null when it is not one this client wrote.
 * Absent fields are the defaults: an older event, or one written before a
 * field existed, is still read.
 */
export function parseInterfacePrefs(content: unknown): InterfacePrefs | null {
  if (!isRecord(content)) return null
  const out: InterfacePrefs = { ...DEFAULT_PREFS, colors: {} }
  if (content.mode !== undefined) {
    if (content.mode !== 'bubbles' && content.mode !== 'irc') return null
    out.mode = content.mode
  }
  if (content.styled !== undefined) {
    if (typeof content.styled !== 'boolean') return null
    out.styled = content.styled
  }
  if (content.spacing !== undefined) {
    const n = content.spacing
    if (typeof n !== 'number' || !Number.isInteger(n) || n < SPACING_MIN || n > SPACING_MAX) return null
    out.spacing = n
  }
  if (content.colors !== undefined) {
    if (!isRecord(content.colors)) return null
    for (const [tone, hex] of Object.entries(content.colors)) {
      if (!(TONES as readonly string[]).includes(tone)) return null
      if (typeof hex !== 'string' || !HEX.test(hex)) return null
      out.colors[tone as BubbleTone] = hex
    }
  }
  return out
}

/** What is written: only what differs from the defaults, so a reset is a removal. */
export function serializeInterfacePrefs(p: InterfacePrefs): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (p.mode !== DEFAULT_PREFS.mode) out.mode = p.mode
  if (p.styled !== DEFAULT_PREFS.styled) out.styled = p.styled
  if (p.spacing !== DEFAULT_PREFS.spacing) out.spacing = p.spacing
  const colors: Record<string, string> = {}
  for (const t of TONES) if (p.colors[t]) colors[t] = p.colors[t]
  if (Object.keys(colors).length) out.colors = colors
  return out
}

export function samePrefs(a: InterfacePrefs, b: InterfacePrefs): boolean {
  if (a.mode !== b.mode || a.styled !== b.styled || a.spacing !== b.spacing) return false
  return TONES.every((t) => (a.colors[t] ?? null) === (b.colors[t] ?? null))
}

/** A colour from the picker, admitted or not: `#rrggbb`, lower case. */
export function normalizeHex(input: string): string | null {
  const v = input.trim().toLowerCase()
  return HEX.test(v) ? v : null
}

export function clampSpacing(n: number): number {
  if (!Number.isFinite(n)) return SPACING_DEFAULT
  return Math.min(SPACING_MAX, Math.max(SPACING_MIN, Math.round(n)))
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

/**
 * The custom properties the stylesheet reads. Built only from admitted values,
 * so nothing a stored event says reaches CSS as text.
 */
export function interfaceVars(p: InterfacePrefs): Record<string, string> {
  const vars: Record<string, string> = { '--tc-row-gap': `${p.spacing}px` }
  for (const tone of TONES) {
    const hex = p.colors[tone]
    if (!hex || !HEX.test(hex)) continue
    const [r, g, b] = rgb(hex)
    const a = TONE_ALPHA[tone]
    vars[`--tc-user-${tone}-bg`] = `rgba(${r}, ${g}, ${b}, ${a.bg})`
    vars[`--tc-user-${tone}-line`] = `rgba(${r}, ${g}, ${b}, ${a.line})`
    if (a.ring !== undefined) vars[`--tc-user-${tone}-ring`] = `rgba(${r}, ${g}, ${b}, ${a.ring})`
    if (tone === 'thinking') vars['--tc-user-thinking-hue'] = `rgb(${r}, ${g}, ${b})`
  }
  return vars
}

/** Every property interfaceVars can set, so a removed colour is removed. */
export const INTERFACE_VAR_NAMES: readonly string[] = [
  '--tc-row-gap',
  ...TONES.flatMap((t) => [
    `--tc-user-${t}-bg`,
    `--tc-user-${t}-line`,
    ...(TONE_ALPHA[t].ring !== undefined ? [`--tc-user-${t}-ring`] : []),
  ]),
  '--tc-user-thinking-hue',
]

/** The tone a line is drawn in: the detected one, or plain when styles are off. */
export function shownTone(detected: BubbleTone | null, p: InterfacePrefs): BubbleTone | null {
  if (detected === null) return null
  return p.styled ? detected : 'standard'
}
