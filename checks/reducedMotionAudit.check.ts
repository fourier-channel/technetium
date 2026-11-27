// tc.113: every infinite CSS animation answers prefers-reduced-motion.
//
// The scanner (checks/_cssAnim.ts) is the one cssAnimations.check.ts uses, so
// the two checks agree on which animations exist. For each place something is
// asked to run forever, this check demands ONE of:
//
//   (a) css      a `@media (prefers-reduced-motion: reduce)` rule in the SAME
//                file that stops it and wins the cascade: it reaches the same
//                element (its one compound is a subset of the use's rightmost
//                compound, same pseudo-element, or it is the use's selector
//                verbatim) and it is !important, more specific, or equally
//                specific and later. A stylesheet rule that would lose to the
//                use is not an override, whatever it says. An INLINE use
//                (style={{ animation: '...' }}) can only be stopped by an
//                !important rule on a class or data- attribute its element
//                carries.
//   (b) script   an inline use whose value is gated by a name bound from
//                useReducedMotion() / prefersReducedMotion() (ui/reducedMotion.ts)
//                in the right polarity: `reduced ? <none> : '... infinite'` or
//                `!reduced && '... infinite'`. The name merely appearing is not
//                a gate. A stylesheet RULE is not covered by a component's
//                decision to apply its class: the rule outlives that decision
//                (the tcHonorPulse comment in index.css says why), so a rule
//                needs (a), (c) or (d).
//   (c) token    the duration is var(--x) and a reduce block sets --x on :root
//                to zero. This is how canon (formant-tokens.css) stops the
//                Modulation motion; a zero-length iteration does not tick.
//   (d) opt-in   the use sits inside `@media (prefers-reduced-motion:
//                no-preference)`.
//
// Anything else FAILS with file:line. EXEMPT entries carry a reason; one that
// no longer matches a use, or whose use is now covered anyway, fails too, so
// the list cannot outlive what it excuses.
//
// What this does NOT prove: that a browser honours the media query (it is the
// stylesheet and the source that are read, not a rendered page), or that a
// `:root` token is not overridden closer to the element. The live OS setting is
// PENDING OPERATOR VERIFICATION.
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { readSources, scanInfinite, scanKeyframes, uncomment, type Use } from './_cssAnim.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// Keyed by `<path under src>:<keyframes name>`. Empty today: every use found
// has a real answer. An entry needs a reason a reviewer can disagree with.
const EXEMPT: Record<string, string> = {}

// --- small CSS reading -----------------------------------------------------

/** Index of the `}` that closes the `{` at `open`, or -1. */
function closeOf(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return i
  }
  return -1
}

/** [start, end) spans of every `@media (...)` block whose query matches `q`. */
function mediaBlocks(text: string, q: RegExp): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const re = /@media[^{;]*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (!q.test(m[0])) continue
    const open = m.index + m[0].length - 1
    const close = closeOf(text, open)
    if (close > open) out.push([open + 1, close])
  }
  return out
}
const REDUCE = /prefers-reduced-motion\s*:\s*reduce/
const NO_PREF = /prefers-reduced-motion\s*:\s*no-preference/

interface Rule { selectors: string[]; decls: Array<[string, string]>; at: number }

/** The flat rules inside a span (one level: reduce blocks hold plain rules). */
function rulesIn(text: string, [start, end]: [number, number]): Rule[] {
  const body = text.slice(start, end)
  const out: Rule[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d): [string, string] => {
      const i = d.indexOf(':')
      return [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()]
    })
    out.push({ selectors, decls, at: start + m.index })
  }
  return out
}

/** Does this rule stop an animation, and is that stop !important? */
function stops(decls: Array<[string, string]>): { stops: boolean; important: boolean } {
  let s = false
  let imp = false
  for (const [prop, raw] of decls) {
    const important = /!important\s*$/.test(raw)
    const v = raw.replace(/!important\s*$/, '').trim()
    const hit =
      (prop === 'animation' && !/\binfinite\b/.test(v)) ||
      (prop === 'animation-name' && v === 'none') ||
      (prop === 'animation-play-state' && v === 'paused') ||
      (prop === 'animation-iteration-count' && /^\d/.test(v)) ||
      (prop === 'animation-duration' && /^0(?:m?s)?$/.test(v))
    if (hit) { s = true; if (important) imp = true }
  }
  return { stops: s, important: imp }
}

