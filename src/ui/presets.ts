// Named layouts, and which one a device starts from.
//
// Operator ruling 2026-09-06: "we update the layout port UI to store multiple
// values and allow swapping between them at will. The current system allows me
// to create what I think a good UI looks like and then save that hash, and we
// can input it as the Default Preset. mobile browser ID = default to Mobile
// preset."
//
// Pure on purpose: the account-data shape is the thing most likely to arrive
// malformed (hand-edited, written by an older build, or half-synced), and the
// answer to every malformed field is a sane default rather than a throw.
import { DEFAULT_OVERFLOW, type OverflowMode } from './space'

export interface Preset { name: string; code: string }

export interface LayoutStore {
  code: string
  presets: Preset[]
  defaultPreset: string | null
  mobilePreset: string | null
  overflow: OverflowMode
}

export const MAX_PRESETS = 24
export const MAX_NAME = 40

export const emptyStore = (): LayoutStore =>
  ({ code: '', presets: [], defaultPreset: null, mobilePreset: null, overflow: DEFAULT_OVERFLOW })

export function cleanName(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
}

const isCode = (v: unknown): v is string => typeof v === 'string' && /^\d{1,120}$/.test(v.trim())

// Read whatever is in account data. A legacy `{ code }` -- every account today
// -- reads as a store with no presets, which is exactly what it is.
export function readStore(content: unknown): LayoutStore {
  const s = emptyStore()
  if (!content || typeof content !== 'object') return s
  const c = content as Record<string, unknown>
  if (isCode(c.code)) s.code = String(c.code).trim()
  if (Array.isArray(c.presets)) {
    for (const raw of c.presets) {
      if (!raw || typeof raw !== 'object') continue
      const p = raw as Record<string, unknown>
      const name = cleanName(p.name)
      if (!name || !isCode(p.code)) continue
      if (s.presets.some((x) => x.name === name)) continue
      s.presets.push({ name, code: String(p.code).trim() })
      if (s.presets.length >= MAX_PRESETS) break
    }
  }
  const known = (v: unknown) => {
    const n = cleanName(v)
    return n && s.presets.some((p) => p.name === n) ? n : null
  }
  s.defaultPreset = known(c.defaultPreset)
  s.mobilePreset = known(c.mobilePreset)
  s.overflow = c.overflow === 'layer' ? 'layer' : 'replace'
  return s
}

export function writeStore(s: LayoutStore): Record<string, unknown> {
  return {
    code: s.code,
    presets: s.presets.map((p) => ({ name: p.name, code: p.code })),
    defaultPreset: s.defaultPreset,
    mobilePreset: s.mobilePreset,
    overflow: s.overflow,
  }
}

// Save under a name, replacing any preset already using it. Saving over the
// one a device starts from is allowed and is the point: it is how you revise
// "Mobile" without re-pointing anything at it.
export function putPreset(s: LayoutStore, name: string, code: string): LayoutStore {
  const n = cleanName(name)
  if (!n || !isCode(code)) return s
  const presets = s.presets.filter((p) => p.name !== n)
  if (presets.length >= MAX_PRESETS) return s
  return { ...s, presets: [...presets, { name: n, code: code.trim() }].sort((a, b) => a.name.localeCompare(b.name)) }
}

// Removing a preset also un-points anything that named it: a device default
// referring to a preset that is gone would silently fall through to something
// else, which reads as the setting being ignored.
export function dropPreset(s: LayoutStore, name: string): LayoutStore {
  const n = cleanName(name)
  return {
    ...s,
    presets: s.presets.filter((p) => p.name !== n),
    defaultPreset: s.defaultPreset === n ? null : s.defaultPreset,
    mobilePreset: s.mobilePreset === n ? null : s.mobilePreset,
  }
}

const pointAt = (s: LayoutStore, key: 'defaultPreset' | 'mobilePreset', name: string | null): LayoutStore => {
  const n = name === null ? null : cleanName(name)
  if (n !== null && !s.presets.some((p) => p.name === n)) return s
  return { ...s, [key]: n }
}
export const setDefaultPreset = (s: LayoutStore, name: string | null) => pointAt(s, 'defaultPreset', name)
export const setMobilePreset = (s: LayoutStore, name: string | null) => pointAt(s, 'mobilePreset', name)
export const setOverflow = (s: LayoutStore, mode: OverflowMode): LayoutStore => ({ ...s, overflow: mode })

