// A person's look (launch-polish L24): what is published, what is believed of
// other people's, when the animation plays, and the store that reads it.
//
// Operator, 2026-09-30: "Profile: Set avatar options. change avatar. mask
// shape. border/glow effect. occasional animation (like a spin or a flip, or
// sucked into a black hole. played on adding a line of text to chat, AND a
// randomized timer, not persisting forever.) Set name font, name color."
//
// The look is written by other people and reaches CSS, so most of this is
// about what is NOT believed.
import { readFileSync } from 'node:fs'
import {
  ANIM_MS,
  DEFAULT_LOOK,
  LIVE_WINDOW_MS,
  LOOK_COLORS,
  LOOK_FIELD,
  REPLAYS,
  REPLAY_GAP_MIN_MS,
  REPLAY_WINDOW_MS,
  nameAttrs,
  parseLook,
  playsAhead,
  replaySchedule,
  sameLook,
  serializeLook,
  type Look,
} from '../src/client/look.ts'
import { LOOK_RETRY_MS, LOOK_TTL_MS, createLookStore, lookIO, type LookIO } from '../src/client/lookStore.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

console.log('== what arrives is made safe, field by field')
{
  check('nothing at all is the default look', sameLook(parseLook(undefined), DEFAULT_LOOK) && sameLook(parseLook('spin'), DEFAULT_LOOK) && sameLook(parseLook([1]), DEFAULT_LOOK))
  const full = parseLook({ v: 1, mask: 'keyhole', ring: 'glow', ringColor: 'rose', anim: 'blackhole', nameFont: 'mono', nameColor: 'gold' })
  check('a whole valid look is taken as it is',
    full.mask === 'keyhole' && full.ring === 'glow' && full.ringColor === 'rose' && full.anim === 'blackhole' && full.nameFont === 'mono' && full.nameColor === 'gold')
  const hostile = parseLook({
    mask: 'url(javascript:alert(1))', ring: 'glow', ringColor: '#ff0000', anim: 'explode',
    nameFont: "'Comic Sans', url(https://evil.example/x.woff)", nameColor: 'red; background: url(x)',
  })
  check('a value outside its list is that field\'s default -- a colour is a NAME, never a value',
    hostile.mask === 'circle' && hostile.ringColor === 'green' && hostile.anim === 'none' && hostile.nameFont === null && hostile.nameColor === null, hostile)
  check('and one bad field does not cost the good ones', hostile.ring === 'glow')
  check('a future version\'s extra fields are ignored, known ones kept', parseLook({ v: 9, mask: 'square', sparkle: true }).mask === 'square')
}

console.log('== what is written')
{
  const look: Look = { mask: 'torn', ring: 'both', ringColor: 'violet', anim: 'flip', nameFont: 'serif', nameColor: 'amber' }
  const wire = serializeLook(look)
  check('it round-trips', sameLook(parseLook(wire), look))
  check('it carries a version', wire.v === 1)
  check('it carries only strings and the version -- no floats (G-bf04), nothing else',
    Object.entries(wire).every(([k, v]) => (k === 'v' ? Number.isInteger(v) : typeof v === 'string')))
  check('"standard" name face and colour are simply absent', !('nameFont' in serializeLook(DEFAULT_LOOK)) && !('nameColor' in serializeLook(DEFAULT_LOOK)))
  check('the field is namespaced, as custom profile fields must be', /^net\.41chan\./.test(LOOK_FIELD))
  check('a name with no choice carries no attributes at all', Object.keys(nameAttrs(DEFAULT_LOOK)).length === 0)
  check('a chosen face and colour become the two attributes the stylesheet reads',
    JSON.stringify(nameAttrs(look)) === JSON.stringify({ 'data-name-font': 'serif', 'data-name-color': 'amber' }))
}

console.log('== when it plays: on the line, a few more times, then never')
{
  const s = replaySchedule('$event1')
  check('the schedule is the same for everyone watching (seeded, not random)', JSON.stringify(s) === JSON.stringify(replaySchedule('$event1')))
  check('different lines get different schedules', JSON.stringify(s) !== JSON.stringify(replaySchedule('$event2')))
  let bounded = true
  for (let i = 0; i < 500; i++) {
    const t = replaySchedule(`$e${i}`)
    if (t.length > REPLAYS) bounded = false
    if (t.some((at, j) => at > REPLAY_WINDOW_MS || at - (j === 0 ? 0 : t[j - 1]) < REPLAY_GAP_MIN_MS)) bounded = false
  }
  check(`never more than ${REPLAYS} replays, never past ${REPLAY_WINDOW_MS / 1000}s, never closer than ${REPLAY_GAP_MIN_MS / 1000}s apart (500 lines)`, bounded)
  const live = playsAhead('$event1', 1000)
  check('a line just said plays at once, then its replays', live[0] === 0 && live.length === 1 + s.length, live)
  check('a line opened a minute late plays the same LATER moments, not an arrival',
    JSON.stringify(playsAhead('$event1', LIVE_WINDOW_MS + 1)) === JSON.stringify(s.filter((at) => at > LIVE_WINDOW_MS + 1).map((at) => at - LIVE_WINDOW_MS - 1)))
  check('history plays nothing, ever', playsAhead('$event1', REPLAY_WINDOW_MS + 1).length === 0 && playsAhead('$event1', 86_400_000).length === 0)
  check('a clock that says the line is from the future plays nothing', playsAhead('$event1', -5).length === 0)
}

