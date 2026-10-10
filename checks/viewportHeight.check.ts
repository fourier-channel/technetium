// No height in src/ is a bare vh: on a phone 100vh is the screen with the
// browser toolbar HIDDEN, so a full-height shell in vh runs under the toolbar
// while it shows, and the composer sat below the fold (operator, 2026-10-10).
// Every vh height in CSS must be overridden by a dvh/svh one in the next
// declaration (the fallback pattern); an inline style cannot carry a fallback,
// so a vh there is refused outright -- use .tc-screen / .tc-screen-min.
//
// WHAT THIS CANNOT SEE: a phone. It proves the source never sizes by the
// largest viewport; that the composer is then on screen is a real-device check.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const root = new URL('../src/', import.meta.url).pathname
const files: string[] = []
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(css|tsx|ts)$/.test(f)) files.push(p)
  }
}
walk(root)

const HEIGHT_VH = /(^|[^-\w])(min-|max-)?height\s*:\s*[^;]*\b\d+vh\b/i
const offenders: string[] = []
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const rel = f.slice(root.length) + ':' + (i + 1)
    if (f.endsWith('.css')) {
      if (!HEIGHT_VH.test(line)) return
      const prop = /((?:min-|max-)?height)\s*:/i.exec(line)![1].toLowerCase()
      // The override is the same property, in dvh or svh, as the next declaration.
      const next = lines.slice(i + 1).find((l) => l.trim() !== '') ?? ''
      const sameLine = new RegExp(`${prop}\\s*:[^;]*\\d+[ds]vh`, 'i').test(line.slice(line.toLowerCase().indexOf(prop) + prop.length))
      const overridden = sameLine || new RegExp(`(^|[^-\\w])${prop}\\s*:[^;]*\\d+[ds]vh`, 'i').test(next)
      if (!overridden) offenders.push(rel + '  ' + line.trim())
    } else if (/(height|Height)\s*:\s*['"`][^'"`]*\b\d+vh\b/.test(line)) {
      offenders.push(rel + '  ' + line.trim())
    }
  })
}
check('no height in src/ is a bare vh', offenders.length === 0, '\n    ' + offenders.join('\n    '))

const css = readFileSync(join(root, 'index.css'), 'utf8')
check('.tc-screen is the visible height, with its fallback', /\.tc-screen \{ height: 100vh; height: 100dvh; \}/.test(css))
check('the app shell uses it', /className="tc-screen"/.test(readFileSync(join(root, 'App.tsx'), 'utf8')))
check('the keyboard resizes the page on Android', /interactive-widget=resizes-content/.test(readFileSync(new URL('../index.html', import.meta.url), 'utf8')))

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
