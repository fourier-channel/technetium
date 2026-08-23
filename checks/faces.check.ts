// Checks for face detection.
//
// The risk is entirely false POSITIVES. A face that fails to fire is a missing
// flourish; a face that fires on ":3" inside "12:30" puts an animation on
// somebody's avatar every time they mention a time, and there is no way for
// them to turn it off or even work out what they did.
import { FACES, detectFace, faceByToken, faceEnter, faceExit } from '../src/client/faces.ts'
import { ARRIVAL_ANIMATIONS } from '../src/client/memberEvents.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('\n-- the seven --')
{
  const tokens = FACES.map((f) => f.token)
  check('all seven are present', FACES.length === 7, tokens)
  check('the operator\'s list is exactly what is there',
    tokens.join(' ') === ':3 ._. o_O O_o -_- :o -.-', tokens.join(' '))
  check('ids are unique', new Set(FACES.map((f) => f.id)).size === 7)
  check('tokens are unique', new Set(tokens).size === 7)
  check('every face has a label for a screen reader',
    FACES.every((f) => f.label.length > 0))
  // The image hook: null today, an mxc later, and only the renderer branches.
  check('no face has art yet', FACES.every((f) => f.art === null))

  for (const f of FACES) {
    check(`"${f.token}" fires on its own`, detectFace(f.token)?.id === f.id)
    check(`"${f.token}" fires mid-sentence`, detectFace(`well ${f.token} then`)?.id === f.id)
    check(`"${f.token}" round-trips by token`, faceByToken(f.token)?.id === f.id)
  }
}

console.log('\n-- case matters, because two of them differ only by case --')
{
  check('o_O and O_o are different faces', detectFace('o_O')?.id !== detectFace('O_o')?.id)
  check('o_O is itself', detectFace('o_O')?.id === 'confused-left')
  check('O_o is itself', detectFace('O_o')?.id === 'confused-right')
  // Folding case would collapse the pair, so an unlisted casing must simply
  // not match rather than being helpfully normalised into one of them.
  check('O_O is not a face', detectFace('O_O') === null)
  check(':O is not :o', detectFace(':O') === null)
}

console.log('\n-- what must NOT set one off --')
{
  // The whole reason for whole-token matching.
  check('a time of day does not', detectFace('meeting at 12:30') === null)
  check('a port does not', detectFace('try http://host:3000 now') === null)
  check('a ratio does not', detectFace('it is 4:3 widescreen') === null)
  check('a word ending in the token does not', detectFace('hi:3') === null)
  check('a word containing it does not', detectFace('abc-_-def') === null)
  check('an emoticon with punctuation attached does not', detectFace('yay :3!') === null)
  check('empty text does not', detectFace('') === null)
  check('whitespace only does not', detectFace('   ') === null)
  check('an ordinary sentence does not', detectFace('the build is green') === null)
  // A decimal is the nastiest neighbour of "-.-" and "._."
  check('a decimal number does not', detectFace('it took 3.5 seconds') === null)
}

console.log('\n-- boundaries --')
{
  check('a newline delimits', detectFace('line one\n:3\nline two')?.token === ':3')
  check('a tab delimits', detectFace('a\t-_-\tb')?.token === '-_-')
  check('leading whitespace is fine', detectFace('   :o')?.token === ':o')
  check('trailing whitespace is fine', detectFace(':o   ')?.token === ':o')

  // First wins, and that is the rule a reader can predict without being told.
  check('the first face wins', detectFace(':3 and later -_-')?.token === ':3')
  check('order is by position, not by list order', detectFace('-_- and later :3')?.token === '-_-')
}

console.log('\n-- entering and leaving --')
{
  const seed = '$event:41chan.net'
  check('the enter variant is one the CSS knows',
    ARRIVAL_ANIMATIONS.includes(faceEnter(seed)))
  check('the exit variant is one the CSS knows',
    ARRIVAL_ANIMATIONS.includes(faceExit(seed)))

  // Seeded, not random: a fresh pick per replay would make one row look like a
  // different event every time it scrolled past, and two people in the room
  // would watch the same message arrive differently.
  check('the same message always enters the same way', faceEnter(seed) === faceEnter(seed))
  check('the same message always leaves the same way', faceExit(seed) === faceExit(seed))

  // Different salts, so a face does not always leave the way it came.
  const seeds = Array.from({ length: 40 }, (_, i) => `$evt${i}:x.net`)
  check('enter and exit disagree at least sometimes',
    seeds.some((s) => faceEnter(s) !== faceExit(s)))
  // ...and both actually range over the vocabulary rather than sticking.
  check('entrances vary across messages',
    new Set(seeds.map(faceEnter)).size > 1)
  check('exits vary across messages',
    new Set(seeds.map(faceExit)).size > 1)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
