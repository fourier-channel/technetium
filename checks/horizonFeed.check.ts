// Checks for the goal ticker's feed (tc.155; src/client/horizonFeed.ts, read
// by horizonTickerSource in src/ui/tickerSource.ts).
//
// Proven here, with no DOM and no request: a status file shaped like
// horizon's export becomes one crawl item per milestone, counted with the
// rows that are not public; nothing else in the file becomes an item; a file
// of the wrong shape is refused by name; and a failure is said loudly, ahead
// of the last good items, in words that carry no address (P4). On source: the
// feed reads the file without cookies and reports every failure.
//
// WHAT THIS CANNOT SEE: the live file (horizon does not serve it to this
// origin yet), or the crawl on screen (the Firefox harness).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  HORIZON_STATUS_URL, HorizonShapeError, horizonFailureItems, horizonFailureReason, horizonTickerItems,
} from '../src/client/horizonFeed.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const code = (path: string) =>
  readFileSync(join(root, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const row = (status: string) => ({ slug: 'x', title: 't', summary: 's', status, size: 'S', category: 'c', area: 'a' })
const fixture = {
  as_of: '2026-11-28T03:00:00Z',
  source: 'canon',
  groups: [
    { key: 'm0', tier: 'milestone', date: '2026-12-01', name: 'Launch', summary: '', items: [row('done'), row('working'), row('open')], not_public: 2, not_public_done: 1 },
    { key: 'm1', tier: 'milestone', date: '2026-12-15', name: ' Booru ', summary: '', items: [row('done')], not_public: 0, not_public_done: 0 },
    { key: 'm2', tier: 'milestone', date: 'someday', name: 'Later', summary: '', items: [row('open')] },
    { key: 'm3', tier: 'milestone', name: 'Empty', items: [], not_public: 0 },
    { key: 'p2', tier: 'priority', name: 'Not a milestone', items: [row('open')] },
    { key: 'decide', name: 'Decide', items: [row('open')] },
    { key: 'built-earlier-x', name: 'Earlier', items: [row('done')] },
    { key: 'm4', tier: 'milestone', name: '', items: [row('open')] },
    { key: 'm5', tier: 'milestone', date: '2026-13-01', name: 'Bad month', items: [row('open')], not_public: -3, not_public_done: 'many' },
    null,
    'junk',
  ],
}

console.log('horizon feed: milestones become items')
const items = horizonTickerItems(fixture)
check('one item per milestone with rows and a name', items.map((i) => i.id).join() === 'm0,m1,m2,m5', items.map((i) => i.id))
const m0 = items.find((i) => i.id === 'm0')
check('counts include the rows that are not public', m0?.text === 'Launch: 2 of 5 done, due 1 Dec', m0?.text)
check('all done says done', items.find((i) => i.id === 'm1')?.text === 'Done: Booru')
check('an unreadable date says no date', items.find((i) => i.id === 'm2')?.text === 'Later: 0 of 1 done')
check('a bad month says no date, bad counts count nothing', items.find((i) => i.id === 'm5')?.text === 'Bad month: 0 of 1 done')
check('each links to its milestone on horizon', m0?.href === 'https://41chan.net/horizon/#m0')
check('no item quotes a summary or a row', items.every((i) => !/\bt\b|\bs\b/.test(i.text.replace(/\d+ of \d+/, ''))))

console.log('horizon feed: a file of the wrong shape is refused')
for (const [name, json] of [['null', null], ['an array', []], ['no groups', { as_of: 'x' }], ['groups not a list', { groups: {} }], ['a string', 'groups']] as const) {
  let threw: unknown = null
  try { horizonTickerItems(json) } catch (e) { threw = e }
  check(`${name} is refused by name`, threw instanceof HorizonShapeError && /status-export\.py/.test((threw as Error).message))
}
let noMilestones: unknown = null
try { horizonTickerItems({ groups: [{ key: 'p2', name: 'x', items: [row('open')] }] }) } catch (e) { noMilestones = e }
check('a file with no milestones is refused', noMilestones instanceof HorizonShapeError)

console.log('horizon feed: a failure is loud')
const failed = horizonFailureItems('the server answered 404', items, 5)
check('the failure line leads', failed[0].id === 'horizon-failed' && failed.length === items.length + 1)
check('it says the goals may be out of date and when it tries again', /may be out of date, trying again in 5 minutes/.test(failed[0].text))
check('the last good items follow unchanged', failed.slice(1).map((i) => i.id).join() === items.map((i) => i.id).join())
const first = horizonFailureItems('no answer came back', [], 1)
check('with nothing good it says there are no goals', first.length === 1 && /no goals to show; trying again in 1 minute$/.test(first[0].text))
check('the failure line is not a link', failed[0].href === undefined)

console.log('horizon feed: the reason is plain words')
check('a status is said as a number', horizonFailureReason({ status: 404 }) === 'the server answered 404')
check('a shape error is said as one', horizonFailureReason(new HorizonShapeError('x')) === 'its file was not in the expected shape')
check('a parse error is said as one', horizonFailureReason(new SyntaxError('Unexpected token < in JSON')) === 'its file was not readable')
check('a network failure carries no message', horizonFailureReason(new TypeError(`NetworkError when attempting to fetch ${HORIZON_STATUS_URL}`)) === 'no answer came back')
for (const err of [new Error('https://41chan.net/x'), { status: '404' }, { status: 4.5 }, null, undefined]) {
  const r = horizonFailureReason(err)
  check(`reason for ${JSON.stringify(err)} carries no address`, !/https?:|41chan|\.net|\//.test(r), r)
}

console.log('horizon feed: on source')
const src = code('src/ui/tickerSource.ts')
check('the file is read without cookies', /credentials: 'omit'/.test(src))
check('every failure is reported', /reportIgnored\('ticker: horizon', err\)/.test(src))
check('the status file is horizon\'s', HORIZON_STATUS_URL === 'https://41chan.net/horizon/status.json')
const app = code('src/App.tsx')
check('App reads horizon for every member, one source for the app',
  /const TICKER_SOURCE = horizonTickerSource\(\)\n/.test(app) && /source=\{TICKER_SOURCE\}/.test(app))
check('App no longer falls back to the placeholder',
  !/placeholderTickerSource/.test(app))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
