// Where the beta notice sends a bug report (tc.149): Talk to Fourier on the
// horizon page (operator 2026-11-02, "Bug reports are directed to /horizon/"),
// from the one place that holds it (client/bugReport.ts).
//
// The page is fourier-domain sites/41chan.net/horizon/index.html, read from
// the checkout beside this one (or TC_HORIZON_PAGE). A missing file is a
// FAILURE with the remedy, not a skip: a check that cannot see the page
// cannot say the anchor and the heading are still there.
//
// WHAT THIS CANNOT SEE: that the served page is that file, that the intake
// behind it is up, or that a report filed there reaches `coherence bugs`.
// That is the roadmap entry's step 4, a fresh account following the notice.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BUG_REPORT } from '../src/client/bugReport.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const url = new URL(BUG_REPORT.url)
check('the address is the horizon page on the main site, over https',
  url.protocol === 'https:' && url.host === '41chan.net' && url.pathname === '/horizon/', BUG_REPORT.url)
check('the address lands on the intake section', url.hash === '#intake', url.hash)

// The section's id and heading, as the page's source carries them. The
// heading is matched on the element the section names as its label, so a
// "Talk to Fourier" anywhere else on the page does not count.
function intakeHeading(html: string, id: string): string | null {
  const section = new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)
  if (!section) return null
  const labelled = /\baria-labelledby="([^"]+)"/.exec(section[0])
  if (!labelled) return null
  const head = new RegExp(`<h[1-6]\\b[^>]*\\bid="${labelled[1]}"[^>]*>([^<]*)</h[1-6]>`).exec(html.slice(section.index))
  return head ? head[1].trim() : null
}
{
  const page = '<p>Talk to Fourier</p><section id="intake" aria-labelledby="h"><h2 id="h">Talk to Fourier</h2></section>'
  check('the reader finds a section\'s heading by its label', intakeHeading(page, 'intake') === 'Talk to Fourier')
  check('the reader refuses a page with no such section', intakeHeading(page.replace('id="intake"', 'id="other"'), 'intake') === null)
  check('the reader refuses a section whose label is gone', intakeHeading(page.replace(' aria-labelledby="h"', ''), 'intake') === null)
}

const pagePath = process.env.TC_HORIZON_PAGE
  ?? fileURLToPath(new URL('../../fourier-domain/sites/41chan.net/horizon/index.html', import.meta.url))
if (!existsSync(pagePath)) {
  check('the horizon page source is readable', false,
    `\n       ${pagePath} is missing. Check out fourier-domain beside technetium, or set ` +
    'TC_HORIZON_PAGE to its sites/41chan.net/horizon/index.html.')
} else {
  const heading = intakeHeading(readFileSync(pagePath, 'utf8'), url.hash.slice(1))
  check(`the page has the section the address points at, headed "${BUG_REPORT.section}"`,
    heading === BUG_REPORT.section, heading)
}

const banner = readFileSync(new URL('../src/ui/BetaBanner.tsx', import.meta.url), 'utf8')
const code = banner.replace(/^\s*\/\/.*$/gm, '')
check('the notice links the address from client/bugReport.ts',
  /import \{ BUG_REPORT \} from '\.\.\/client\/bugReport'/.test(banner) && /href=\{BUG_REPORT\.url\}/.test(code))
check('the link is a client link, opens a new tab and hands the page no opener',
  /className="tc-link" href=\{BUG_REPORT\.url\} target="_blank" rel="noopener noreferrer"/.test(code))
check('the notice names the section and the page from the same place',
  ['section', 'page'].every((k) => code.includes(`{BUG_REPORT.${k}}`)))
check('the notice sends nobody to a room or a command',
  !/#botsbotsbots|!bugreport|matrix help/.test(code))
check('the notice spells no address or heading by hand',
  !code.includes('41chan.net') && !code.includes(BUG_REPORT.section))

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
