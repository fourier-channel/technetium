// The timeline row's shape, and the spacing of the lines between rows.
//
// Launch-polish L11, operator 2026-09-25: "I regret that we are going back to
// the old Discord-style 'avatar on the left, name on the top right, text under
// name'" -- and, asked, the avatar on the FIRST message of a run only. L10, the
// same day: about half "the space between status update lines and date
// changes".
//
// L12, 2026-09-26: "the avatar moves down each time to 'speak' the new line
// ... the previous lines then lose their speech arrows".
//
// Most of these read the source, so they prove the text and not the rendering; the
// rendering is looked at in tools/visual/rows.html. What they catch is the
// shape drifting back: the name returning above the avatar, the avatar
// returning to every line, or a follow-up line regaining the avatar's height.
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const timeline = readFileSync(new URL('../src/ui/Timeline.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

// The Row component's JSX, from its return to the footer.
const row = /const head = item\.showHeader !== false[\s\S]*?<RowFooter/.exec(timeline)?.[0] ?? ''

console.log('== the Discord shape (L11)')
check('Row is found', row.length > 0)
const col = row.indexOf('className="tc-row-col"')
const ident = row.indexOf('<SenderIdentity')
check('the name is INSIDE the text column, beside the avatar -- not above the row line',
  col > 0 && ident > col, { col, ident })
check('the name is only on the first message of a run', /\{head && !narrow && \(\s*<SenderIdentity/.test(row))
check('the name comes before the reply pill and the body', ident < row.indexOf('<ReplyPill') && ident < row.indexOf('tc-bubble'))
check('the avatar picture is only on the line it is speaking -- the run\'s newest (L12)',
  /\{speaks && <AvatarDisc /.test(row) && !/\n\s*<AvatarDisc /.test(row))
check('every line keeps its interaction anchor, picture or not',
  /className="tc-row-av"\s*\n\s*data-user-anchor=\{senderId\}/.test(row))
check('only the speaking line\'s avatar box is a control',
  /role=\{speaks && openProfile \? 'button' : undefined\}/.test(row) &&
  /tabIndex=\{speaks && openProfile \? 0 : undefined\}/.test(row))
check('the lines the avatar has left lose their arrow, not their bubble',
  /data-tail=\{bubble && !speaks && !narrow \? 'off' : undefined\}/.test(row) &&
  /\.tc-bubble\[data-tail='off'\]::before,\s*\n\.tc-bubble\[data-tail='off'\]::after \{\s*content: none;/.test(css))
check('the avatar travels from the line that had it, by transform, and not under reduced motion',
  /speakerByRun\.get\(runHead\)/.test(timeline) && /if \(!was \|\| was === item\.id \|\| reducedMotion\) return/.test(timeline) &&
  /el\.animate\(\[\{ transform: `translateY\(\$\{dy\}px\)` \}/.test(timeline))
check('the narrow thread panel keeps its one-line user line', /\{head && narrow && \(\s*[\s\S]*?<SenderUserLine/.test(row))

console.log('== a line the avatar has left is as tall as its text')
const lineRule = /\n\.tc-row-line \{([^}]*)\}/.exec(css)?.[1] ?? ''
check('the row line itself has no avatar-height floor', lineRule.length > 0 && !/min-height/.test(lineRule), lineRule)
check('only the speaking line keeps it',
  /\.tc-row\[data-speaker='true'\] > \.tc-row-line \{\s*min-height: var\(--tc-av-w\);/.test(css))
check('the empty avatar box of a line it has left is as tall as the line, not the picture',
  /\.tc-row:not\(\[data-speaker='true'\]\) \.tc-row-av \{\s*height: 100%;/.test(css))

console.log('== which line speaks: applyLayout, on real runs (L12)')
{
  const { applyLayout } = await import('../src/client/useTimeline.ts')
  const T0 = 1_700_000_000_000
  let n = 0
  const msg = (sender: string, dt: number, extra: Record<string, unknown> = {}) => {
    const id = '$e' + n++
    return { id, kind: 'message', content: {}, event: { getSender: () => sender, getTs: () => T0 + dt, getId: () => id }, ...extra }
  }
  const member = (dt: number) => {
    const id = '$m' + n++
    return { id, kind: 'member', content: {}, event: { getSender: () => 'x', getTs: () => T0 + dt, getId: () => id } }
  }
  // a a a | b | a (after a join) | a a
  const items = [msg('a', 0), msg('a', 1000), msg('a', 2000), msg('b', 3000), member(4000), msg('a', 5000), msg('a', 6000)]
  const out = applyLayout(items as never) as Array<{ id: string; kind: string; runTail?: boolean; runHead?: string; showHeader?: boolean }>
  const rows = out.filter((i) => i.kind === 'message')
  const tails = rows.map((r) => r.runTail)
  check('only the newest line of each run speaks', JSON.stringify(tails) === JSON.stringify([false, false, true, true, false, true]), tails)
  check('every line knows its run\'s first message',
    rows[1].runHead === rows[0].id && rows[2].runHead === rows[0].id && rows[3].runHead === rows[3].id && rows[5].runHead === rows[4].id,
    rows.map((r) => r.runHead))
  check('a membership row ends a run: the line before it speaks', rows[3].runTail === true)
  check('day and membership rows carry no run fields', out.filter((i) => i.kind !== 'message').every((i) => i.runTail === undefined))
  const single = applyLayout([msg('c', 99_000_000)] as never) as Array<{ kind: string; runTail?: boolean }>
  check('a run of one speaks its only line', single.find((i) => i.kind === 'message')?.runTail === true)
}

console.log('== status lines and date changes, about half (L10)')
const px = (re: RegExp) => [...(re.exec(css)?.slice(1) ?? [])].map(Number)
const [dTop, dBottom] = px(/\.tc-day-separator \{[^}]*margin: ([\d.]+)px 0 ([\d.]+)px;/)
check('the date divider\'s margins are half the 10px / 6px they were', dTop <= 5 && dBottom <= 3, { dTop, dBottom })
const [mTop, mBottom] = px(/\.tc-member-row \{[^}]*padding: ([\d.]+)px 0 ([\d.]+)px 16px;/)
check('a status line\'s padding is half the 3px it was', mTop <= 1.5 && mBottom <= 1.5, { mTop, mBottom })

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nrow shape: all checks passed')
