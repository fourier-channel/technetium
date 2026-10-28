// What Fourier-chan says in #botsbotsbots when a version goes live (operator,
// 2026-10-13: "Build number, most recent fixes/features").
//
// THE NOTES ARE WRITTEN WHEN THE WORK LANDS, not at promote: a commit that
// changes something a user sees carries a trailer line
//
//   Release-note: Tap a room's topic to read all of it.
//
// in plain words for users, and a promote collects every such line since the
// last live build. A commit with none (plumbing, docs, hydration) says
// nothing to users. A note is one line; the template adds the dash.
//
// Her voice is canon (fourier-chan canon/voice.md): warm, concise, one DSP
// metaphor at most, plain text with light markdown. NO ADDRESS of any kind:
// a bot never posts a URL or host (memory bots-never-post-addresses), so a
// note naming one is refused here rather than said in the room. ASCII here,
// like all committed content; the room renders it as typed.
//
// Her sign-off says where a problem goes: !bugreport in the help room or a
// DM with her (client/bugReport.ts, the beta notice's words too). It used to
// say "right here in this room" -- #botsbotsbots, where the intake does not
// listen (tc.149).
//
// Pure, so checks/releaseAnnouncement holds it.
import { BUG_REPORT } from '../../src/client/bugReport.ts'

const TRAILER = /^Release-note:[ \t]*(.+?)[ \t]*$/gm
const ADDRESS = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:net|com|org|io|dev|app)\b|\b\d{1,3}(?:\.\d{1,3}){3}\b)/i

/** Every Release-note trailer in a stretch of `git log --format=%B` output, in order, once each. */
export function releaseNotes(log: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of log.matchAll(TRAILER)) {
    const note = m[1].trim()
    if (note && !seen.has(note)) {
      seen.add(note)
      out.push(note)
    }
  }
  return out
}

/** A note that names an address, or null when none does. */
export function addressIn(notes: readonly string[]): string | null {
  return notes.find((n) => ADDRESS.test(n)) ?? null
}

export function announcement(version: string, commit: string, notes: readonly string[]): string {
  const lines = [`Signal found! Technetium ${version} is live.`, '']
  if (notes.length > 0) {
    lines.push("What's new:")
    for (const n of notes) lines.push(`- ${n}`)
  } else {
    lines.push("This one's tuning under the hood -- nothing new to learn, just a cleaner signal.")
  }
  lines.push('', `Spot something off? Send ${BUG_REPORT.command} with what you did and what you saw, in ${BUG_REPORT.room} or in a DM with me.`, `(build ${commit})`)
  return lines.join('\n')
}
