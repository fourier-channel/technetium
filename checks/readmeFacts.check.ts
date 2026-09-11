// The README must name every VITE_* variable the client reads and every
// npm script a contributor can run. Summaries rot while module headers stay
// true (org README sweep, 2026-09-11); this holds the front page to the code.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const root = new URL('..', import.meta.url).pathname
const readme = readFileSync(join(root, 'README.md'), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}
const vars = new Set<string>()
for (const f of walk(join(root, 'src'))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) vars.add(m[1])
}
check('the client reads at least one VITE_ variable', vars.size > 0)
const missingVars = [...vars].sort().filter((v) => !readme.includes('`' + v + '`'))
check('every VITE_* the client reads is in the README', missingVars.length === 0, missingVars)

const scripts = Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {})
const missingScripts = scripts.filter((s) => !readme.includes('npm run ' + s) && !readme.includes('`' + s + '`'))
check('every npm script is in the README', missingScripts.length === 0, missingScripts)

if (failures > 0) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nall readmeFacts checks passed')
