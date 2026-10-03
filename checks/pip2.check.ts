// PIP2 (operator, 2026-10-03): privacy and data retention are ONE page on
// 41chan.net, Policies and Pledges, and every surface links that one page
// (canon: fourier-domain docs/PIP2.md). This client links it from the
// signed-out landing and from the purge question; both through Pip2Link, the
// one link, which reads the one address.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { PIP2_EXPANSION, PIP2_URL } from '../src/client/pip2.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const src = (p: string) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')

check('the address is 41chan.net/pip2.html', PIP2_URL === 'https://41chan.net/pip2.html')
check('the abbreviation spelled out is the operator\'s', PIP2_EXPANSION === 'Potentially Personally Identifying Information Policies and Pledges')

const link = src('ui/Pip2Link.tsx')
check('Pip2Link reads the one address and opens a new tab',
  /href=\{PIP2_URL\}/.test(link) && /target="_blank"/.test(link) && /rel="noopener noreferrer"/.test(link))
check('the signed-out landing links it, spelled out', /<Pip2Link full \/>/.test(src('onboarding/AuthLanding.tsx')))
check('the purge question links it', /<Pip2Link \/>/.test(src('ui/SiteReset.tsx')))

// No second address: nothing else in the client spells out a 41chan.net
// policy page, so a move of the page is one edit.
const offenders: string[] = []
const walk = (dir: URL) => {
  for (const name of readdirSync(dir)) {
    const u = new URL(name, dir)
    if (statSync(u).isDirectory()) walk(new URL(name + '/', dir))
    else if (/\.(ts|tsx)$/.test(name) && !u.pathname.endsWith('/client/pip2.ts') &&
      /41chan\.net\/(pip2|privacy|data-retention)\.html/.test(readFileSync(u, 'utf8'))) offenders.push(u.pathname)
  }
}
walk(new URL('../src/', import.meta.url))
check('no other file carries a policy address', offenders.length === 0, offenders)

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\npip2: all checks passed')
