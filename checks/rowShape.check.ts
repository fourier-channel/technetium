// The timeline row's shape, and the spacing of the lines between rows.
//
// Launch-polish L11, operator 2026-09-25: "I regret that we are going back to
// the old Discord-style 'avatar on the left, name on the top right, text under
// name'" -- and, asked, the avatar on the FIRST message of a run only. L10, the
// same day: about half "the space between status update lines and date
// changes".
//
// These read the source, so they prove the text and not the rendering; the
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
check('the avatar picture is only on the first message of a run',
  /\{head && <AvatarDisc /.test(row) && !/\n\s*<AvatarDisc /.test(row))
check('every line keeps its interaction anchor, picture or not',
  /className="tc-row-av"\s*\n\s*data-user-anchor=\{senderId\}/.test(row))
check('only the head line\'s avatar box is a control',
  /role=\{head && openProfile \? 'button' : undefined\}/.test(row) &&
  /tabIndex=\{head && openProfile \? 0 : undefined\}/.test(row))
check('the narrow thread panel keeps its one-line user line', /\{head && narrow && \(\s*[\s\S]*?<SenderUserLine/.test(row))

console.log('== a follow-up line is as tall as its text')
const lineRule = /\n\.tc-row-line \{([^}]*)\}/.exec(css)?.[1] ?? ''
check('the row line itself has no avatar-height floor', lineRule.length > 0 && !/min-height/.test(lineRule), lineRule)
check('only the head line keeps it',
  /\.tc-row:not\(\[data-grouped='true'\]\) > \.tc-row-line \{\s*min-height: var\(--tc-av-w\);/.test(css))
check('the empty avatar box of a follow-up line is as tall as the line, not the picture',
  /\.tc-row\[data-grouped='true'\] \.tc-row-av \{\s*height: 100%;/.test(css))

console.log('== status lines and date changes, about half (L10)')
const px = (re: RegExp) => [...(re.exec(css)?.slice(1) ?? [])].map(Number)
const [dTop, dBottom] = px(/\.tc-day-separator \{[^}]*margin: ([\d.]+)px 0 ([\d.]+)px;/)
check('the date divider\'s margins are half the 10px / 6px they were', dTop <= 5 && dBottom <= 3, { dTop, dBottom })
const [mTop, mBottom] = px(/\.tc-member-row \{[^}]*padding: ([\d.]+)px 0 ([\d.]+)px 16px;/)
check('a status line\'s padding is half the 3px it was', mTop <= 1.5 && mBottom <= 1.5, { mTop, mBottom })

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nrow shape: all checks passed')
