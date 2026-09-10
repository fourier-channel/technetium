// Checks for reading the approval URL out of Synapse's 401.
//
// The body below is VERBATIM from the deployed server on 2026-09-10, captured
// while running E11 against a throwaway account. Before it was read, the reset
// failed with "[401] Unknown message" -- matrix-js-sdk could not name the
// error because that body carries no errcode at all.
import { crossSigningResetUrl, needsApproval } from '../src/client/uiaReset.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const REAL = {
  session: 'dummy',
  flows: [{ stages: ['m.oauth'] }, { stages: ['org.matrix.cross_signing_reset'] }],
  params: {
    'm.oauth': { url: 'https://auth.41chan.net/account/?action=org.matrix.cross_signing_reset' },
    'org.matrix.cross_signing_reset': { url: 'https://auth.41chan.net/account/?action=org.matrix.cross_signing_reset' },
  },
}

console.log('== the real body')
check('the approval URL is found',
  crossSigningResetUrl(REAL) === 'https://auth.41chan.net/account/?action=org.matrix.cross_signing_reset')
check('a 401 carrying it means APPROVAL, not failure',
  needsApproval({ httpStatus: 401, data: REAL }))
check('the same body on a non-401 does not',
  !needsApproval({ httpStatus: 500, data: REAL }))
check('a 401 with no oauth stage is a real failure, not an approval prompt',
  !needsApproval({ httpStatus: 401, data: { flows: [{ stages: ['m.login.password'] }] } }))

console.log('\n== only the reset stage is honoured')
check('the org.matrix stage alone works',
  crossSigningResetUrl({ params: { 'org.matrix.cross_signing_reset': { url: 'https://auth.41chan.net/x' } } })
    === 'https://auth.41chan.net/x')
check('an unrelated stage is ignored',
  crossSigningResetUrl({ params: { 'm.login.sso': { url: 'https://auth.41chan.net/nope' } } }) === null)

console.log('\n== this URL is opened in the user browser, so it is not trusted blindly')
for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://auth.41chan.net/x', '//evil.example', '']) {
  check(`${JSON.stringify(bad)} is refused`,
    crossSigningResetUrl({ params: { 'm.oauth': { url: bad } } }) === null)
}
check('a non-string url is refused',
  crossSigningResetUrl({ params: { 'm.oauth': { url: 7 } } }) === null)

console.log('\n== junk')
for (const j of [null, undefined, {}, { params: null }, { params: 'x' }, { params: { 'm.oauth': null } }, 'string']) {
  check(`${JSON.stringify(j) ?? String(j)} yields null`, crossSigningResetUrl(j) === null)
}
check('needsApproval on junk is false',
  !needsApproval(null) && !needsApproval({}) && !needsApproval({ httpStatus: 401 }))

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
