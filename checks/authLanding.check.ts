// The sign-in landing opens doors; it does not walk anyone through anything.
//
// Operator, 2026-09-27: "Tc's onboarding is *replaced* with these MAS changes.
// It's moving Fourier's instructions from before the login flow, onto the
// login flow itself." Fourier-chan now speaks on the MAS pages (synapse-deploy
// mas/templates). These read the source: they catch the walkthrough returning
// and the Create account door losing its way to MAS's register page.
import { readFileSync, existsSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const src = (p: string) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')

const landing = src('onboarding/AuthLanding.tsx')
check('the guided walkthrough is gone from the landing', !/GuidedFlow|FourierChan|'guided'/.test(landing))
check('and from the tree', !existsSync(new URL('../src/onboarding/GuidedFlow.tsx', import.meta.url)) &&
  !existsSync(new URL('../src/onboarding/FourierChan.tsx', import.meta.url)))
check('Create account asks for the register page, Log in for the login page',
  /onClick=\{\(\) => onProceed\('create'\)\}/.test(landing) && /onClick=\{\(\) => onProceed\(\)\}/.test(landing))
check('App hands the intent to login', /<AuthLanding onProceed=\{\(intent\) => login\(intent\)\} \/>/.test(src('App.tsx')))
const authz = src('client/oidcAuthorize.ts')
check('the authorize request carries prompt=create only when asked',
  /\.\.\.\(opts\.prompt \? \{ prompt: opts\.prompt \} : \{\}\)/.test(authz))
check('login passes its intent through as the prompt', /prompt: intent,/.test(src('client/ClientContext.tsx')))

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nauth landing: all checks passed')
