// Checks for W2.9 mention masking and the `@` query detector. The end-to-end
// formatMessage path is covered in checks/compose.check.ts (it needs a DOM);
// these are the pure parts.
import { maskMentions, mentionQueryAt, restoreMentions } from '../src/client/mentions.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log('  ok   ' + name)
  } else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

console.log('\n-- mentionQueryAt --')
{
  check('at the start', mentionQueryAt('@sab', 4)?.query === 'sab')
  check('start index recorded', mentionQueryAt('hi @sab', 7)?.start === 3)
  check('after a space', mentionQueryAt('hi @sa', 6)?.query === 'sa')
  check('bare @ opens the picker', mentionQueryAt('@', 1)?.query === '')
  check('no @ at all', mentionQueryAt('hello', 5) === null)
  // An email or a mid-word @ must not open the picker on every keystroke.
  check('mid-word @ ignored', mentionQueryAt('mail@example', 12) === null)
  check('a space closes the query', mentionQueryAt('@sab er', 7) === null)
  // The caret is what matters, not the end of the string.
  check('reads at the CARET, not the end', mentionQueryAt('@sab and more', 4)?.query === 'sab')
  check('caret before the @', mentionQueryAt('hi @sab', 2) === null)
}

console.log('\n-- maskMentions --')
{
  const m = maskMentions('hi @saber how are you', [{ text: '@saber', userId: '@saber:x.net' }])
  check('mention masked out', !m.masked.includes('@saber'))
  check('marked as used', m.used.length === 1 && m.used[0].userId === '@saber:x.net')
  check('surrounding text intact', m.masked.startsWith('hi ') && m.masked.endsWith(' how are you'))

  // Picking a mention then deleting it must not ping anyone.
  const gone = maskMentions('never mind', [{ text: '@saber', userId: '@saber:x.net' }])
  check('a deleted mention is NOT used', gone.used.length === 0)
  check('text untouched when nothing matches', gone.masked === 'never mind')

  // Longest-first ordering: masking "@sab" before "@saber" would leave "er".
  const overlap = maskMentions('hi @saber', [
    { text: '@sab', userId: '@sab:x.net' },
    { text: '@saber', userId: '@saber:x.net' },
  ])
  check('longest match wins', overlap.used[0].userId === '@saber:x.net', overlap.used)
  check('no stray remainder left behind', !overlap.masked.includes('er '), overlap.masked)

  const twice = maskMentions('@a and @a', [{ text: '@a', userId: '@a:x.net' }])
  check('repeated mention masked everywhere', !twice.masked.includes('@a'))
  check('repeated mention counted once', twice.used.length === 1)
}

console.log('\n-- restoreMentions --')
{
  const m = maskMentions('hi @saber', [{ text: '@saber', userId: '@saber:x.net' }])
  const out = restoreMentions(m.masked, m.used)
  check('anchor emitted', out.includes('<a href="https://matrix.to/#/'), out)
  check('user id encoded in the href', out.includes('%40saber%3Ax.net'), out)
  check('display text preserved', out.includes('>@saber</a>'), out)
  check('surrounding text intact', out.startsWith('hi '), out)

  // The anchor is injected AFTER sanitizing, so its text must be escaped by us.
  const nasty = maskMentions('hi @<img src=x>', [
    { text: '@<img src=x>', userId: '@e:x.net' },
  ])
  const nastyOut = restoreMentions(nasty.masked, nasty.used)
  check('hostile display text escaped', !nastyOut.includes('<img'), nastyOut)
  check('escaped form present', nastyOut.includes('&lt;img'), nastyOut)

  // A `$` in a display name would be read as a replacement pattern by
  // String.replace -- hence split/join.
  const dollar = maskMentions('hi @co$t', [{ text: '@co$t', userId: '@c:x.net' }])
  const dollarOut = restoreMentions(dollar.masked, dollar.used)
  check('a $ in a display name survives literally', dollarOut.includes('@co$t'), dollarOut)

  check('nothing to restore leaves html alone', restoreMentions('<b>x</b>', []) === '<b>x</b>')
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