console.log('== the stylesheet and the timers agree (D-tc01)')
{
  const css = read('src/index.css')
  for (const [anim, ms] of Object.entries(ANIM_MS)) {
    const rule = new RegExp(`\\.tc-av\\[data-anim-play='${anim}'\\] > \\.tc-av-body \\{ animation: \\w+ (\\d+)ms [^;]* 1; \\}`).exec(css)
    check(`${anim}: the CSS run is ${ms}ms and plays once`, rule !== null && Number(rule[1]) === ms, rule?.[0])
  }
  check('the black hole\'s well lasts as long as the swallow', /\.tc-av-hole \{[^}]*animation: tcAvWell (\d+)ms/.exec(css)?.[1] === String(ANIM_MS.blackhole))
  check('nothing about a look animates forever', !/tcAv\w+[^;]*infinite/.test(css))
  check('reduced motion stops the plays in the stylesheet too', /@media \(prefers-reduced-motion: reduce\) \{\s*\.tc-av > \.tc-av-body \{ animation: none; \}/.test(css))
  for (const c of LOOK_COLORS) {
    check(`colour ${c.id}: a palette name bound to a formant token, used by names and edges`,
      new RegExp(`--tc-look-${c.id}: var\\(--mod-[\\w-]+\\);`).test(css) &&
      new RegExp(`\\[data-name-color='${c.id}'\\] \\{ color: var\\(--tc-look-${c.id}\\); \\}`).test(css))
  }
  // A chosen face or colour must outrank each surface's own -- same weight,
  // so the look rules have to come later in the file.
  const lookRules = css.indexOf("[data-name-color='green']")
  for (const sel of ['.tc-ident-name {', '.tc-me-name {', '.tc-avpill-name {']) {
    check(`the look rules come after ${sel}`, css.indexOf(sel) > 0 && css.indexOf(sel) < lookRules)
  }
}

console.log('== the avatar: mask on the face, edge one level up (the clip-path gotcha)')
{
  const disc = read('src/ui/AvatarDisc.tsx')
  const body = disc.indexOf('className="tc-av-body"')
  const face = disc.indexOf('className="tc-av-face"')
  check('the face sits inside the body, and carries the clip-path', body > 0 && face > body && /className="tc-av-face"[\s\S]*clipPath: clipPathFor\(look\.mask\)/.test(disc))
  check('the edge is on the body, never on the clipped face', /className="tc-av-body"\s*\n\s*data-ring=/.test(disc) && !/tc-av-face[^\n]*data-ring/.test(disc))
  check('the edge rules are filters on the body', /\.tc-av-body\[data-ring='line'\] \{\s*filter: drop-shadow/.test(read('src/index.css')))
  check('an unsaved look can be drawn in place of the stored one (the preview)', /const look = draft \?\? stored/.test(disc))
}

console.log('== the store: read once, kept a while, never guessed')
{
  let clock = 1_000_000
  const now = () => clock
  function server(looks: Record<string, unknown>, opts: { supported?: boolean; fail?: Set<string>; notFound?: Set<string> } = {}) {
    const reads: string[] = []
    const writes: Record<string, unknown>[] = []
    const io: LookIO = {
      supported: async () => opts.supported ?? true,
      async read(userId) {
        reads.push(userId)
        if (opts.notFound?.has(userId)) throw { errcode: 'M_NOT_FOUND', httpStatus: 404 }
        if (opts.fail?.has(userId)) throw new TypeError('Failed to fetch')
        return looks[userId]
      },
      async write(v) { writes.push(v) },
    }
    return { io, reads, writes }
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))

  const s = server({ '@a:x': { mask: 'square', anim: 'spin' } }, { notFound: new Set(['@gone:x']), fail: new Set(['@flaky:x']) })
  const store = createLookStore(s.io, '@me:x', now)
  let heard = 0
  store.subscribe(() => heard++)
  check('before anything is read, the default is drawn -- not a guess', sameLook(store.peek('@a:x'), DEFAULT_LOOK))
  store.want('@a:x'); store.want('@a:x')
  await flush(); await flush()
  check('read once, however many ask at once', s.reads.filter((u) => u === '@a:x').length === 1, s.reads)
  const first = store.peek('@a:x')
  check('then drawn as theirs', first.mask === 'square' && first.anim === 'spin')
  store.want('@a:x')
  await flush()
  check('not read again inside the TTL', s.reads.filter((u) => u === '@a:x').length === 1)
  clock += LOOK_TTL_MS + 1
  store.want('@a:x')
  await flush(); await flush()
  check('read again once it is stale', s.reads.filter((u) => u === '@a:x').length === 2)
  check('an unchanged re-read keeps the same object, so nothing redraws', store.peek('@a:x') === first)

  store.want('@gone:x')
  await flush(); await flush()
  check('no profile is an answer: the default, remembered', sameLook(store.peek('@gone:x'), DEFAULT_LOOK))
  store.want('@gone:x')
  await flush()
  check('and not asked again inside the TTL', s.reads.filter((u) => u === '@gone:x').length === 1)

  store.want('@flaky:x')
  await flush(); await flush()
  store.want('@flaky:x')
  await flush()
  check('a failed read is not hammered', s.reads.filter((u) => u === '@flaky:x').length === 1)
  clock += LOOK_RETRY_MS + 1
  store.want('@flaky:x')
  await flush(); await flush()
  check(`and is asked again ${LOOK_RETRY_MS / 1000}s later, not a whole TTL`, s.reads.filter((u) => u === '@flaky:x').length === 2)

  const mine: Look = { ...DEFAULT_LOOK, mask: 'keyhole', nameColor: 'rose' }
  await store.publish(mine)
  check('publishing writes the serialized look', s.writes.length === 1 && s.writes[0].mask === 'keyhole' && s.writes[0].nameColor === 'rose')
  check('and your own look is drawn from it at once', store.peek('@me:x').mask === 'keyhole')
  check('listeners heard the changes', heard > 0)

  const off = server({}, { supported: false })
  const offStore = createLookStore(off.io, '@me:x', now)
  offStore.want('@a:x')
  await flush(); await flush()
  check('a server that does not share profile fields is not asked for them', off.reads.length === 0 && offStore.support() === 'no')
  const refused = await offStore.publish(mine).then(() => null, (e: Error) => e)
  check('and a save there fails loudly instead of landing somewhere nobody sees', refused instanceof Error && /seen by nobody/.test(refused.message) && off.writes.length === 0)
}

console.log('== the SDK calls')
{
  const calls: string[] = []
  const fake = {
    doesServerSupportExtendedProfiles: async () => true,
    getExtendedProfile: async (u: string) => { calls.push(`get ${u}`); return { displayname: 'A', [LOOK_FIELD]: { mask: 'triangle' } } },
    setExtendedProfileProperty: async (k: string, v: unknown) => { calls.push(`set ${k} ${JSON.stringify(v)}`) },
  }
  const io = lookIO(fake as never)
  const raw = await io.read('@a:x')
  check('reads the whole profile (the SDK caches single-field reads forever) and picks the field',
    calls[0] === 'get @a:x' && parseLook(raw).mask === 'triangle')
  await io.write({ v: 1, mask: 'circle' })
  check('writes the one field under its name', calls[1] === `set ${LOOK_FIELD} {"v":1,"mask":"circle"}`)
}

console.log('== the panel and where it is reached')
{
  const app = read('src/App.tsx')
  const me = /<div className="tc-me">[\s\S]*?<\/div>\n\s*<\/div>\n/.exec(app)?.[0] ?? ''
  check('the Profile pill sits left of Settings under your card', me.indexOf('>\n                Profile') > 0 && me.indexOf('Profile') < me.indexOf('Settings'))
  check('it opens the Profile panel', /onClick=\{openProfile\}/.test(me))
  const actions = read('src/ui/ProfileActions.tsx')
  check('your own profile preview offers the panel, and no second editor',
    /Edit your profile/.test(actions) && !/uploadAndSetAvatar|setDisplayName|AvatarShapePicker/.test(actions))
  check('the preview card draws the person through the one avatar renderer', /<AvatarDisc userId=\{userId\} name=\{name\} avatarMxc=\{avatarMxc\} size=\{56\} \/>/.test(read('src/ui/ProfileCard.tsx')))
  const panel = read('src/ui/ProfilePanel.tsx')
  check('the panel publishes only on Save, through the store', /await store\.publish\(current\)/.test(panel) && (panel.match(/store\.publish\(/g) ?? []).length === 1)
  check('and can undo, discard and preview the animation', /const undo = /.test(panel) && /const discard = /.test(panel) && /const playPreview = /.test(panel))
  const row = read('src/ui/Timeline.tsx')
  check('the speaking avatar plays by the schedule, on timers, and not under reduced motion or with animations off',
    /for \(const delay of playsAhead\(item\.id, Date\.now\(\) - event\.getTs\(\)\)\) timers\.push\(setTimeout\(play, delay\)\)/.test(row) &&
    /if \(!speaks \|\| narrow \|\| anim === 'none' \|\| reducedMotion \|\| !animationsEnabled\) return/.test(row) &&
    /setTimeout\(\(\) => setPlaying\(null\), ANIM_MS\[anim\]\)/.test(row))
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nlook: all checks passed')
