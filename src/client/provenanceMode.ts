// Provenance mode (tc.154; canon docs/design/TC_PROVENANCE_MODE.md): rest the
// pointer on a piece of the interface and a box lists the decisions and fixes
// that shaped it. This module is the part that decides; ui/ProvenanceLayer.tsx
// renders what it decides.
//
// Pure: no DOM, no React, no storage. Loaded by checks/provenanceMode.check.ts.

// ---------------------------------------------------------------------------
// WHERE IT EXISTS (operator, 2026-11-28, P2): on the preview site only, plus
// any dev server. Production never offers it, whatever a browser has stored:
// the host decides, and the stored switch is read only where the host allows.
// A promote ships the preview's exact build to production, so a build flag
// cannot tell the two apart; the page's host can.
// ---------------------------------------------------------------------------

export const PROVENANCE_HOST = 'build.tc.41chan.net'

export function provenanceAvailable(hostname: unknown, dev: unknown): boolean {
  return dev === true || hostname === PROVENANCE_HOST
}

// ---------------------------------------------------------------------------
// THE SWITCH AND THE DWELL. Both per browser, deliberately not in account
// data: the mode exists only on the preview host, so a setting that followed
// the account to production would follow it to a place it means nothing.
// Only the exact string "1" is on.
//
// The dwell is a setting with a default of 800 ms (operator, 2026-11-28, P1).
// A stored value that is not a whole number of milliseconds inside the range
// is ignored and the default used: a broken setting must never make the box
// open on every twitch of the pointer, or never.
// ---------------------------------------------------------------------------

export const PROVENANCE_ON_KEY = 'net.41chan.provenance_mode'
export const PROVENANCE_DWELL_KEY = 'net.41chan.provenance_dwell_ms'
export const PROVENANCE_SHEEN_PREVIEW_KEY = 'net.41chan.provenance_sheen_preview'

export const DWELL_DEFAULT_MS = 800
export const DWELL_MIN_MS = 200
export const DWELL_MAX_MS = 5000
export const DWELL_STEP_MS = 100

export function provenanceOn(raw: string | null): boolean {
  return raw === '1'
}

export function parseDwell(raw: string | null): number {
  if (raw === null || !/^\d{1,5}$/.test(raw)) return DWELL_DEFAULT_MS
  const n = Number(raw)
  if (n < DWELL_MIN_MS || n > DWELL_MAX_MS) return DWELL_DEFAULT_MS
  return n
}

// What a person typed or dragged, made into a value the setting accepts.
export function clampDwell(n: number): number {
  if (!Number.isFinite(n)) return DWELL_DEFAULT_MS
  const stepped = Math.round(n / DWELL_STEP_MS) * DWELL_STEP_MS
  return Math.min(DWELL_MAX_MS, Math.max(DWELL_MIN_MS, stepped))
}

// ---------------------------------------------------------------------------
// WHICH ELEMENT. Components that have provenance carry data-prov="<key>"
// (spec sec 4): stable names, not file paths, so a refactor does not break
// them. The innermost keyed element wins; each widen (Alt) steps one keyed
// ancestor outward, and stops at the outermost.
// ---------------------------------------------------------------------------

export const PROV_KEY_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/

export function validProvKey(key: unknown): key is string {
  return typeof key === 'string' && key.length <= 64 && PROV_KEY_RE.test(key)
}

// The keys from the innermost keyed element outward, given the data-prov
// values met walking up from the pointer's target (null where an element has
// none). An invalid key is skipped, not trusted.
export function keyChain(attrs: readonly (string | null)[]): string[] {
  return attrs.filter(validProvKey)
}

export function pickKey(chain: readonly string[], widen: number): { key: string; depth: number } | null {
  if (chain.length === 0) return null
  const depth = Math.min(Math.max(0, Math.floor(widen)), chain.length - 1)
  return { key: chain[depth], depth }
}

