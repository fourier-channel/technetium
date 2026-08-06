# PARITY_PLAN.md -- technetium parity-v1 campaign ledger

> The spine of the parity-v1 campaign. A fresh session re-orients from
> CLAUDE.md + THIS FILE + the current wave section of the handoff.
> Never from re-reading the devlog, never from the audit xlsx.
>
> Every landed step writes its one-line result + pendings here IMMEDIATELY.
> The ledger is the compaction; history is dereferenced, not re-read.

---

## Compact state

| field | value |
| --- | --- |
| campaign | parity-v1 (30 features, 3 audit categories) |
| current wave | Wave 0 LANDED (`11743d1`) -- next up: Wave 1 substrate |
| branch | `parity-v1` (off `main`) |
| base HEAD | `d4d1494` (main, "Merge branch 'chatbox-domain-v1'") |
| current HEAD | see `git log -1` |
| tsc baseline | CLEAN (`npx --no-install tsc --noEmit -p tsconfig.app.json`, exit 0) |
| lint baseline | **23 problems (22 errors, 1 warning)** -- HOLD THIS NUMBER |
| build baseline | PASSING (`npm run build`, ~700ms, 1.38MB index chunk) |
| deploys | NONE. Ever. tc.41chan.net is the operator's. |
| new deps so far | none |

### Lint baseline detail (23 = the number to hold)

Pre-existing, not to be "fixed" opportunistically -- any change that
alters this count needs a ledger line explaining it.

| file | count | rules |
| --- | --- | --- |
| `src/client/ClientContext.tsx` | 7 | react-refresh/only-export-components, 2x "cannot access variable before declared", set-state-in-effect, 3x no-explicit-any |
| `src/client/members.ts` | 6 | no-explicit-any |
| `src/client/spaces.ts` | 3 | no-explicit-any |
| `src/client/tokenRefresher.ts` | 1 | no-explicit-any |
| `src/client/useMembers.ts` | 1 | set-state-in-effect |
| `src/client/useNavTree.ts` | 2 | set-state-in-effect + exhaustive-deps (the 1 warning) |
| `src/ui/Composer.tsx` | 1 | react-hooks/refs -- ref write during render (line 101) |
| `src/ui/Lightbox.tsx` | 2 | react-refresh/only-export-components, set-state-in-effect |

NOTE (correction to the handoff): the handoff names `useThreadList.ts`
set-state-in-effect (G-tc03) as the known pre-existing offender. It is
NOT in the current output -- that one is clean now. The live offenders
are the eight files above.

### Path corrections vs the handoff

- Devlog lives at repo root `devlog-technetium-01.md`, NOT
  `docs/devlogs/devlog-technetium-01.md`. Wave entries append there.
- `CLAUDE.md` already existed (Thread Cards v1 mission, now shipped).
  Wave 0 rewrote its mission block to point at this campaign; the
  operator's standing rules and environment facts were preserved verbatim.
