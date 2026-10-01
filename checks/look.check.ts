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
  LOOK_ANIMS,
  LOOK_COLORS,
  LOOK_FIELD,
  LOOK_RINGS,
  REPLAYS,
  REPLAY_GAP_MIN_MS,
  REPLAY_WINDOW_MS,
  nameAttrs,
  parseLook,
  playsAhead,
  playsFor,
  replaySchedule,
  sameLook,
  serializeLook,
  type Look,
} from '../src/client/look.ts'
import { LOOK_RETRY_MS, LOOK_TTL_MS, createLookStore, lookIO, type LookIO } from '../src/client/lookStore.ts'
import { INITIAL_DRAFT, currentLook, isDirty, lookDraft, type DraftState } from '../src/ui/lookDraft.ts'
import { describeProfileError } from '../src/client/profile.ts'

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
  const badRing = parseLook({ ring: '1; background:url(x)', mask: 'square' })
  check('an edge outside its list is no edge', badRing.ring === DEFAULT_LOOK.ring && badRing.mask === 'square', badRing)
  check('every field is held to its list (a non-string is not a value either)',
    sameLook(parseLook({ mask: 7, ring: {}, ringColor: ['rose'], anim: true, nameFont: 1, nameColor: null }), DEFAULT_LOOK))
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
  // The age is now this client's own (localTimestamp); a negative one means
  // the local clock stepped, and the line was just said. Measured against the
  // server's clock, a viewer a few seconds behind it never saw a look play.
  check('a line that looks a few seconds "from the future" still plays as just said',
    JSON.stringify(playsAhead('$event1', -3000)) === JSON.stringify(playsAhead('$event1', 0)), playsAhead('$event1', -3000))
  check('a nonsense age plays nothing', playsAhead('$event1', NaN).length === 0 && playsAhead('$event1', Infinity).length === 0)

  // A line you send: drawn as a local echo, then re-keyed in place when the
  // server confirms it, and its row remounts.
  const echo = playsFor(undefined, '~txn1', 50)
  check('the echo plays its arrival', echo.delays[0] === 0 && echo.record.seed === '~txn1')
  const before = playsFor(undefined, '~txn1', 1200).delays
  echo.record.arrived = true
  const confirmed = playsFor(echo.record, '$real', 1200)
  check('confirmed, it does not play the arrival again', !confirmed.delays.includes(0), confirmed.delays)
  check('and keeps the schedule it started with, not one reseeded from the new id',
    JSON.stringify(confirmed.delays) === JSON.stringify(before.filter((d) => d > 0)) && confirmed.record.seed === '~txn1')
  const row = read('src/ui/Timeline.tsx')
  check('the row measures age on this client\'s clock and remembers the line\'s plays on the event object',
    /playsFor\(linePlays\.get\(event\), item\.id, Date\.now\(\) - event\.localTimestamp\)/.test(row) &&
    /linePlays\.set\(event, record\)/.test(row) && !/event\.getTs\(\)\)\) timers/.test(row))
  check('the arrival is marked when it PLAYS, not when it is scheduled', /if \(isArrival\) record\.arrived = true/.test(row))
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
  // Reduced motion must WIN the cascade, not merely be written: a media query
  // adds no weight, and the old `.tc-av > .tc-av-body` (0,2,0) lost to every
  // `[data-anim-play]` rule (0,3,0) -- measured in headless Chromium with
  // reduced motion forced on, the spin still ran. So: the override's weight
  // against every play rule's, and its place after them.
  const weight = (sel: string): number[] => {
    const s = sel.replace(/::?[\w-]+(\([^)]*\))?/g, (m) => (m.startsWith('::') ? ' el ' : ' .c '))
    return [
      (s.match(/#[\w-]+/g) ?? []).length,
      (s.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length,
      (s.replace(/\[[^\]]+\]|\.[\w-]+|#[\w-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length,
    ]
  }
  const beats = (a: number[], b: number[]) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2]
  const plays = [...css.matchAll(/^([^{}@\n]*\[data-anim-play[^{}\n]*)\{[^}]*animation:\s*tcAv/gm)].map((m) => ({ sel: m[1].trim(), at: m.index! }))
  const rm = /@media \(prefers-reduced-motion: reduce\) \{\s*([^{}]+?)\{\s*animation: none;\s*\}\s*\.tc-av-hole \{ display: none; \}/.exec(css)
  check('the look has play rules to override', plays.length === LOOK_ANIMS.length - 1, plays.map((p) => p.sel))
  check('reduced motion out-weighs every play rule, and comes after them',
    rm !== null && plays.every((p) => beats(weight(rm[1].trim()), weight(p.sel)) && rm.index > p.at),
    { override: rm?.[1].trim(), weight: rm && weight(rm[1].trim()), plays: plays.map((p) => [p.sel, weight(p.sel)]) })
  check('the weight sum is right on a known case', JSON.stringify(weight(".tc-av[data-anim-play='spin'] > .tc-av-body")) === '[0,3,0]' && JSON.stringify(weight('.tc-av > .tc-av-body')) === '[0,2,0]')
  for (const c of LOOK_COLORS) {
    check(`colour ${c.id}: a palette name bound to a formant token, used by names and edges`,
      new RegExp(`--tc-look-${c.id}: var\\(--mod-[\\w-]+\\);`).test(css) &&
      new RegExp(`\\[data-name-color='${c.id}'\\] \\{ color: var\\(--tc-look-${c.id}\\); \\}`).test(css))
  }
  for (const c of LOOK_COLORS) {
    // The default edge colour is the body's own --tc-av-edge; every other
    // one needs its rule, or an edge in that colour draws green.
    const ok = c.id === DEFAULT_LOOK.ringColor
      ? /\.tc-av-body \{[^}]*--tc-av-edge: var\(--tc-look-green\)/.test(css)
      : new RegExp(`\\.tc-av-body\\[data-ring-color='${c.id}'\\] \\{ --tc-av-edge: var\\(--tc-look-${c.id}\\); \\}`).test(css)
    check(`edge colour ${c.id}: the avatar body is drawn in it`, ok)
  }
  for (const r of LOOK_RINGS.filter((x) => x.id !== 'none')) {
    check(`edge ${r.id}: a filter rule on the body`, new RegExp(`\\.tc-av-body\\[data-ring='${r.id}'\\] \\{\\s*filter:`).test(css))
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

  // The wiring between the component and the stylesheet, both ways. Every
  // attribute the stylesheet keys an avatar on is one AvatarDisc emits, and
  // every one AvatarDisc emits is keyed on -- so renaming either side alone
  // (no spin ever plays, every edge draws green) is red here.
  const css = read('src/index.css')
  const keyed = new Set([...css.matchAll(/\.tc-av(?:-body)?\[(data-[\w-]+)/g)].map((m) => m[1]))
  const emitted = new Set([...disc.matchAll(/\s(data-[\w-]+)=\{/g)].map((m) => m[1]))
  check('the stylesheet keys the avatar on exactly the attributes AvatarDisc emits',
    keyed.size === 3 && [...keyed].every((a) => emitted.has(a)) && [...emitted].every((a) => keyed.has(a)), { keyed: [...keyed], emitted: [...emitted] })
  check('the animation attribute carries what is playing', /data-anim-play=\{play\}/.test(disc) && /const play = playing && playing !== 'none' \? playing : undefined/.test(disc))
  check('the edge attributes carry the look', /data-ring=\{look\.ring !== 'none' \? look\.ring : undefined\}/.test(disc) && /data-ring-color=\{look\.ring !== 'none' \? look\.ringColor : undefined\}/.test(disc))
  const row = read('src/ui/Timeline.tsx')
  check('the speaking row hands its avatar what is playing', /<AvatarDisc [^>]*playing=\{playing\}/.test(row))
  // Every surface that draws a person's NAME carries their face and colour.
  for (const [file, cls] of [['src/ui/SenderIdentity.tsx', 'tc-ident-name'], ['src/ui/UserLine.tsx', 'tc-userline-name'], ['src/ui/AvatarPill.tsx', 'tc-avpill-name'], ['src/App.tsx', 'tc-me-name'], ['src/ui/ProfileCard.tsx', '']] as const) {
    const src = read(file)
    const tag = cls ? new RegExp(`className="${cls}"[^>]*\\{\\.\\.\\.nameAttrs\\(look\\)\\}`).test(src) : /\{\.\.\.nameAttrs\(look\)\}/.test(src)
    check(`${file.split('/').pop()}: the name carries the look`, tag)
  }
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
  check('publishing writes the serialized look -- the wire shape, not the object',
    s.writes.length === 1 && JSON.stringify(s.writes[0]) === JSON.stringify(serializeLook(mine)) && s.writes[0].v === 1 && !('nameFont' in s.writes[0]), s.writes[0])
  check('and your own look is drawn from it at once', store.peek('@me:x').mask === 'keyhole')
  check('listeners heard the changes', heard > 0)

  // refresh: what the Profile panel asks on open, and whether it got an answer.
  const r1 = store.refresh('@a:x'), r2 = store.refresh('@a:x')
  const both = await Promise.all([r1, r2])
  check('a refresh answers true when the look was read just now', both[0] === true && both[1] === true)
  check('and two at once are one read', s.reads.filter((u) => u === '@a:x').length === 3, s.reads)
  check('a refresh that failed answers false -- the panel then says so before Save', (await store.refresh('@flaky:x')) === false)
  check('no profile at all is an answer, so true', (await store.refresh('@gone:x')) === true)

  const off = server({}, { supported: false })
  const offStore = createLookStore(off.io, '@me:x', now)
  offStore.want('@a:x')
  await flush(); await flush()
  check('a server that does not share profile fields is not asked for them', off.reads.length === 0 && offStore.support() === 'no')
  const refused = await offStore.publish(mine).then(() => null, (e: Error) => e)
  check('and a save there fails loudly instead of landing somewhere nobody sees', refused instanceof Error && /seen by nobody/.test(refused.message) && off.writes.length === 0)
  check('nor is a refresh an answer there', (await offStore.refresh('@a:x')) === false)
}

console.log('== the Profile panel\'s draft')
{
  const saved: Look = { ...DEFAULT_LOOK }
  const run = (s: DraftState, ...as: Parameters<typeof lookDraft>[1][]) => as.reduce(lookDraft, s)
  // The old per-browser mask, carried ONCE.
  const carried = run(INITIAL_DRAFT, { type: 'carry', saved, shape: 'triangle' })
  check('the old mask becomes a draft over a default look, marked as carried', currentLook(carried, saved).mask === 'triangle' && carried.carried && isDirty(carried, saved))
  check('undo goes back to what is published', currentLook(lookDraft(carried, { type: 'undo' }), saved).mask === 'circle')
  const discarded = lookDraft(carried, { type: 'discard' })
  check('discarding it leaves the published look, not the carried one', !isDirty(discarded, saved) && !discarded.carried)
  check('it is never laid over a draft already started',
    currentLook(run(INITIAL_DRAFT, { type: 'change', saved, next: { ring: 'glow' } }, { type: 'carry', saved, shape: 'triangle' }), saved).mask === 'circle')
  check('nor offered when it would change nothing', run(INITIAL_DRAFT, { type: 'carry', saved, shape: 'circle' }) === INITIAL_DRAFT)
  // Circle chosen over a carried triangle equals the published default: no
  // longer dirty, nothing to save -- and the old key is gone, so it stays so.
  const back = run(carried, { type: 'change', saved, next: { mask: 'circle' } })
  check('choosing the default over a carried mask is simply not a change', !isDirty(back, saved))
  // A change made while a Save is in flight survives it.
  const editing = run(INITIAL_DRAFT, { type: 'change', saved, next: { anim: 'spin' } })
  const inFlight = lookDraft(editing, { type: 'saving' })
  const later = lookDraft(inFlight, { type: 'change', saved, next: { ring: 'line' } })
  check('a change while saving keeps the save in progress', later.save.kind === 'saving')
  const afterSave = lookDraft(later, { type: 'saved' })
  check('the save clears only the draft it sent; the newer one is still a draft',
    afterSave.draft?.ring === 'line' && afterSave.draft.anim === 'spin' && afterSave.history.length === later.history.length && afterSave.save.kind === 'idle', afterSave)
  const clean = lookDraft(inFlight, { type: 'saved' })
  check('with nothing changed meanwhile, the save clears the draft and says Saved', clean.draft === null && clean.history.length === 0 && clean.save.kind === 'saved')
  check('a failed save keeps the draft and says why', run(inFlight, { type: 'failed', why: 'x' }).draft === inFlight.draft)

  const panel = read('src/ui/ProfilePanel.tsx')
  check('the panel re-reads your look when it opens, before the controls are live',
    /store\.refresh\(me\)\.then\(\(answered\) =>/.test(panel) && /<fieldset className="tc-prof-look" disabled=\{lookLocked\}>/.test(panel) && /const lookLocked = fresh === 'reading'/.test(panel))
  check('the old mask is taken only once the real look is known',
    /if \(!answered\) return\s+[\s\S]{0,200}?const shape = takeLegacyAvatarShape\(\)/.test(panel) && !/legacyAvatarShape\(\)/.test(panel.replace(/takeLegacyAvatarShape/g, '')))
  check('the preview plays only when animations are on and motion is not reduced',
    /const motionOff = reduced \|\| !animationsEnabled/.test(panel) && /disabled=\{current\.anim === 'none' \|\| motionOff\}/.test(panel))
  const app = read('src/App.tsx')
  check('opening Settings hides Profile rather than closing it, so a draft survives',
    /\{profileMounted && <ProfilePanel hidden=\{!profileOpen\} onClose=\{closeProfile\} \/>\}/.test(app) &&
    !/const openSettings = \(\) => \{[^}]*setProfileMounted/.test(app) && /\.tc-settings\[hidden\] \{ display: none; \}/.test(read('src/index.css')))
}

console.log('== the old per-browser mask is taken, not just read')
{
  const mem = new Map<string, string>([['net.41chan.avatar_shape', 'keyhole']])
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, removeItem: (k: string) => { mem.delete(k) }, setItem: (k: string, v: string) => { mem.set(k, v) },
  }
  const { takeLegacyAvatarShape } = await import('../src/ui/avatarShape.ts')
  check('the first take returns it', takeLegacyAvatarShape() === 'keyhole')
  check('and removes it, so it is offered once', takeLegacyAvatarShape() === null && !mem.has('net.41chan.avatar_shape'))
  mem.set('net.41chan.avatar_shape', 'nonsense')
  check('a value that is no shape is removed too, and is not a shape', takeLegacyAvatarShape() === null && !mem.has('net.41chan.avatar_shape'))
}

console.log('== a failed profile change says what to do')
{
  const cases: [unknown, RegExp][] = [
    [{ errcode: 'M_LIMIT_EXCEEDED', httpStatus: 429 }, /Wait a few seconds and try again/],
    [{ errcode: 'M_TOO_LARGE', httpStatus: 413 }, /Choose a smaller picture/],
    [{ errcode: 'M_FORBIDDEN', httpStatus: 403, data: { error: 'no' } }, /refused it\. The server said: "no"\. If it keeps refusing, ask an admin/],
    [new TypeError('Failed to fetch'), /could not be reached\. Check your connection/],
    [new Error('That image is larger than 8 MB.'), /: That image is larger than 8 MB\.$/],
    [{ errcode: 'M_UNKNOWN', httpStatus: 500, message: 'boom' }, /Try again; if it keeps failing, reload the page/],
  ]
  for (const [err, want] of cases) {
    const said = describeProfileError(err, 'picture')
    check(`"${said}"`, want.test(said) && said.startsWith('Your picture was not saved') && !/HTTP \d/.test(said))
  }
  check('it names what failed', /^Your look was not saved/.test(describeProfileError({ httpStatus: 429 }, 'look')) && /^Your name was not saved/.test(describeProfileError({ httpStatus: 429 }, 'name')))
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
    /for \(const delay of delays\) timers\.push\(setTimeout\(\(\) => play\(delay === 0\), delay\)\)/.test(row) &&
    /if \(!speaks \|\| narrow \|\| anim === 'none' \|\| reducedMotion \|\| !animationsEnabled\) return/.test(row) &&
    /setTimeout\(\(\) => setPlaying\(null\), ANIM_MS\[anim\]\)/.test(row))
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nlook: all checks passed')
