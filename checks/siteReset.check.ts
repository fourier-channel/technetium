// Purge and hard refresh on every Technetium screen, signed out included
// (PIP2 claims sweep 2026-10-04, operator remedy 2: the rectangle was
// "absent on ... Technetium's signed-out screen"). ONE component, mounted in
// each place -- a second copy is the drift this is guarding against.
//
// These read the source: they prove where the component is mounted and that
// nothing in it needs a session, not that it draws (tools/visual/session.html
// renders the landing's markup against the real stylesheet).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const root = fileURLToPath(new URL('../', import.meta.url))
const read = (p: string) => readFileSync(join(root, p), 'utf8')
function walk(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((n) => {
    const p = `${dir}/${n}`
    return statSync(join(root, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []
  })
}

const app = read('src/App.tsx')
const landing = read('src/onboarding/AuthLanding.tsx')
const reset = read('src/ui/SiteReset.tsx')

console.log('== one component')
{
  const defs = walk('src').filter((f) => /function SiteReset\b|const SiteReset\b/.test(read(f)))
  check('SiteReset is defined once, in ui/SiteReset.tsx', defs.length === 1 && defs[0] === 'src/ui/SiteReset.tsx', defs)
  const drawn = walk('src').filter((f) => f !== 'src/ui/SiteReset.tsx' && /PURGE_ICON|REFRESH_ICON|className="tc-site-reset"/.test(read(f)))
  check('and nobody else draws the rectangle by hand', drawn.length === 0, drawn)
}

console.log('== mounted signed in AND signed out')
{
  check('the signed-out screen is the landing', /if \(status === 'awaiting_login'\) \{[\s\S]{0,300}return <AuthLanding /.test(app))
  check('the landing imports the one component', /import \{ SiteReset \} from '\.\.\/ui\/SiteReset'/.test(landing))
  check('and mounts it', /<SiteReset \/>/.test(landing))
  check('above the sign-out strip, inside the column (in flow, always there)',
    landing.indexOf('<SiteReset />') > 0 && landing.indexOf('<SiteReset />') < landing.indexOf('<SignOutStatus />'))
  const errorBranch = app.slice(app.indexOf("if (status === 'error') {"), app.indexOf("if (status === 'starting'"))
  check('the error screen, where a purge that could not finish reports, mounts it too', /<SiteReset \/>/.test(errorBranch), errorBranch.slice(0, 200))
  const shell = app.slice(app.indexOf('<div className="tc-me">'))
  check('and the signed-in header still does', /<SiteReset \/>/.test(shell.slice(0, shell.indexOf('/>\n      {/*'))))
}

console.log('== nothing in it needs a session')
{
  check('it reads only purge from the context, never the client', /const \{ purge \} = useClient\(\)/.test(reset) && !/\bclient\b/.test(reset.replace(/\/\/.*$/gm, '').replace(/^import .*$/gm, '').replace(/useClient/g, '')))
  const ctx = read('src/client/ClientContext.tsx')
  const purge = ctx.slice(ctx.indexOf('const purge = async'), ctx.indexOf('// The server has rejected'))
  check('and purge does not stop at a missing client', !/if \(!client|if \(!clientRef\.current|if \(!c\)/.test(purge))
  const end = ctx.slice(ctx.indexOf('function endSession('), ctx.indexOf('const logout ='))
  check('nor does the sign-out it starts with (every client use is optional)', !/if \(!c\) return|if \(!client\) return/.test(end) && /c\?\.stopClient\(\)/.test(end))
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nsite reset: all checks passed')