export const findPreset = (s: LayoutStore, name: string): Preset | null =>
  s.presets.find((p) => p.name === cleanName(name)) ?? null

// Which layout this device opens on: its own preset if one is pointed at it,
// then the default preset, then the last live layout.
export function startingCode(s: LayoutStore, isMobile: boolean): string {
  const named = isMobile ? s.mobilePreset : s.defaultPreset
  const preferred = named ? findPreset(s, named) : null
  if (preferred) return preferred.code
  const fallback = s.defaultPreset ? findPreset(s, s.defaultPreset) : null
  if (fallback) return fallback.code
  return s.code
}

// Is this a phone-shaped browser? The user agent when it says so, and
// otherwise a touch-primary pointer on a narrow screen, because several
// mobile browsers now report a desktop agent by default.
export function isMobileBrowser(env: { ua?: string; coarsePointer?: boolean; width?: number }): boolean {
  const ua = env.ua ?? ''
  if (/Android|iPhone|iPad|iPod|Windows Phone|IEMobile|Mobile Safari|Silk/i.test(ua)) return true
  return !!env.coarsePointer && (env.width ?? Number.POSITIVE_INFINITY) <= 820
}

// ---- Back to the default, from the address bar ---------------------------
//
// The Layout controls and the site reset live in panels a user can put away,
// and the layout is account data every device reads, so a layout can hide
// every way back to itself on every device at once. `?preset=default` is the
// way in no layout can hide (operator, 2026-10-19). It loses nothing:
// "Applying default should make a save of the previous state and then save
// the default as current preset."

export const DEFAULT_PRESET = 'Default'
const RESET_PARAM = 'preset'

// The query string, never the fragment: one place, the one the login's
// ?code&state already uses.
export function wantsDefaultReset(search: string): boolean {
  return new URLSearchParams(search).get(RESET_PARAM)?.trim().toLowerCase() === 'default'
}

// This address without the reset, as a path, so a reload does not reset again
// and a link copied from the bar does not carry it.
export function withoutResetParam(href: string): string {
  const u = new URL(href)
  u.searchParams.delete(RESET_PARAM)
  return u.pathname + u.search + u.hash
}

// Minutes, local time: what the person who just reset will recognise.
export function resetStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export type DefaultReset =
  | { kind: 'reset'; store: LayoutStore; kept: Preset[] }
  // Refused, and nothing written: saving the earlier layout needs `needed`
  // presets and MAX_PRESETS is the ceiling. Resetting anyway would drop it.
  | { kind: 'full'; needed: number }

// Everything the reset overwrites is saved first, unless a preset already
// holds it: the live layout, and a "Default" preset of the user's own. Then the
// default is the live layout, the Default preset, and what THIS kind of device
// (phone or not) starts from -- so a start preset pointed at the layout that
// hid everything cannot bring it back on the next load.
export function resetToDefault(s: LayoutStore, defaultCode: string, isMobile: boolean, stamp: string): DefaultReset {
  if (!isCode(defaultCode)) throw new Error(`resetToDefault: ${JSON.stringify(defaultCode)} is not a layout code`)
  const keep: Preset[] = []
  const heldElsewhere = (code: string, except?: string) =>
    s.presets.some((p) => p.code === code && p.name !== except) || keep.some((p) => p.code === code)
  const freeName = (base: string) => {
    const taken = (n: string) => s.presets.some((p) => p.name === n) || keep.some((p) => p.name === n)
    let n = cleanName(base)
    for (let i = 2; taken(n); i++) n = cleanName(`${base} (${i})`)
    return n
  }
  if (isCode(s.code) && s.code !== defaultCode && !heldElsewhere(s.code)) {
    keep.push({ name: freeName(`Before reset ${stamp}`), code: s.code })
  }
  const own = findPreset(s, DEFAULT_PRESET)
  if (own && own.code !== defaultCode && !heldElsewhere(own.code, own.name)) {
    keep.push({ name: freeName(`Default before ${stamp}`), code: own.code })
  }
  const needed = s.presets.length + keep.length + (own ? 0 : 1)
  if (needed > MAX_PRESETS) return { kind: 'full', needed }

  let next = s
  for (const p of keep) next = putPreset(next, p.name, p.code)
  next = putPreset(next, DEFAULT_PRESET, defaultCode)
  next = isMobile ? setMobilePreset(next, DEFAULT_PRESET) : setDefaultPreset(next, DEFAULT_PRESET)
  return { kind: 'reset', store: { ...next, code: defaultCode }, kept: keep }
}
