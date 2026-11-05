// Lists the commits a promote would ship that touch src/ and carry no
// Release-note, so a miss shows while it can still be fixed.
//
//   node tools/release/missing-notes.ts <since-commit> <commit>
//
// Always exits 0 when it could read the log: this warns, it does not refuse
// (announcement.ts `unannounced` says why). Exits 2 when git cannot read that
// stretch, because saying nothing then would read as "no notes are missing".
import { execFileSync } from 'node:child_process'
import { LOG_FORMAT, unannounced } from './announcement.ts'

const [since, commit] = process.argv.slice(2)
if (!since || !commit) {
  console.error('usage: missing-notes.ts <since-commit> <commit>')
  process.exit(2)
}
let log: string
try {
  log = execFileSync('git', ['log', '--reverse', '--name-only', `--format=${LOG_FORMAT}`, `${since}..${commit}`], { encoding: 'utf8' })
} catch {
  console.error(`could not read ${since}..${commit}: is ${since} in this checkout? Try git fetch.`)
  process.exit(2)
}
const missing = unannounced(log)
if (missing.length > 0) {
  console.log('>> no Release-note on these commits, which touch src/ (a warning: comment-only changes land here too):')
  for (const m of missing) console.log(`     ${m}`)
  console.log('>> if a user would notice one, commit its note and publish a new preview before promoting;')
  console.log('>> once promoted, ./deploy.sh --announce <notes-file> sends the corrected list.')
}
