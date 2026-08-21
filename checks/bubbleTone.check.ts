// Checks for which speech bubble a line gets.
//
// These pin the RULES, not the shapes. The shapes are the feature; the rules
// are how a line finds one, and they are the part that will be retuned -- so
// the cases worth writing down are the ambiguous ones, where two signals are
// present and something has to win.
import { bubbleTone } from '../src/client/bubbleTone.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const tone = (s: string) => bubbleTone(s)

console.log('\n-- the plain case is the common case --')
{
  check('an ordinary line is standard', tone('the build is green') === 'standard')
  check('a mid-sentence question mark does not ask',
    tone('he asked why? and then left the room') === 'standard')
  check('an empty line is standard', tone('') === 'standard' && tone('   ') === 'standard')
  check('leading and trailing space do not change the answer',
    tone('   really?   ') === 'questioning')
}

console.log('\n-- asking --')
{
  check('a trailing question mark asks', tone('are we deploying today?') === 'questioning')
  check('multiple question marks still ask', tone('what???') === 'questioning')
}

console.log('\n-- shouting --')
{
  check('a trailing bang shouts', tone('it works!') === 'yelling')
  check('all caps shouts without punctuation', tone('EVERYTHING IS FINE') === 'yelling')

  // Volume beats interrogation: "WHAT?!" is a raised voice, not an enquiry,
  // which is how it reads out loud.
  check('volume beats interrogation', tone('WHAT?!') === 'yelling')

  // Short all-caps is an initialism, not a raised voice.
  check('OK is not shouting', tone('OK') === 'standard')
  check('IMO is not shouting', tone('IMO') === 'standard')
  check('a four letter caps word does shout', tone('STOP') === 'yelling')

  // ASCII-only caps detection, on purpose: toUpperCase() is the identity for
  // scripts without case, so a naive check would call every CJK message a
  // shout. This asserts we do NOT do that.
  check('a caseless script is not shouting', tone('こんにちは') === 'standard')
  check('cyrillic is not shouting by default', tone('привет') === 'standard')
  check('a caseless script can still ask', tone('こんにちは?') === 'questioning')
  check('numbers and symbols alone do not shout', tone('1234 5678') === 'standard')
}

console.log('\n-- thinking --')
{
  check('a wholly parenthesised line is a thought',
    tone('(if anyone is still reading this)') === 'thinking')
  check('trailing off is a thought', tone('i suppose so...') === 'thinking')
  check('a real ellipsis counts too', tone('hm…') === 'thinking')

  // The brackets are the stronger signal: an aside that happens to ask is
  // still an aside.
  check('an aside that asks is still an aside',
    tone('(does anyone know?)') === 'thinking')
  check('an aside that shouts is still an aside',
    tone('(WHAT WAS THAT)') === 'thinking')

  // A line that merely CONTAINS brackets is not an aside.
  check('a partial parenthesis is not a thought',
    tone('the fix (finally) landed') === 'standard')
  check('an opening bracket alone is not a thought', tone('(unclosed') === 'standard')

  // Multi-line asides: chat messages have newlines in them.
  check('a multi-line aside still reads as one',
    tone('(one\ntwo\nthree)') === 'thinking')
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