// ---------------------------------------------------------------------------
// WHAT THE BOX SAYS (spec sec 3.3, 3.4). The map from key to rows is written
// by the roadmap exporter (canon tools/status-export.py, spec sec 4); until it
// is, the map is empty and every box says so plainly rather than inventing a
// history. Each line carries the row's Public line, never anything else.
// ---------------------------------------------------------------------------

export interface ProvLine {
  // Roadmap id (tc.154); the horizon anchor is keyed on it.
  id: string
  date?: string
  text: string
  // A fix may show its bug id (operator, 2026-11-28, P7).
  bug?: string
}

export interface ProvRecord {
  origin?: ProvLine
  decisions?: ProvLine[]
  fixes?: ProvLine[]
  // An element with no row of its own names the key it inherits from and
  // which sentences of that piece's description apply (spec sec 3.4).
  inheritsFrom?: string
  highlight?: readonly (readonly [number, number])[]
  // The description of the piece, for a box that shows an inference.
  description?: string
}

export type ProvenanceMap = Readonly<Record<string, ProvRecord>>

export type ProvAnswer =
  | { kind: 'recorded'; key: string; origin: ProvLine | null; decisions: ProvLine[]; fixes: ProvLine[] }
  | { kind: 'inferred'; key: string; from: string; description: string; highlight: readonly (readonly [number, number])[] }
  | { kind: 'none'; key: string; mapEmpty: boolean }

const byDateAsc = (a: ProvLine, b: ProvLine) => (a.date ?? '').localeCompare(b.date ?? '')

export function provenanceFor(map: ProvenanceMap, key: string): ProvAnswer {
  const rec = Object.hasOwn(map, key) ? map[key] : undefined
  if (rec && (rec.origin || rec.decisions?.length || rec.fixes?.length)) {
    return {
      kind: 'recorded',
      key,
      origin: rec.origin ?? null,
      // Decisions oldest first, fixes newest first (spec sec 3.3).
      decisions: [...(rec.decisions ?? [])].sort(byDateAsc),
      fixes: [...(rec.fixes ?? [])].sort(byDateAsc).reverse(),
    }
  }
  if (rec?.inheritsFrom && Object.hasOwn(map, rec.inheritsFrom)) {
    const parent = map[rec.inheritsFrom]
    if (parent.description) {
      return {
        kind: 'inferred',
        key,
        from: rec.inheritsFrom,
        description: parent.description,
        highlight: validSpans(rec.highlight ?? [], parent.description.length),
      }
    }
  }
  return { kind: 'none', key, mapEmpty: Object.keys(map).length === 0 }
}

// Highlight spans are half-open [start, end) character offsets into the
// parent description, sorted and non-overlapping; anything else is dropped,
// so a bad span highlights nothing rather than the wrong words.
export function validSpans(spans: readonly (readonly [number, number])[], length: number): [number, number][] {
  const out: [number, number][] = []
  let last = 0
  for (const [s, e] of spans) {
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < last || e <= s || e > length) continue
    out.push([s, e])
    last = e
  }
  return out
}

// The description cut into plain and highlighted runs, in order.
export function highlightRuns(text: string, spans: readonly (readonly [number, number])[]): { text: string; mark: boolean }[] {
  const runs: { text: string; mark: boolean }[] = []
  let at = 0
  for (const [s, e] of validSpans(spans, text.length)) {
    if (s > at) runs.push({ text: text.slice(at, s), mark: false })
    runs.push({ text: text.slice(s, e), mark: true })
    at = e
  }
  if (at < text.length) runs.push({ text: text.slice(at), mark: false })
  return runs
}

// Where a roadmap id lands on horizon. Rows anchor on their roadmap id
// (operator, 2026-11-28, P8; fourier-domain 76e7cf7 render-docs _anchor):
// "tc.154" -> #tc.154, the id verbatim.
export const HORIZON_URL = 'https://41chan.net/horizon/'

export function horizonHref(id: string): string | null {
  if (!/^[a-z]+\.\d+$/.test(id)) return null
  return `${HORIZON_URL}#${id}`
}
