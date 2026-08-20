'use strict'

// Plain-node checks for the shell's two pure modules. No test framework: these
// are pure functions with table-driven cases, and the root project's own
// `checks/` are standalone harnesses run the same way.
//
// Both tables exist because the behaviour they pin was got WRONG first, live,
// and neither failure was visible by reading the code:
//   - argv: Chromium hoists switches ahead of positional args
//   - nav:  the identity provider lives on a host the first allow-list missed

const { parseArgv } = require('../quickqueue')
const { isFirstParty } = require('../navpolicy')

const APP_PATH = '/opt/technetium/resources/app'
const APP_ORIGIN = 'https://tc.41chan.net'

const argvCases = [
  ['dev, flag last', ['electron', '.', '--qq', '/a.png', '/b.png'], 2],
  ['chromium-reordered', ['electron', '--qq', '.', '/a.png', '/b.png', '/c.png'], 3],
  ['packaged, no dot', ['Technetium.exe', '--qq', 'C:\\a.png'], 1],
  ['app path spelled out', ['electron', '--qq', APP_PATH, '/a.png'], 1],
  ['no flag at all', ['electron', '.', '/a.png'], 0],
  ['chromium switch trails', ['electron', '--qq', '.', '--disable-gpu', '/a.png'], 1],
  ['flag but empty selection', ['electron', '--qq', '.'], 0],
]

const navCases = [
  ['app origin itself', 'https://tc.41chan.net/room/x', true],
  ['MAS issuer', 'https://auth.41chan.net/authorize?x=1', true],
  ['homeserver', 'https://matrix.41chan.net/_matrix/x', true],
  ['media gateway', 'https://mxc.41chan.net/media/a/b', true],
  ['apex', 'https://41chan.net/', true],
  ['suffix impersonation', 'https://tc.41chan.net.evil.tld/', false],
  ['lookalike domain', 'https://evil-41chan.net/', false],
  ['plain external link', 'https://example.com/thread', false],
  ['http downgrade', 'http://auth.41chan.net/', false],
]

let failed = 0
const report = (ok, label, detail) => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(26)} ${detail}`)
}

console.log('-- quickqueue.parseArgv')
for (const [name, argv, want] of argvCases) {
  const got = parseArgv(argv, APP_PATH)
  report(got.length === want, name, `${got.length}/${want} ${JSON.stringify(got)}`)
}

console.log('-- navpolicy.isFirstParty')
for (const [name, url, want] of navCases) {
  const got = isFirstParty(url, APP_ORIGIN)
  report(got === want, name, `${got} ${url}`)
}

// A dev origin has no meaningful sibling zone; it must not inherit a suffix rule.
report(isFirstParty('https://auth.41chan.net/', 'http://localhost:5173') === false,
  'localhost has no siblings', 'false')
report(isFirstParty('http://localhost:5173/cb', 'http://localhost:5173') === true,
  'localhost matches itself', 'true')

console.log(failed === 0 ? '\nALL CHECKS PASS' : `\n${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