function specificity(sel: string): [number, number, number] {
  const ids = (sel.match(/#[\w-]+/g) ?? []).length
  const pe = (sel.match(/::[\w-]+/g) ?? []).length
  const rest = sel.replace(/::[\w-]+/g, '')
  const b = (rest.match(/\.[\w-]+/g) ?? []).length + (rest.match(/\[[^\]]*\]/g) ?? []).length +
    (rest.match(/:[\w-]+/g) ?? []).length
  const tags = (rest.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length
  return [ids, b, tags + pe]
}
const cmp = (x: number[], y: number[]) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]

interface Compound { classes: Set<string>; attrs: Set<string>; pseudoEl: string; pseudoCls: number }
function compound(c: string): Compound {
  return {
    classes: new Set((c.match(/\.[\w-]+/g) ?? []).map((x) => x.slice(1))),
    attrs: new Set((c.match(/\[\s*[\w-]+/g) ?? []).map((x) => x.replace(/^\[\s*/, ''))),
    pseudoEl: (c.match(/::[\w-]+/) ?? [''])[0],
    pseudoCls: (c.replace(/::[\w-]+/g, '').match(/:[\w-]+/g) ?? []).length,
  }
}
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const rightmost = (s: string) => norm(s).split(/\s*[\s>+~]\s*/).pop() ?? ''
const subset = <T,>(a: Set<T>, b: Set<T>) => [...a].every((x) => b.has(x))

/** Does override selector `o` reach every element use selector `s` styles? */
function reaches(o: string, s: string): boolean {
  if (norm(o) === norm(s)) return true
  if (/[\s>+~]/.test(norm(o))) return false
  const oc = compound(o)
  const sc = compound(rightmost(s))
  return oc.pseudoCls === 0 && oc.pseudoEl === sc.pseudoEl && (oc.classes.size + oc.attrs.size) > 0 &&
    subset(oc.classes, sc.classes) && subset(oc.attrs, sc.attrs)
}

// --- the audit -------------------------------------------------------------

export interface Verdict { use: Use; how: string | null }

export function audit(text: Map<string, string>, exempt: Record<string, string>) {
  const { frames } = scanKeyframes(text)
  const { infinite, unresolved } = scanInfinite(text, frames)
  const plain = new Map([...text].map(([f, s]) => [f, uncomment(s)]))

  // (c): every custom property a reduce block zeroes on :root, any file.
  const zeroed = new Set<string>()
  for (const src of plain.values()) {
    for (const span of mediaBlocks(src, REDUCE)) {
      for (const r of rulesIn(src, span)) {
        if (!r.selectors.some((s) => s === ':root')) continue
        for (const [p, v] of r.decls) if (p.startsWith('--') && /^0(?:m?s)?$/.test(v)) zeroed.add(p)
      }
    }
  }

  const verdicts: Verdict[] = infinite.map((use) => {
    const src = plain.get(use.file) ?? ''
    const lines = src.split('\n')
    const lineText = lines[use.line - 1] ?? ''
    const col = lineText.search(new RegExp(`\\b${use.name}\\b`))
    const at = lines.slice(0, use.line - 1).reduce((n, l) => n + l.length + 1, 0) + col
    const before = lineText.slice(0, col)

    if (mediaBlocks(src, NO_PREF).some(([a, b]) => at >= a && at < b)) return { use, how: '(d) inside no-preference' }

    const tok = new RegExp(`\\b${use.name}\\s+var\\((--[\\w-]+)`).exec(lineText)
    if (tok && zeroed.has(tok[1])) return { use, how: `(c) ${tok[1]} zeroed on :root` }

    const reduceRules = mediaBlocks(src, REDUCE).flatMap((span) => rulesIn(src, span))
    const inline = /['"`]$/.test(before)

    if (inline) {
      // (b) a gate from the hook, in the right polarity, on this value.
      const hooked = /import\s*\{[^}]*\b(?:useReducedMotion|prefersReducedMotion)\b[^}]*\}\s*from\s*'[^']*reducedMotion'/.test(src)
      if (hooked) {
        const gates = [...src.matchAll(/const\s+(\w+)\s*=\s*(?:useReducedMotion|prefersReducedMotion)\(\)/g)].map((m) => m[1])
        for (const g of gates) {
          const neg = new RegExp(`\\b${g}\\s*\\?[^?:]*:\\s*['"\`]$`)
          const pos = new RegExp(`!\\s*${g}\\s*(?:&&|\\?)\\s*['"\`]$`)
          if (neg.test(before) || pos.test(before)) return { use, how: `(b) gated by ${g}` }
        }
      }
      // (a) an !important rule on what the element carries. The element is
      // the nearest JSX tag opening at or above the use line, through the
      // end of that tag.
      let top = use.line - 1
      while (top > 0 && top > use.line - 40 && !/<[A-Za-z]/.test(lines[top])) top--
      let bottom = use.line - 1
      while (bottom < lines.length - 1 && bottom < use.line + 20 && !/\/?>\s*$/.test(lines[bottom]) &&
        !/^\s*>/.test(lines[bottom + 1] ?? '')) bottom++
      const tag = lines.slice(top, bottom + 2).join('\n')
      const classes = new Set((tag.match(/className="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean))
      const attrs = new Set([...tag.matchAll(/\s(data-[\w-]+)/g)].map((m) => m[1]))
      for (const r of reduceRules) {
        const st = stops(r.decls)
        if (!st.stops || !st.important) continue
        for (const o of r.selectors) {
          if (/[\s>+~]/.test(norm(o))) continue
          const oc = compound(o)
          if (oc.pseudoEl || oc.pseudoCls || oc.classes.size + oc.attrs.size === 0) continue
          if (subset(oc.classes, classes) && subset(oc.attrs, attrs)) return { use, how: `(a) !important ${o}` }
        }
      }
      return { use, how: null }
    }

    // A stylesheet rule: find the selector list of the rule it sits in.
    let depth = 0
    let open = -1
    for (let i = at; i >= 0; i--) {
      if (src[i] === '}') depth++
      else if (src[i] === '{') { if (depth === 0) { open = i; break } depth-- }
    }
    if (open < 0) return { use, how: null }
    let s0 = open - 1
    while (s0 >= 0 && !'{};`'.includes(src[s0])) s0--
    const selectors = src.slice(s0 + 1, open).split(',').map((s) => s.trim()).filter(Boolean)
    const covered = selectors.length > 0 && selectors.every((s) => reduceRules.some((r) => {
      const st = stops(r.decls)
      if (!st.stops) return false
      return r.selectors.some((o) => reaches(o, s) &&
        (st.important || cmp(specificity(o), specificity(s)) > 0 || (cmp(specificity(o), specificity(s)) === 0 && r.at > at)))
    }))
    return { use, how: covered ? `(a) reduce override of ${selectors.join(', ')}` : null }
  })

  const keyOf = (u: Use) => `${u.file}:${u.name}`
  const staleExempt = Object.keys(exempt).filter((k) => !verdicts.some((v) => keyOf(v.use) === k))
  const needlessExempt = Object.keys(exempt).filter((k) => verdicts.some((v) => keyOf(v.use) === k && v.how !== null))
  for (const v of verdicts) if (v.how === null && exempt[keyOf(v.use)]) v.how = `EXEMPT: ${exempt[keyOf(v.use)]}`
  return { verdicts, staleExempt, needlessExempt, unresolved }
}

// --- the rules, proven on sources made for them -----------------------------

const KF = '@keyframes spin { to { transform: rotate(1turn); } }\n'
function one(files: Record<string, string>, exempt: Record<string, string> = {}) {
  return audit(new Map(Object.entries(files)), exempt)
}
const how = (files: Record<string, string>) => one(files).verdicts.map((v) => v.how)

console.log('\n-- the rules, on made-up sources --')
check('no answer at all fails', how({ 'a.css': KF + '.x { animation: spin 1s infinite; }' })[0] === null)
check('(a) a later reduce rule of equal weight stops it',
  how({ 'a.css': KF + '.x { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .x { animation: none; } }' })[0] !== null)
check('(a) an EARLIER reduce rule of equal weight loses the cascade',
  how({ 'a.css': KF + '@media (prefers-reduced-motion: reduce) { .x { animation: none; } }\n.x { animation: spin 1s infinite; }' })[0] === null)
check('(a) a less specific override loses: .y does not beat .p:hover .y',
  how({ 'a.css': KF + '.p:hover .y { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .y { animation: none; } }' })[0] === null)
check('(a) the same selector verbatim, later, wins',
  how({ 'a.css': KF + '.p:hover .y { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .p:hover .y { animation: none; } }' })[0] !== null)
check('(a) !important wins regardless of weight',
  how({ 'a.css': KF + '.p:hover .y { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .y { animation: none !important; } }' })[0] !== null)
check('(a) paused, a finite count or a 0s duration all stop it',
  ['animation-play-state: paused', 'animation-iteration-count: 1', 'animation-duration: 0s'].every((d) =>
    how({ 'a.css': KF + `.x { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .x { ${d}; } }` })[0] !== null))
check('(a) an override that is itself infinite stops nothing',
  how({ 'a.css': KF + '.x { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .x { animation: spin 9s infinite; } }' })[0] === null)
check('(a) a different pseudo-element is a different element',
  // !important, so the cascade cannot be what rejects it (found by mutation:
  // without it .x lost on specificity and the pseudo-element rule went untested).
  how({ 'a.css': KF + '.x::after { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .x { animation: none !important; } }' })[0] === null)
check('(a) the override must be in the SAME file',
  how({ 'a.css': KF + '.x { animation: spin 1s infinite; }', 'b.css': '@media (prefers-reduced-motion: reduce) { .x { animation: none; } }' })[0] === null)
check('(a) every selector in the list must be answered',
  how({ 'a.css': KF + '.x, .z { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .x { animation: none; } }' })[0] === null)
check('(a) a rule in some other @media is not a reduce rule',
  how({ 'a.css': KF + '.x { animation: spin 1s infinite; }\n@media (max-width: 9px) { .x { animation: none; } }' })[0] === null)
check('(c) a :root token zeroed under reduce, in any file',
  how({ 'a.css': KF + '.x { animation: spin var(--p) linear infinite; }', 't.css': '@media (prefers-reduced-motion: reduce) { :root { --p: 0s; } }' })[0] !== null)
check('(c) a token set to a non-zero value does not count',
  how({ 'a.css': KF + '.x { animation: spin var(--p) linear infinite; }', 't.css': '@media (prefers-reduced-motion: reduce) { :root { --p: 2s; } }' })[0] === null)
check('(c) a token zeroed outside a reduce block does not count',
  how({ 'a.css': KF + '.x { animation: spin var(--p) linear infinite; }', 't.css': ':root { --p: 0s; }' })[0] === null)
check('(d) a use inside no-preference is opt-in already',
  how({ 'a.css': KF + '@media (prefers-reduced-motion: no-preference) { .x { animation: spin 1s infinite; } }' })[0] !== null)
const HOOK = "import { useReducedMotion } from './reducedMotion'\nconst reduced = useReducedMotion()\n"
check('(b) inline, gated the right way round',
  how({ 'k.css': KF, 'C.tsx': HOOK + "const s = { animation: reduced ? undefined : 'spin 1s infinite' }" })[0] !== null)
check('(b) inline, !gate && form',
  how({ 'k.css': KF, 'C.tsx': HOOK + "const s = { animation: !reduced && 'spin 1s infinite' }" })[0] !== null)
check('(b) inline, gated the WRONG way round, fails',
  how({ 'k.css': KF, 'C.tsx': HOOK + "const s = { animation: reduced ? 'spin 1s infinite' : undefined }" })[0] === null)
check('(b) the same gate without the hook import fails',
  how({ 'k.css': KF, 'C.tsx': "const reduced = useReducedMotion()\nconst s = { animation: reduced ? undefined : 'spin 1s infinite' }" })[0] === null)
check('(b) a stylesheet rule is not covered by a hook in its file',
  how({ 'k.css': KF, 'C.tsx': HOOK + '<style>{`.x { animation: spin 1s infinite; }`}</style>' })[0] === null)
check('(a) inline, an !important rule on its class',
  how({ 'k.css': KF, 'C.tsx': '<style>{`@media (prefers-reduced-motion: reduce) { .bar { animation: none !important; } }`}</style>\n<span\n  className="bar"\n  style={{ animation: `spin 1s infinite` }}\n/>' })[0] !== null)
check('(a) inline, an !important rule on its data- attribute',
  how({ 'k.css': KF, 'C.tsx': '<style>{`@media (prefers-reduced-motion: reduce) { [data-f] { animation: none !important; } }`}</style>\n<div\n  data-f\n  style={{ animation: \'spin 1s infinite\' }}\n/>' })[0] !== null)
check('(a) inline, a rule WITHOUT !important loses to the style attribute',
  how({ 'k.css': KF, 'C.tsx': '<style>{`@media (prefers-reduced-motion: reduce) { .bar { animation: none; } }`}</style>\n<span\n  className="bar"\n  style={{ animation: `spin 1s infinite` }}\n/>' })[0] === null)
check('(a) inline, a rule on a class the element does not carry',
  how({ 'k.css': KF, 'C.tsx': '<style>{`@media (prefers-reduced-motion: reduce) { .other { animation: none !important; } }`}</style>\n<span\n  className="bar"\n  style={{ animation: `spin 1s infinite` }}\n/>' })[0] === null)
{
  const r = one({ 'a.css': KF + '.x { animation: spin 1s infinite; }' }, { 'a.css:spin': 'a reason', 'a.css:gone': 'stale' })
  check('an EXEMPT entry covers its use, with its reason shown', r.verdicts[0].how === 'EXEMPT: a reason')
  check('an EXEMPT entry that matches no use is reported stale', r.staleExempt.join() === 'a.css:gone', r.staleExempt)
  const r2 = one({ 'a.css': KF + '.x { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .x { animation: none; } }' }, { 'a.css:spin': 'no longer needed' })
  check('an EXEMPT entry whose use is covered anyway is reported needless', r2.needlessExempt.join() === 'a.css:spin', r2.needlessExempt)
}

// --- this tree -------------------------------------------------------------

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = new Map([...readSources(join(root, 'src'))].map(([f, s]) => [relative(root, f), s]))
const result = audit(src, EXEMPT)

console.log('\n-- every infinite animation in src/ answers prefers-reduced-motion --')
check('the scan found infinite animations (none at all would be a broken scan)', result.verdicts.length > 0, result.verdicts.length)
check('every infinite line names keyframes the scan can see', result.unresolved.length === 0,
  result.unresolved.map((u) => `${u.file}:${u.line}`))
for (const v of result.verdicts) {
  const where = `${v.use.file}:${v.use.line} ${v.use.name}`
  check(v.how ? `${where} -- ${v.how}` : `${where} has no reduced-motion answer: ${v.use.snippet}`, v.how !== null)
}
check('no EXEMPT entry has gone stale', result.staleExempt.length === 0, result.staleExempt)
check('no EXEMPT entry excuses a use that is covered anyway', result.needlessExempt.length === 0, result.needlessExempt)

console.log('\n-- one reading of the preference in script (D-tc01) --')
{
  const strays = [...src].filter(([f, s]) => f !== join('src', 'ui', 'reducedMotion.ts') &&
    /matchMedia\(\s*['"`]\(prefers-reduced-motion/.test(uncomment(s))).map(([f]) => f)
  check('only ui/reducedMotion.ts asks matchMedia for prefers-reduced-motion', strays.length === 0, strays)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
