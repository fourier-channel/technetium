// The person's booru blocklist hides pictures in Technetium too (operator,
// 2026-10-13, blocklist-is-the-only-filter: one list, on the booru account,
// read by every app).
//
// Holds: the list is read from /profile.json's parsed `blocklist`, never the
// raw text; a rule matches as chanbooru's own Rule does (required words, `-`
// excludes, `~` any-of, `rating:<letter>`); a rule naming what the live read
// cannot see (score, status, uploader) is NOT applied and is returned to be
// reported; a refused read is a fault, not an empty list; the blocked set is
// separate from the withheld one and a no-op set emits nothing; the room
// timeline AND the thread panel both drop a hidden picture's row.
import { readFileSync } from 'node:fs'
const {
  parseProfileBlocklist, compileRule, postWords, ruleMatches, blockedBy,
  fetchBlocklist, BLOCKLIST_URL, setBlocklist, currentRules,
  setBlocked, blockedMedia, onBlocked, onBlocklistChanged, resetBlocklistForTest,
  beginBlocklistRead, applyBlocklistRead, clearBlocklist,
} = await import('../src/client/booruBlocklist.ts')
const { hiddenMedia, onHiddenChanged } = await import('../src/client/hiddenMedia.ts')
const { withhold, goneMedia } = await import('../src/client/withheldMedia.ts')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const words = (tags: string[], rating?: string) => postWords(tags, rating)
const hides = (rule: string, tags: string[], rating?: string) =>
  ruleMatches(compileRule(rule), words(tags, rating))

console.log('\n-- the list is the parsed blocklist, nothing else --')
{
  const parsed = parseProfileBlocklist({
    blacklisted_tags: 'spoilers\n[locked] gore',
    blocklist: [
      { rule: 'spoilers', locked: false },
      { rule: 'gore', locked: true },
      { rule: '   ', locked: false },
      { rule: 7 },
      null,
      'loose string',
    ],
  })
  check('two well-formed rules kept, junk dropped', parsed.length === 2, parsed)
  check('lock flag carried', parsed[1]?.locked === true && parsed[0]?.locked === false)
  check('locked must be true, not truthy',
    parseProfileBlocklist({ blocklist: [{ rule: 'a', locked: 'yes' }] })[0]?.locked === false)
  check('no blocklist key is an empty list, never the raw text',
    parseProfileBlocklist({ blacklisted_tags: 'spoilers' }).length === 0)
  check('a non-object body is an empty list', parseProfileBlocklist(null).length === 0)
}

console.log('\n-- a rule matches as chanbooru Rule does --')
{
  check('one required word hides a post that has it', hides('spoilers', ['spoilers', 'cat']))
  check('one required word spares a post without it', !hides('spoilers', ['cat']))
  check('every required word is needed', !hides('cat dog', ['cat']) && hides('cat dog', ['dog', 'cat']))
  check('an excluded word spares the post', !hides('cat -cute', ['cat', 'cute']) && hides('cat -cute', ['cat']))
  check('any-of needs one of its words',
    hides('~cat ~dog', ['dog']) && !hides('~cat ~dog', ['bird']))
  check('required AND any-of together',
    hides('pet ~cat ~dog', ['pet', 'cat']) && !hides('pet ~cat ~dog', ['pet', 'bird']) &&
    !hides('pet ~cat ~dog', ['cat']))
  check('rating is a word: rating:e', hides('rating:e', ['x'], 'e') && !hides('rating:e', ['x'], 's'))
  check('rating letter is lowercased', hides('rating:e', ['x'], 'E'))
  check('tags and rules are lowercased', hides('Spoilers', ['SPOILERS']))
  check('extra whitespace is not a word', hides('  cat \t dog ', ['cat', 'dog']))
  check('a rule of only exclusions hides nothing', !hides('-cat', ['dog']))
  check('blockedBy names the first rule that hides',
    blockedBy([compileRule('dog'), compileRule('cat')], words(['cat']))?.rule === 'cat')
  check('blockedBy with no match is undefined', blockedBy([compileRule('dog')], words(['cat'])) === undefined)
}

console.log('\n-- what Technetium cannot see is not applied, and is said --')
{
  for (const rule of ['score:<5', 'cat -status:deleted', 'uploaderid:12', '~status:flagged cat']) {
    const c = compileRule(rule)
    check(`"${rule}" is unseen`, c.unseen.length > 0, c)
    check(`"${rule}" never hides`, !ruleMatches(c, words(['cat', 'status:deleted', 'uploaderid:12'])))
  }
  check('score:>5 is not a cap; it is a word, seen like any other',
    compileRule('score:>5').unseen.length === 0)
  resetBlocklistForTest()
  const unseen = setBlocklist([
    { rule: 'cat', locked: false },
    { rule: 'score:<0', locked: false },
  ])
  check('setBlocklist returns the unseen rules for reporting',
    unseen.length === 1 && unseen[0].rule === 'score:<0', unseen)
  check('and keeps every rule compiled', currentRules().length === 2)
}

console.log('\n-- a refused read is a fault --')
{
  const answer = (status: number, body: unknown) =>
    (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return { ok: status < 400, status, json: async () => body }
    }) as unknown as typeof fetch
  const seen: { url: string; init: RequestInit }[] = []
  const ok = await fetchBlocklist(answer(200, { blocklist: [{ rule: 'cat', locked: false }] }))
  check('a 200 is read', ok.length === 1 && ok[0].rule === 'cat')
  check('it asks /profile.json', seen[0]?.url === BLOCKLIST_URL && BLOCKLIST_URL.endsWith('/profile.json'))
  check('credentialed', seen[0]?.init.credentials === 'include')
  let threw: unknown = null
  try { await fetchBlocklist(answer(403, {})) } catch (err) { threw = err }
  check('a 403 throws rather than answering []', threw instanceof Error)
  check('and the error names its remedy', /Fix:/.test(String((threw as Error)?.message)))
}

