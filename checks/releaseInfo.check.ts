// release.json is read, never trusted: a version renders only when it is a
// CalVer, and every other state names itself instead of passing for a release.
//
// WHAT THIS CANNOT SEE: that deploy.sh writes the file this parses, or that
// the served site returns it. deploy.sh --promote checks the served
// /release.json against the version it assigned.
import { parseReleaseInfo, releaseLabel } from '../src/client/releaseInfo.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const promoted = parseReleaseInfo({ release: '20261010-014657-823bd86', commit: '823bd86', version: '2026.10.10' })
check('a promoted release parses', promoted?.version === '2026.10.10')
check('and labels with its version and commit', promoted !== null && releaseLabel(promoted) === 'Version 2026.10.10 (823bd86)', promoted && releaseLabel(promoted))
check('a second promote that day is a version too', parseReleaseInfo({ release: 'r', commit: 'c', version: '2026.10.10.2' })?.version === '2026.10.10.2')

const preview = parseReleaseInfo({ release: '20261010-014657-823bd86', commit: '823bd86', version: null })
check('a preview parses with no version', preview !== null && preview.version === null)
check('and says it is not yet a release', preview !== null && releaseLabel(preview).startsWith('Preview build 823bd86'), preview && releaseLabel(preview))

check('an HTML page (a missing file falls back to index.html) is not one', parseReleaseInfo('<!doctype html>') === null)
check('a version that is not CalVer is refused', parseReleaseInfo({ release: 'r', commit: 'c', version: '1.0.0' }) === null)
check('a missing commit is refused', parseReleaseInfo({ release: 'r', version: null }) === null)
check('null is refused', parseReleaseInfo(null) === null)

check('unreadable names itself', releaseLabel('unreadable').startsWith('Build unknown'))
check('dev names itself', releaseLabel('dev') === 'Development build')

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