- **`CLAUDE.md` is GITIGNORED by design** (`.gitignore:32`, the "brain/ops
  docs belong in fourier-basis, never in this public repo" guard). It was
  NOT force-added. It lives on vesper only -- so THIS LEDGER is the only
  tracked campaign artifact, and it is written client-clean accordingly:
  no infra internals, origins, ports, room names or gating config.

---

## Claudecision register (O-tp)

| id | decision | status |
| --- | --- | --- |
| O-tp1 | Server-wide member list stays EXCLUDED (recorded ruling wins over literal "all non-Yes"). | **CONFIRMED BY OPERATOR 2026-08-06** -- closed, not reopening |
| O-tp2 | Mute semantics: server push rule is source of truth; local mute setting survives as read-fallback, migrated forward on first toggle-touch (no silent mass-migration). Snooze stays local by design. | open, proceed |
| O-tp3 | Custom emoji standard is MSC2545 image packs (Cinny/nheko interop). | open, proceed |
| O-tp4 | Poll events follow whatever prefix matrix-js-sdk 41.x emits/parses natively; no hand-rolled event support. | open, proceed |
| O-tp5 | Room order persists locally under a `net.41chan.room_order`-namespaced key; account-data portability is a recorded v2 (same pattern as thread order). | open, proceed |
| O-tp6 | FLAG, not a task: redacting an image message does NOT remove its booru post. Cross-component design question for the bmb/chanbooru side. | recorded, no action |

### New this wave

| id | decision | status |
| --- | --- | --- |
| O-tp7 | Devlog stays at repo root (path correction above); no `docs/devlogs/` move -- moving a 122KB tracked file to satisfy a handoff typo is churn. | open, proceed |
| O-tp8 | CLAUDE.md mission block replaced rather than appended -- Thread Cards v1 is shipped (flip.ts, threadDrag.ts, threadOrder.ts, threadOrderStore.ts, pop.ts, reducedMotion.ts all present in tree). Standing rules + environment facts preserved. | open, proceed |
| O-tp9 | Test path is `checks/*.check.ts` run by `npm run check` -- standalone harnesses executed by Node's native TS type stripping. **Zero new dependencies** (no vitest/jest). Justification: the standing law REQUIRES sanitizer negative tests in Wave 2, so a test path must exist; the project already compiles under `erasableSyntaxOnly`, so its sources are directly Node-runnable; and the dependency stance here is prefer-hand-rolled. Constraint: a module under check must import matrix-js-sdk TYPES only. `checks/` is eslint-ignored and outside tsconfig.app's src-only include. If the operator would rather have vitest, this is one `npm i -D` and a rewrite of thin harness scaffolding -- cheap to reverse. | open, proceed |
| O-tp10 | S1 does NOT filter thread replies out of the main timeline. That is pre-existing behaviour (a threaded reply appears both inline and in the panel) and reads as deliberate for a chan-shaped client, so changing it is a product call, not a substrate one. Flagged, untouched. | open, operator's call |

---

## Server-config switchboard (OPERATOR ONLY -- never touched from this repo)

Client side always degrades gracefully: feature silently absent/disabled
when the server says no.

| item | wave | server requirement |
| --- | --- | --- |
| Presence | 4 | `presence.enabled: true` in homeserver.yaml (often off for perf -- operator's call) |
| URL previews | 5 | `url_preview_enabled: true` PLUS a correct `url_preview_ip_range_blacklist` (SSRF guard, not optional) |
| Message search | 5 | server-side `/search` support; Wave 5 probes the capability, falls back to a client-side filter over loaded events if absent |

Client-side rule for all three: probe, then degrade silently. Never fake a
state the server did not give us.

---

## Recon maps (Wave 0)

### Lane A -- timeline / composer / message rendering

**Item model.** `src/client/useTimeline.ts:15-25`
`interface TimelineItem { event: MatrixEvent; kind: TimelineItemKind; id: string; cells?: (MatrixEvent|null)[]; layout?: GalleryLayout }`,
kind at `:11` = `message|encrypted|redacted|other|gallery`. Conversion:
`classify(ev)` `:27`, `toItems(events)` `:64-117` (exported; ThreadPanel
uses it too). No sender/date/grouping/relation fields at all.

**Relations today: NONE.** No `m.replace`, `m.annotation`,
`m.in_reply_to`, `rel_type`, `getRelation`, `replacingEvent` anywhere in
useTimeline. Only subscription is `RoomEvent.Timeline` at `:165`.
Rebuild via `refresh()` `:130-136`; scrollback `:152-159` (depth 60),
`loadOlder` `:173-186` (page 30). No Redaction / LocalEchoUpdated /
Receipt / Typing / Decrypted listeners. Thread awareness is UI-only
(`Timeline.tsx:340` isThreadRoot, `ThreadChip` `:526-565`).

**Row anatomy.** `Row` is a separate exported component
`src/ui/Timeline.tsx:272-344`, **NOT memoized**, reused by
`ThreadPanel.tsx:109`. `SenderPill` `:212-270` (avatar `:233-252`, name
`:253-265`, timestamp `:267`) rendered at `:328`. Body dispatch
`:280-324`; text path `:302-312` uses `renderMessageBody` +
`dangerouslySetInnerHTML`. Footer slot = the thread chip line `:340` --
this is where reactions strip + receipts cluster land.
**Hover affordances: NONE.** No mouseenter, no toolbar, root row div
`:327` lacks `position:relative`.

**Composer.** `src/ui/Composer.tsx`, props `:53-63`
`{room, threadId?, domainTtd?}`. Single `send()` `:158-235`: text branch
`:167-186` (`sendHtmlMessage`/`sendTextMessage`, threadId overload split
`:172-176`), image branch `:191-235` (`uploadContent` `:202`,
`sendMessage(roomId, threadId ?? null, content)` `:216-219`).
Keyboard `:242-247`: Enter sends, Shift+Enter newline; **no Escape, no
ArrowUp, no Tab interception**. Caret machinery `:74`, `:87-96` (the
pattern mention-autocomplete insertion copies). No reply/edit mode state,
no draft persistence.

**Sanitizer.** `src/client/messageBody.ts:7-15` ALLOWED_TAGS =
b,strong,i,em,u,s,del,strike,a,code,pre,blockquote,ul,ol,li,p,br,hr,span,
h1-h6,sub,sup,caption,table,thead,tbody,tr,th,td. `:19` ALLOWED_ATTR =
href,title,alt,colspan,rowspan,start. Call site `:40-46` with
`ALLOW_DATA_ATTR: false`. So today: no `img`, no `mx-reply`, no `class`,
no `data-mx-*` -- reply quoting, spoilers, pills and hljs classes are ALL
stripped. Send side `messageFormat.ts:8-15` is narrower still
(ALLOWED_ATTR `:15` = href,title). Plain-vs-HTML trick: `parseInline`
`:33` -> sanitize `:34-38` -> compare vs `escapeHtml(plain).replace(/\n/g,'<br>')`
`:44`; identical => omit formatted_body `:45-47`. Because it is
`parseInline`, fenced code blocks NEVER produce `<pre><code>` today --
relevant to Wave 2 syntax highlighting.

**Hooks:** item model `useTimeline.ts:15`; fold point `:64-117`;
subscriptions `:165`; Row root `Timeline.tsx:326-343`; footer `:340`;
body render `:302-312`; allowlist `messageBody.ts:7-19`; composer send
+ keys `Composer.tsx:158-186`, `:242-247`; ThreadPanel parity `:72`, `:109`.

### Lane B -- nav tree / rooms / notifications / receipts

**Nav model.** `TreeNode` `src/client/spaces.ts:7-22`
(`roomId, name, isSpace, membership, joinRule, room, children`), hidden
`_order` stamped `:148` from `m.space.child`, consumed by `sortChildren`
`:49-56`. `NavTree = {spaces, orphanRooms}` `:24-27`; built by `buildNode`
`:139-154` from `getRoomHierarchy`; orphans (= DMs) `:163-180`.
Refresh: cheap overlay `rebuildFromCache` `useNavTree.ts:103-106` vs
authoritative refetch `:109-136`; `commit` `:90-99` rejects structure
regressions via `structureScore` `:58-60`. Listeners `:158-172`.

**Context menu.** Opened via `onContext` `NavTree.tsx:109-112`, rendered
`:408-415`, portal + viewport clamp `RoomContextMenu.tsx:53-54`.
Actions: Favorite `:110-114`, Mute/Snooze `:116-134`, icon grid
`:136-197`, Clear icon `:198-202`, Leave `:204-217`.
**New-action insertion points: `:114`** (after Favorite) for
mark-as-read / rename / invite; **`:203`** (before Leave) for
destructive-adjacent. `MenuItem` `:223-255`, `Divider` `:257-274`.

**Settings store.** `RoomListSettings` `src/ui/roomListSettings.ts:22-31`
(animationsEnabled, favorites[], icons{}, mutes{roomId: number|null},
soundEnabled, soundVolume, panelWidth, panelLocked); defaults `:33-44`;
API `:46-67`. **localStorage**, key `net.41chan.room_list_settings` `:20`.
Loader validation `RoomListSettingsProvider.tsx:10-28`, save `:30-36`,
mutators `:43-101`, memo API `:103-143`. Adding `renames` / `roomOrder`
touches exactly those six places. Comment `:16-17` already flags the
local-for-v1 stance and the deferred lift.

**Notifications / mute.** `useRoomNotifications.ts:33-70` returns
`Map<roomId,{total,highlight}>`, joined rooms only, 200ms debounce
`:39-42`, listeners `:54-58`. Local mute = `isMutedNow`
`RoomListSettingsProvider.tsx:121-126` (`null` = forever, number =
snooze-until vs Date.now). Applied at render only: `NavTree.tsx:804-807`
(name suppression) and `aggregateNotif` `:700-719` (check `:708`).
Known wart: `isMutedNow` is time-dependent but not re-evaluated on a
timer, so snooze expiry only surfaces on an unrelated re-render.

**Receipts.** `useReadMarker.ts:14-57`; the walk-back is the loop at
**`:29-37`** -- iterate live-timeline events backwards, skip local echo
(`ev.status`), skip missing/`~`-prefixed ids, skip `net.41chan.spatial.*`;
first survivor wins. Dedupe `lastSent` `:39`, send
`client.sendReadReceipt(target, undefined, true)` `:43`, visibility gate
`:22`. **Lift is clean**: the loop needs only a `Room` and pure
predicates -- no React, no client, no refs. Extract
`findReceiptableEvent(room)` + `markRoomRead(client, room)` into
`src/client/receipts.ts`; the hook keeps effect/listener/visibility only.

**Drag pattern to reuse.** `src/ui/threadDrag.ts`: `ThreadDragOptions`
`:76-83` `{containerRef, orderedIds, onReorder, flipControlRef}`;
`useThreadDrag(opts) -> {getCardHandlers(id), consumeClickSuppressed(id)}`
`:109-117`; measures `[data-flip-id]` descendants `measureCards` `:86-98`;
tunables `:28-42`. `threadOrderStore.ts`: `orderScopeKey` `:15-17`,
`loadCustomOrder` `:19-31`, `saveCustomOrder` `:33-39`, prefix `:13`.
`threadOrder.ts`: `arrangeByCustom` `:120-146` (unknown ids to TOP,
reported as new), `useDeferredThreadOrder` `:151-173` (freeze during
interaction, release on idle). Reference wiring: `ThreadList.tsx:94-108`
+ FLIP `:87-90`.

**Hooks:** mark-as-read `RoomContextMenu.tsx:114` + receipts helper;
room header `App.tsx:106-129` (existing per-room toolbar strip,
`selectedRoom` at `:23`/`:101`); rename consumed `NavTree.tsx:451` +
`:937` + width walk `:37-39`; room order applied `NavTree.tsx:391` and
`:657` over `sortChildren`; drag container ref `Sidebar.tsx:65`;
push-rule mute swaps `Provider:121-126` (read) + `:88-101` (write) with
consumers unchanged; invite/DM surface `MemberList.tsx` (mounted
`App.tsx:165`); create-room entry `Sidebar.tsx:65` region, refresh already
arrives via `useNavTree.ts:170-172`.

### Lane C -- members / profile / media

**Member model.** `MergedMember` `src/client/members.ts:20-26`
(`id, displayName, avatarMxc?, sources[], powerByRoom{}` -- SPACE rooms
only, DMs deliberately excluded). `MemberSource` `:28-33`. Merge
`useMembers.ts:12-27`, hook `:31-61`, 250ms debounce `:47`.
No honorific field -- derived.

**Honorific pipeline.** `Honorific = '~'|'@'|'+'|null` `members.ts:5`;
`honorificFor(pl)` `:7-12` (>=100 `~`, >=50 `@`, >=25 `+` [placeholder],
else null); `maxPower(m)` `:38-42` = max across powerByRoom = the
identity honorific. Labels `~ Owner / @ Moderator / + Voice` duplicated
at `DomainUserMenu.tsx:23-27`. Colors `MemberList.tsx:13-17`.
**Only sort today: `MemberList.tsx:50-52`, pure alphabetical.**
`orderKey` `:58` already drives FLIP/pop, so a sort change animates free.
Admin gate `DOMAIN_ADMIN_PL = 50` `domainRoles.ts:11`.

**Profile card.** `DomainProfileCard` `DomainUserMenu.tsx:117-220`,
props `:118-129` `{x, y, userId, room, onClose}`, portal `:162`, viewport
clamp `:158-160`, dismiss `:143-156`. Renders 56px avatar via
`AuthedImage(... viaHomeserver)` `:197` + `initials()` `:18-21`, name,
split user/:server `:139-141`, two Tag pills (standing + `PL {pl}`)
`:213-216`. **Coupling to domain mode is LOW** -- only reads
`room.getMember(userId)` `:131`. Lift is easy: widen `room` to
`Room | null`, fall back to `MergedMember` + `maxPower` when roomless
(needed for MemberList All/Nearby), move to `src/ui/ProfileCard.tsx`,
hoist `initials()` and `HONORIFIC_LABEL` into `members.ts`.

**Member list.** `MemberList.tsx` (205 lines), mounted `App.tsx:165`.
220px right rail `:64`, 3 modes `:73-77` (`room|all|all-highlight` `:10`),
count header `:80-82`, rows `:83-85`. `MemberRow` `:91-172`, root div
`:133-149` carries `data-flip-id` + `title`. **No click handlers at all
today.** ProfileCard wiring: row div `:134-148` onClick, anchor state at
`:22`, card render at `:86`, prop threaded at `:84`. Roster hydration
already handled `:34-38` + `useMemberBackfill` `:27`.

**Media / avatar.** `AuthedImage` `:14-38`, props include
`mxc, width?, maxHeight, fill, transparentLoading, fallback, viaHomeserver`;
owns object-URL lifecycle + retry backoff `:6-8`, `:90-98`. Avatars use
the **homeserver** path `:71-73` ->
`fetchHomeserverThumb` `media.ts:139-160` (Bearer, `/v1/media/thumbnail`),
deliberately bypassing the fourier-auth gate which 403s avatars
(comment `:132-138`) -- this is D-bf01. Non-avatar path `fetchMediaSrc`
`:96-130`, `THUMB_SIZES` `:31`.
**No upload helper exists**: raw `client.uploadContent` inlined at
`Composer.tsx:202`, `ChatBackground.tsx:87`,
`DomainBackgroundEditor.tsx:132`. Also absent everywhere in `src`:
`setAvatarUrl`, `setDisplayName`, `getProfileInfo`, `searchUserDirectory`,
`.invite(`, `createRoom`, `m.direct`, ignore-list. **Lane C's entire
write side is greenfield.**

**Hooks:** honorific sort `MemberList.tsx:50-52`; ProfileCard extract
`DomainUserMenu.tsx:117-129`; open from list `MemberList.tsx:134`/`:22`/`:86`;
open from sender `Timeline.tsx:212-268` (card state must live at `Row`
`:270` or a Timeline-level portal host); presence `members.ts:113-120`
subscribe block + model `:20-26` + `ensure()` `:75-88` + render
`MemberList.tsx:150`; UserPicker feeds off `useMembers.ts:31`;
upload helper extraction `media.ts:186` (end of file).

---

## Step rows

Status vocabulary: `todo | in-progress | landed | blocked | pending-eyes`.
PENDING = needs operator eyes in a browser (headless box cannot verify).

### Wave 0 -- recon, baselines, ledger

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| W0.1 | Clean `main`, branch `parity-v1` | landed | `11743d1` | branched off `d4d1494`, pushed to origin; only untracked file was `TESTING-chatbox-domain-v1.md` (left alone) |
| W0.2 | Record baselines | landed | `11743d1` | tsc clean; lint 23 (22e/1w); build passing |
| W0.3 | CLAUDE.md campaign block | landed | (untracked) | mission block replaced (O-tp8); standing rules preserved; file is gitignored by design, NOT force-added |
| W0.4 | 3 read-only recon lanes | landed | `11743d1` | maps above |
| W0.5 | O-tp register | landed | `11743d1` | O-tp1 CONFIRMED by operator; O-tp7/O-tp8 added |

### Wave 1 -- substrate (S1/S2/S3 file-disjoint, parallelizable; S4/S5 ride along)

| id | step | files | status | commit | result / pendings |
| --- | --- | --- | --- | --- | --- |
| S1 | Relations read layer: edits (`m.replace`), reactions (`m.annotation`), reply targets (`m.in_reply_to`) on the item model, live-updating | `useTimeline.ts`, new `relations.ts`, new `checks/` | **landed** | `fb7ab49` | Pure single-pass index, NOT the sdk RelationsContainer. Item gains `content`/`editedTs`/`reactions`/`replyTo`. Fixed 2 live bugs: remote edits rendered as duplicate rows, remote reactions as `[m.reaction]` junk. Forged-edit rejection + MSC3440 fallback suppression enforced. Added Redaction/LocalEchoUpdated/TimelineReset subs + burst coalescing. 36/36 pure checks pass. |
| S2 | Message action bar shell: hover/focus bar + keyboard reach + slot registry (no verbs) | `Timeline.tsx` | todo | | |
| S3 | Composer modes `normal|reply|edit` + banner + Esc cancel; threadId preserved | `Composer.tsx` | todo | | |
| S4 | Receipts helper extraction -> `client/receipts.ts`; useReadMarker becomes a caller | `useReadMarker.ts`, new `receipts.ts` | todo | | |
| S5 | ProfileCard promotion -> shared `ui/ProfileCard.tsx`; domain mode consumes it | `DomainUserMenu.tsx`, new `ProfileCard.tsx` | todo | | |

### Wave 2 -- message verbs (chain is SERIAL; lanes are parallel)

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| W2.1 | Reply composing (+ enriched reply pill, click-to-jump) | todo | | |
| W2.2 | Message editing (`m.replace`, "(edited)" marker) | todo | | |
| W2.3 | Redact / delete (two-step confirm, PL-gated) | todo | | |
| W2.4 | Row footer design note (ledger only, NO code) | todo | | |
| W2.5 | Reactions (strip, toggle, EmojiPicker anchored) | todo | | |
| W2.6 | Read-receipts display (seen-by cluster, +N cap) | todo | | |
| W2.7 | Pinned messages (`m.room.pinned_events` + panel) | todo | | |
| W2.8 | Forwarding (+ new `ui/RoomPicker.tsx`) | todo | | |
| W2.9 | Mention autocomplete (`@` popup, matrix.to anchor, `m.mentions`) | todo | | |
| W2.L1 | Syntax highlighting (`highlight.js` core + common; own commit + sanitizer note + negative tests) | todo | | dep: highlight.js PRE-APPROVED, needs DEPENDENCIES.md entry |
| W2.L2 | Spoiler RENDERING (`span[data-mx-spoiler]`, blur + click-reveal; own commit, security rigor) | todo | | |
| W2.L3 | Spoiler COMPOSING (`\|\|spoiler\|\|`, `\|\|reason\|text\|\|`) | todo | | must not false-trigger the plain-vs-HTML compare |
| W2.L4 | Typing indicators (`ui/TypingBar.tsx` + `useTyping`, relocated out of timeline flow) | todo | | needs a small Composer touch -- schedule into a chain gap |

### Wave 3 -- rooms & navigation

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| W3.1 | Mark-as-read (context menu, S4 helper, space-descendant iteration bounded) | todo | | |
| W3.2 | Room header: topic + joined member count | todo | | touches `App.tsx` toolbar -- coordinate with Wave 2 chain owner |
| W3.3 | Local room rename override (display-only, local) | todo | | |
| W3.4 | Custom room ordering (reuse threadDrag + G-bf01 capture fix) | todo | | O-tp5 |
| W3.5 | Server-side mute via push rules (`client/pushRules.ts`) | todo | | O-tp2 |
| W3.6 | UserPicker primitive (`ui/UserPicker.tsx`) | todo | | |
| W3.7 | Send invites (403 = insufficient PL, surfaced honestly) | todo | | |
| W3.8 | Start-a-DM (`m.direct` detection first, then createRoom) | todo | | |
| W3.9 | Create room / space (parent `m.space.child`, PL-gated, honest partial-failure message) | todo | | |

### Wave 4 -- members & presence

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| W4.1 | Honorific-based sorting (tier then alpha) -- tiny, do first | todo | | |
| W4.2 | ProfileCard wiring (member row + sender pillbox) | todo | | ONE coordinated Row touch -- after the Wave 2 chain closes |
| W4.3 | Edit own profile (`setDisplayName`, avatar upload -> `setAvatarUrl`) | todo | | CHROME media = homeserver path (D-bf01), NOT the gateway |
| W4.4 | Block / ignore (`setIgnoredUsers`, timeline filtering at toItems) | todo | | |
| W4.5 | Presence display (`useUserPresence`) | todo | | SERVER-GATED: render nothing when the server sends nothing -- no fake "offline" |
| -- | Server-wide member list | **EXCLUDED** | -- | O-tp1 confirmed by operator 2026-08-06. Closed. |

### Wave 5 -- heavy independents

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| W5.1 | Message search (`client/search.ts`, results panel, capability probe + honest partial fallback) | todo | | |
| W5.2 | Link previews (opt-in, authenticated endpoint, absent when server declines) | todo | | |
| W5.3 | Polls (`ui/PollBody.tsx`, live tallies, composer "+" create) | todo | | O-tp4 |
| W5.4 | Custom emoji + stickers (MSC2545 packs, custom-emote reactions, `m.sticker`) | todo | | O-tp3; depends on W2.5 |

### Wave 6 -- layout finale + closeout (serial, single agent)

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| W6.1 | Day separators (toItems marker items; Row untouched) | todo | | |
| W6.2 | Same-sender grouping (verify EVERY Wave 2 decoration survives) | todo | | this is why it is last |
| W6.3 | Full regression sweep (read-only agents: gates, stray debug, ledger truth, devlog completeness) | todo | | |
| W6.4 | Closeout: consolidated PENDING list, draft-NN register, DEPENDENCIES.md deltas, merge-readiness note | todo | | NO deploy -- state plainly it is the operator's |

---

## PENDING OPERATOR VERIFICATION (running list)

Headless box: typecheck / lint / build are self-verified. Anything
visual or interactive is claimed only as PENDING.

| id | what needs eyes | 2nd identity? |
| --- | --- | --- |
| (none yet -- Wave 0 landed no UI) | | |

Standing note: receipts, typing, reactions and presence all need a
SECOND identity. Use Firefox Multi-Account Containers, never a private
window, never the admin browser at the same origin (shared-origin storage
poisoning has cost a session before).

---

## Draft phase nodes (draft-NN -- never well-formed phase IDs, orphan rule G-e5128a)

| label | kind | note |
| --- | --- | --- |
| (none yet) | | |

Carried gotchas cited by ID this campaign: G-tc01 (React-Compiler lint:
no ref reads in render, no sync setState in effects), G-bf01
(setPointerCapture on pointerdown suppresses click -- capture only past
the drag threshold), G-bf03 (`client.sendEvent` needs its `this` --
never detach), G-bf04 (no floats in event content -- scaled integers),
D-bf01 (chrome media goes via the homeserver path, not the fourier-auth
gateway), JSX `\u` escapes invalid in raw JSX text.

---

## Dependency deltas

| dep | version | wave | rationale | DEPENDENCIES.md |
| --- | --- | --- | --- | --- |
| (none yet) | | | | |

Pre-approved ahead of time: `highlight.js` (core build + common languages
only) for W2.L1. Everything else needs a ledger justification first.
