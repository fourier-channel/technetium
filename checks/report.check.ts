// Checks for the deliberate-swallow reporter.
import { reportAlways, reportIgnored, resetReportedScopes } from '../src/client/report.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const lines: string[] = []
const realWarn = console.warn
console.warn = (...a: unknown[]) => { lines.push(a.join(' ')) }

console.log('\n-- reportIgnored --')
{
  resetReportedScopes(); lines.length = 0
  reportIgnored('settings: save', new Error('quota exceeded'))
  check('logs once', lines.length === 1)
  check('names the scope', lines[0].includes('settings: save'))
  check('carries the reason', lines[0].includes('quota exceeded'))
  check('is greppable', lines[0].includes('[tc] ignored failure'))

  // A localStorage write that fails once fails every time; a drag loses
  // capture many times a second. Neither should flood the console.
  reportIgnored('settings: save', new Error('quota exceeded'))
  reportIgnored('settings: save', new Error('quota exceeded'))
  check('deduped per scope', lines.length === 1, lines.length)

  reportIgnored('other: thing', new Error('x'))
  check('a different scope still logs', lines.length === 2)
}

console.log('\n-- error shapes --')
{
  resetReportedScopes(); lines.length = 0
  reportIgnored('a', { httpStatus: 403, errcode: 'M_FORBIDDEN', message: 'nope' })
  check('http status included', lines[0].includes('HTTP 403'))
  check('errcode included', lines[0].includes('M_FORBIDDEN'))
  check('message included', lines[0].includes('nope'))

  resetReportedScopes(); lines.length = 0
  reportIgnored('b', 'a bare string')
  check('non-Error values survive', lines[0].includes('a bare string'))

  resetReportedScopes(); lines.length = 0
  reportIgnored('c', null)
  check('null does not throw', lines.length === 1)
  resetReportedScopes(); lines.length = 0
  reportIgnored('d', undefined)
  check('undefined does not throw', lines.length === 1)
}

console.log('\n-- reportAlways --')
{
  resetReportedScopes(); lines.length = 0
  reportAlways('room: leave', new Error('boom'))
  reportAlways('room: leave', new Error('boom'))
  check('NOT deduped -- each occurrence matters', lines.length === 2)
}

console.warn = realWarn
console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
