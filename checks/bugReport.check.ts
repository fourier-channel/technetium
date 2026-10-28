// Where the beta notice sends a bug report (tc.149): the room it names is one
// Fourier-chan's !bugreport intake listens in, and the notice says it from the
// one place that holds it (client/bugReport.ts).
//
// The intake's rooms are fourier-coherence coherence.bugs.yaml `rooms`, read
// from the checkout beside this one (or TC_BUG_INTAKE_CONFIG). A missing file
// is a FAILURE with the remedy, not a skip: a check that cannot see the intake
// cannot say the two agree.
//
// WHAT THIS CANNOT SEE: that the room's name in the live room list is still
// the intake's label (the labels are written by hand beside room ids; checked
// against Synapse 2026-10-28), that a fresh member can join it, or that a
// report filed there reaches `coherence bugs`. That is the roadmap entry's
// end-to-end run with an unprivileged account.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BUG_REPORT } from '../src/client/bugReport.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// The `rooms:` block: `  "!id:server": label` lines up to the next top-level
// key. Anything else in the block is a shape this parser does not know, and
// fails rather than being read as no rooms.
function intakeRooms(yaml: string): Map<string, string> | string {
  const lines = yaml.split('\n')
  const start = lines.findIndex((l) => /^rooms:\s*(#.*)?$/.test(l))
  if (start < 0) return 'no top-level rooms: key'
  const rooms = new Map<string, string>()
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    if (/^\s*(#.*)?$/.test(line)) continue
    const m = /^\s+"(![^"]+)":\s*([^#]+?)\s*(#.*)?$/.exec(line)
    if (!m) return `unreadable line in rooms: ${JSON.stringify(line)}`
    rooms.set(m[1], m[2].replace(/^["']|["']$/g, ''))
  }
  return rooms.size > 0 ? rooms : 'rooms: is empty'
}

// The parser itself, on the shapes it must accept and refuse.
{
  const ok = intakeRooms('x: 1\nrooms:\n  "!a:s": booru help\n  "!b:s": "matrix help"  # c\n\nnext: 2\n  "!c:s": not mine\n')
  check('the parser reads labels, bare or quoted, and stops at the next key',
    ok instanceof Map && [...ok.values()].join('|') === 'booru help|matrix help', ok)
  check('the parser refuses a file with no rooms key', typeof intakeRooms('rooms_x:\n  "!a:s": a\n') === 'string')
  check('the parser refuses an empty rooms block', typeof intakeRooms('rooms:\nnext: 1\n') === 'string')
  check('the parser refuses a line it cannot read', typeof intakeRooms('rooms:\n  - "!a:s"\n') === 'string')
}

const configPath = process.env.TC_BUG_INTAKE_CONFIG
  ?? fileURLToPath(new URL('../../fourier-coherence/coherence.bugs.yaml', import.meta.url))
if (!existsSync(configPath)) {
  check('the intake config is readable', false,
    `\n       ${configPath} is missing. Check out fourier-coherence beside technetium, or set ` +
    'TC_BUG_INTAKE_CONFIG to its coherence.bugs.yaml.')
} else {
  const rooms = intakeRooms(readFileSync(configPath, 'utf8'))
  check('the intake config lists its rooms', rooms instanceof Map, rooms)
  if (rooms instanceof Map) {
    const labels = [...rooms.values()]
    check(`the notice's room ("${BUG_REPORT.room}") is one the intake listens in`, labels.includes(BUG_REPORT.room), labels)
  }
}

check('the room is named as the room list shows it, not as an alias', !BUG_REPORT.room.startsWith('#'))
check('the command is the one she answers to', BUG_REPORT.command === '!bugreport')

const banner = readFileSync(new URL('../src/ui/BetaBanner.tsx', import.meta.url), 'utf8')
check('the notice reads its words from client/bugReport.ts',
  /import \{ BUG_REPORT \} from '\.\.\/client\/bugReport'/.test(banner) &&
  ['command', 'room', 'space', 'guide'].every((k) => banner.includes(`{BUG_REPORT.${k}}`)))
check('the notice no longer sends reports to #botsbotsbots', !/#botsbotsbots/.test(banner.replace(/^\s*\/\/.*$/gm, '')))
check('the notice spells no room or command by hand',
  ![BUG_REPORT.command, BUG_REPORT.room, BUG_REPORT.space].some((w) => banner.replace(/^\s*\/\/.*$/gm, '').includes(w)))

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