console.log('\n-- the blocked set --')
{
  resetBlocklistForTest()
  let emits = 0
  onBlocked(() => { emits++ })
  const before = blockedMedia()
  setBlocked('m1', false)
  check('unblocking what is not blocked emits nothing', emits === 0 && blockedMedia() === before)
  setBlocked('m1', true)
  check('blocking emits once and makes a new set', emits === 1 && blockedMedia() !== before && blockedMedia().has('m1'))
  const after = blockedMedia()
  setBlocked('m1', true)
  check('blocking again emits nothing and keeps the set', emits === 1 && blockedMedia() === after)
  setBlocked('m1', false)
  check('unblocking emits and clears', emits === 2 && !blockedMedia().has('m1'))
  let ruleEmits = 0
  onBlocklistChanged(() => { ruleEmits++ })
  setBlocklist([{ rule: 'x', locked: false }])
  check('a new list tells the judges to judge again', ruleEmits === 1)
}

console.log('\n-- one union of hidden pictures, read by both views --')
{
  resetBlocklistForTest()
  let hiddenEmits = 0
  const off = onHiddenChanged(() => { hiddenEmits++ })
  const h0 = hiddenMedia()
  check('the union is stable while nothing changes', hiddenMedia() === h0)
  setBlocked('b1', true)
  check('a blocked picture is hidden', hiddenMedia().has('b1') && hiddenEmits === 1)
  // withhold() pops first; run its scheduled step at once.
  withhold('w1', (run) => { run(); return 0 })
  check('a withheld picture is hidden too', goneMedia().has('w1') && hiddenMedia().has('w1') && hiddenMedia().has('b1'))
  check('withheld changes reach the union listeners', hiddenEmits >= 3, hiddenEmits)
  off()
  setBlocked('b2', true)
  const settled = hiddenEmits
  setBlocked('b3', true)
  check('unsubscribing stops both sources', hiddenEmits === settled)
  // Both views must read the union, or a picture leaves the room and stays
  // in its thread (the gap found 2026-11-19).
  const timeline = readFileSync('src/client/useTimeline.ts', 'utf8')
  const thread = readFileSync('src/ui/ThreadPanel.tsx', 'utf8')
  check('the room timeline filters by hiddenMedia()', /withheld:\s*hiddenMedia\(\)/.test(timeline))
  check('the thread panel filters by hiddenMedia()', /withheld:\s*hiddenMedia\(\)/.test(thread))
  check('the thread panel drops ignored senders', /ignoredUsers:\s*client \? getIgnoredUsers\(client\)/.test(thread))
  check('the thread panel re-renders on a hidden change', /onHiddenChanged\(/.test(thread))
  const tags = readFileSync('src/client/useMediaTags.ts', 'utf8')
  check('every tag set that arrives is judged', /judge\(mediaId\)/.test(tags))
  check('a rule it cannot apply is reported once, not on every re-read',
    /if \(reportedUnseen\.has\(r\.rule\)\) continue/.test(tags))
}

console.log('\n-- a tag blocked in the booru frame is gone from the next room --')
{
  // The 2026-11-20 bug: blocking took a refresh, unblocking looked instant.
  const frame = readFileSync('src/ui/BooruFrame.tsx', 'utf8')
  check('leaving the booru view rereads the list',
    /useEffect\(\(\) => \(\) => void rereadBlocklist\(\), \[\]\)/.test(frame))
  const tags = readFileSync('src/client/useMediaTags.ts', 'utf8')
  const load = tags.slice(tags.indexOf('function loadBlocklist'), tags.indexOf('function ingestEvent'))
  check('the list read does not queue behind the room\'s tag reads (no booruLimiter)',
    load.length > 0 && !/booruLimiter/.test(load), load.slice(0, 200))
  check('an answer is applied through the read numbering', /applyBlocklistRead\(read, blocks\)/.test(load))
  check('sign-out clears the list and abandons reads in flight', /clearBlocklist\(\)/.test(tags))

  resetBlocklistForTest()
  const a = [{ rule: 'old', locked: false }]
  const b = [{ rule: 'new', locked: false }]
  const first = beginBlocklistRead()
  const second = beginBlocklistRead()
  check('the later read applies', applyBlocklistRead(second, b) !== null)
  check('an earlier read landing after it is dropped', applyBlocklistRead(first, a) === null)
  check('the list is the later read\'s', currentRules().map((r) => r.rule).join() === 'new')

  resetBlocklistForTest()
  const slow = beginBlocklistRead()
  const quick = beginBlocklistRead()
  check('an earlier read landing first applies (it is newer than nothing)', applyBlocklistRead(slow, a) !== null)
  check('then the later one replaces it', applyBlocklistRead(quick, b) !== null &&
    currentRules().map((r) => r.rule).join() === 'new')

  resetBlocklistForTest()
  setBlocklist(a)
  const inFlight = beginBlocklistRead()
  clearBlocklist()
  check('sign-out empties the list', currentRules().length === 0)
  check('a read for the old account landing after sign-out is dropped',
    applyBlocklistRead(inFlight, a) === null && currentRules().length === 0)
  const afterSignIn = beginBlocklistRead()
  check('a read started after sign-in still applies', applyBlocklistRead(afterSignIn, b) !== null &&
    currentRules().map((r) => r.rule).join() === 'new')
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
