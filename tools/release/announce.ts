// Prints the release announcement for deploy.sh to hand to Fourier-chan.
//
//   node tools/release/announce.ts <version> <commit> <since-commit|-> [notes-file]
//
// The notes are the Release-note trailers of <since>..<commit> (announcement.ts
// says why); `-` means no earlier live build, so there are none to diff. A
// notes file, one note per line, replaces them -- for a release whose commits
// predate the trailers. Exits 2, saying which, when a note names an address:
// she must never post one.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { addressIn, announcement, releaseNotes } from './announcement.ts'

const [version, commit, since, notesFile] = process.argv.slice(2)
if (!version || !commit || !since) {
  console.error('usage: announce.ts <version> <commit> <since-commit|-> [notes-file]')
  process.exit(2)
}
const notes = notesFile
  ? readFileSync(notesFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  : since === '-'
    ? []
    : releaseNotes(execFileSync('git', ['log', '--reverse', '--format=%B', `${since}..${commit}`], { encoding: 'utf8' }))
const bad = addressIn(notes)
if (bad) {
  console.error(`a release note names an address, which a bot must never post: "${bad}". Reword it and announce again.`)
  process.exit(2)
}
process.stdout.write(announcement(version, commit, notes) + '\n')
