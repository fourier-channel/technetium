// The stylesheet scanner shared by cssAnimations.check.ts (an infinite
// animation touches transform and opacity only) and reducedMotionAudit.check.ts
// (every infinite animation answers prefers-reduced-motion). Lifted out of the
// first with no change in what it finds (tc.113): one reading of the sources,
// so the two checks can never disagree about which animations exist.
//
// The parsing is deliberately crude -- regex over the sources rather than a
// CSS parser -- and it is crude in the SAFE direction: it collects every
// @keyframes block it can see and every line mentioning `infinite`, and
// anything it cannot resolve is handed back as unresolved rather than skipped.
// A rule that silently covers less than it appears to is rule 1 of the
// doctrine violated by the tool meant to enforce it.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Declarations that are not animated properties: they steer the animation
// itself, or they are the custom properties a keyframe reads.
export const IGNORED = (prop: string) => prop.startsWith('--') || prop === 'animation-timing-function'

export function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.(css|tsx|ts)$/.test(name)) out.push(p)
  }
  return out
}

// Every source under `dir`, keyed by path. `${...}` inside a CSS-in-JS
// template puts braces in the middle of a declaration, which no brace-counting
// matcher can nest through -- it is what made @keyframes uitransform-ants
// invisible on the first run. The value is never a property name, so blanking
// it loses nothing.
export function readSources(dir: string): Map<string, string> {
  const text = new Map<string, string>()
  for (const f of sources(dir)) text.set(f, readFileSync(f, 'utf8').replace(/\$\{[^{}]*\}/g, '0'))
  return text
}

// Comments talk ABOUT the rule, at length, and a line of prose is not a
// declaration. Block comments are blanked ACROSS lines (newlines kept, so the
// reported line numbers still point at the source) rather than per line, which
// was the first version and read the middle of every paragraph as code.
export function uncomment(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
}

export interface Frames { name: string; file: string; props: Set<string> }

// Every @keyframes block anywhere in the sources, and any name defined twice.
export function scanKeyframes(text: Map<string, string>): { frames: Map<string, Frames>; dupes: string[] } {
  const frames = new Map<string, Frames>()
  const dupes: string[] = []
  for (const [file, src] of text) {
    // Non-greedy to the matching close of the LAST inner block. Keyframes are
    // one level deep (percent selectors), so counting one nesting level is
    // enough and is what keeps this from needing a parser.
    const re = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      const name = m[1]
      // Comments are not declarations here either. Found by a keyframes block
      // whose comment read "Rotation only: the gradient ..." -- the colon made
      // `only` a property and the swirl was reported as animating it.
      const body = uncomment(m[2])
      const props = new Set<string>()
      const pre = /(^|[{;\s])([a-zA-Z-]+)\s*:/g
      let p: RegExpExecArray | null
      while ((p = pre.exec(body)) !== null) {
        const prop = p[2].toLowerCase()
        if (!IGNORED(prop)) props.add(prop)
      }
      if (frames.has(name)) dupes.push(name)
      frames.set(name, { name, file, props })
    }
  }
  return { frames, dupes }
}

export interface Use { name: string; file: string; line: number; snippet: string }
export interface Unresolved { file: string; line: number; snippet: string }

// Every place something is asked to run forever, tied to the keyframes it
// names. Cross-file, because a component's <style> block can drive a class
// defined in index.css and the reverse.
export function scanInfinite(text: Map<string, string>, frames: Map<string, Frames>): { infinite: Use[]; unresolved: Unresolved[] } {
  const infinite: Use[] = []
  const unresolved: Unresolved[] = []
  for (const [file, src] of text) {
    const lines = uncomment(src).split('\n')
    lines.forEach((line, i) => {
      if (!/\binfinite\b/.test(line)) return
      const named = [...frames.keys()].filter((n) => new RegExp(`\\b${n}\\b`).test(line))
      if (named.length === 0) {
        unresolved.push({ file, line: i + 1, snippet: line.trim().slice(0, 100) })
        return
      }
      for (const n of named) infinite.push({ name: n, file, line: i + 1, snippet: line.trim().slice(0, 100) })
    })
  }
  return { infinite, unresolved }
}
