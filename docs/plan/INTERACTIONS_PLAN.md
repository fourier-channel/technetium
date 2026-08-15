# INTERACTIONS_PLAN.md -- expressive-media campaign ledger

> Spec + ledger for four related features requested 2026-08-13/14:
> user interactions in chat, a real domain action catalog, custom and
> animated emoji, and a GIF picker.
>
> Same discipline as PARITY_PLAN.md: a fresh session boots from CLAUDE.md +
> this file. Every landed step writes its result here immediately. Written
> client-clean -- no infra internals, origins, room names or gating config.

---

## Compact state

| field | value |
| --- | --- |
| campaign | interactions-v1 (4 areas) |
| branch | `interactions-v1` off `main` (`aeab785`), pushed |
| tsc / lint / build | CLEAN / 23 (HOLD) / PASSING |
| checks | 571 at start -> **626** |
| deploys | operator's call, as always |

---

## The through-line

All four areas are the same idea: **the client can say things that are not
sentences.** A slap, a sticker, a reaction, a badly-chosen GIF. The technical
shape is shared -- an ephemeral or embedded piece of media, addressed at a
person or a message, rendered without disturbing the log.

Three constraints apply to all four and are not negotiable per-feature:

1. **Nothing may reflow the log.** Every animation runs on transform / opacity
   / filter / clip-path over an absolutely-positioned or inline-block layer.
   This is G-tp19 and G-tp20, learned twice already.
2. **Ephemeral means ephemeral.** An interaction that fires at you should not
   replay every time you scroll past it a month later. Live-only, age-gated,
   same as the existing domain actions.
3. **No silent failure** (D-tp16). A send that fails says so.

---

## Area 1 -- Chat interactions ("Slap")

**Goal.** Right-click a person in the chat -- their sender pill, or their row --
and pick an interaction from a catalog. It plays for everyone in the room,
anchored to the two people involved, and then it is gone.

**Transport.** A new PL0 timeline event `net.41chan.interaction`:

    { id, action, target?, ts }

Modelled on the deployed `net.41chan.domain.action` and deliberately a
SEPARATE type: the domain event is live in production and its consumers assume
canvas coordinates. Sharing a type to save a constant would mean every domain
client parsing chat events it cannot place.

**Rendering.** An overlay layer above the timeline, not inside a Row. Rows are
recycled by scrolling and re-laid-out by grouping; an animation parented to one
would die mid-play when its row re-rendered. The overlay resolves the sender and
target rows by `data-event-id` / a per-user anchor at play time, and simply does
not play if it cannot find an anchor (the person is scrolled out of view) --
an interaction with an off-screen target is not worth faking.

**Catalog (v1).** Deliberately small and physical -- these read better than
abstract ones:

| id | shape | reads as |
| --- | --- | --- |
| `slap` | targeted | an elastic sticky hand snaps out, smacks, recoils |
| `poke` | targeted | a finger jabs, target wobbles |
| `hug` | targeted | two arcs meet, a soft pulse |
| `boop` | targeted | a quick nose-tap, small bounce |
| `highfive` | targeted | two hands meet at the midpoint, impact flash |
| `wave` | self | a hand waves beside your pill |
| `sparkle` | self | twinkles around your pill |
| `rip` | self | a small headstone drops in |

**Decisions.**

- **D-in01 -- targeted at a PERSON, not a message.** "Slap the person who said
  that" is the intent; anchoring to an event id would make a slap vanish when
  its message scrolled away. The target is a user id; the anchor is wherever
  that user's most recent visible pill is.
- **D-in02 -- the actor is always the sender.** No spoofing: the wire carries
  no actor field, so an interaction is authored by whoever sent the event, and
  the renderer reads `getSender()`. This is the same forged-authority hole the
  poll and edit paths had to close.
- **D-in03 -- rate-limited per sender.** One interaction per person per ~3s,
  enforced by the RECEIVER as well as the sender. A client that spams cannot
  make everyone else's chat unusable.
- **D-in04 -- interactions do not enter the message log.** They are filtered
  out of `toItems` like spatial events already are, so a room's history is
  still readable as conversation.

**Open questions.**

- **O-in1** Should an interaction be visible to someone who has the room open
  but is scrolled far back? Recommendation: no -- play only if both anchors
  resolve on screen. Cheap, and avoids an animation flying at nothing.
- **O-in2** Mute: should a per-room "no interactions" toggle exist? A busy
  room could get noisy. Recommendation: yes, in the room-list settings, and it
  should also gate the domain actions.

---

## Area 2 -- Domain action catalog

The transport already exists (`useDomainActions`, deployed) and its registry
comment says the catalog is deliberately TBD, "per the operator -- do not
invent the catalog". **That gate is now lifted** (operator, 2026-08-14), so the
registry can grow from its two proof-of-concept entries.

**Decision D-in05 -- one catalog, two surfaces.** The action *definitions* move
to a shared pure module; the chat and domain hooks keep their own transports and
render layers but read the same catalog, tagged by which surfaces can play them.
Duplicating the definitions would guarantee the two drift.

**Not** unifying the transports: the domain hook is deployed and working, its
lifecycle is entangled with canvas positions, and a refactor there cannot be
verified from a headless box. The genuinely shared parts (parsing an action
event, the freshness gate) are extracted as pure functions and covered by
checks; the React lifecycle is left alone. Recorded rather than tidied.

---

## Area 3 -- Custom and animated emoji

**What already exists (W5.4, partial):** MSC2545 packs are READ from room state
(`im.ponies.room_emotes`) and account data (`im.ponies.user_emotes`), and a
custom-emoji REACTION renders its mxc as an image. What is missing is
everything a user would call "custom emoji support": they cannot browse them,
send them inline, or add any.

**Steps.**

- **E1 -- packs in the picker.** Custom packs become sections in EmojiPicker,
  above the unicode sets. Searching matches shortcodes.
- **E2 -- inline sending.** Picking a custom emoji inserts `:code:` in the
  composer; on send, shortcodes are replaced with `<img data-mx-emoticon
  src="mxc://..." alt=":code:" title=":code:" height="32">` per MSC2545, with
  the plain-text body keeping `:code:` so non-supporting clients read something
  sensible.
- **E3 -- inline rendering.** The sanitizer must allow `img` with
  `data-mx-emoticon`, `src` (mxc only), `alt`, `title`, `width`, `height`.
  **This is a sanitizer widening and therefore SECURITY-CRITICAL** (campaign
  standing law): its own commit, minimal, with tests proving `javascript:`,
  `data:` and non-mxc `src` still die.
- **E4 -- animated.** Animated emoji are just GIF/APNG/WebP mxc URLs. The work
  is not decoding but RESTRAINT: a wall of animated emoji is unreadable. Ship
  with a "play animated emoji" preference (default on) that swaps to a static
  first frame when off, honouring `prefers-reduced-motion` automatically.
- **E5 -- upload.** Add-emoji flow: pick file, name it, upload, write the pack
  entry. Room packs need power; the personal pack does not.

**Decision D-in06 -- the media carveout is REAL and BOUNDED.** The standing
"no uploaded media on 41chan" rule is carved out for emoji, per the operator
2026-08-14, on the grounds that emoji are UI assets rather than content. The
boundary that keeps this honest: emoji uploads carry
`net.41chan.ui_asset: true` and are POSTED nowhere -- they are referenced only
from pack state, never as an `m.image` in a room. That makes them invisible to
the booru pipeline by construction rather than by a filter someone has to
remember. Note this is the exact inverse of the background decision (D-tp15),
where the fix was to MAKE it a post so the media gate would authorize it; emoji
therefore need the gate to serve pack-referenced media, which is an operator-side
question (**O-in3**) and the one genuine external dependency in this area.

**Open questions.**

- **O-in3 -- RESOLVED 2026-08-15, and the question was posed wrong.** It asked
  whether the media gate would serve an mxc referenced only from pack state.
  Reported symptom: emoji render when first posted, then 404 on reload. Both
  render sites went through the content gateway, which authorizes by POST, and
  a pack emoji deliberately has no post behind it (D-in06). The answer is not to
  ask the gate at all -- `viaHomeserver`, the same routing avatars take
  (D-bf01). Client-side, nothing needed from the operator, and E5's rendering
  half is unblocked. **Carried to E4:** `fetchHomeserverThumb` requests a
  THUMBNAIL, which will flatten an animated emoji to its first frame.
- **O-in4** Size cap for an uploaded emoji. Recommendation: 256KB and 128px,
  rejected with a sentence, not a bare 413.

---

## Area 4 -- GIF picker

**Status: blocked on a vendor contract I could not obtain, and building it
anyway would be guessing.**

KLIPY is real (klipy.com; GIF, sticker, clip and meme APIs) and is one of the
three pickers Zulip supports alongside GIPHY and Tenor. For all three, the API
key is explicitly NOT a secret -- every browser gets a copy -- so a client-side
picker is the intended shape and no proxy is required.

What I could not get: `docs.klipy.com` refuses automated fetches (403), so the
exact base URL, auth parameter, endpoint paths, pagination and response schema
are unverified. **Writing an adapter from memory would produce code that looks
finished and 404s**, which is the failure class this project has spent two
campaigns learning to refuse.

**So the split is:**

- **G1 (buildable now)** -- everything provider-agnostic: a `GifProvider`
  interface, a normalized `GifItem` (id, preview url, full url, dims, alt), the
  picker UI (trending, debounced search, infinite scroll, keyboard), insertion
  into the composer, and rendering. Degrades to "no GIF provider configured"
  when none is set, which is the honest state for a fresh install.
- **G2 (operator-gated)** -- the concrete adapter. Needs the vendor docs and a
  key. Once G1 exists this is one small file: URL construction plus a response
  mapper, with defensive parsing that reports an unrecognised shape rather than
  silently returning nothing.

**Decision D-in07 -- GIFs are sent as links, not re-uploaded.** A GIF is
somebody else's hosted asset. Re-uploading it to the homeserver would put
third-party content into the media store, create a booru post, and multiply
storage for no gain. It sends as an `m.image` whose `url` is the remote https
URL with `info` carrying the dims... **which Matrix does not allow** -- `url`
must be an mxc. Two honest options, and this needs the operator (**O-in5**):
either re-upload after all (accepting the booru implication, which the
`net.41chan.ui_asset` flag from D-in06 could also cover), or send as a plain
link and let the URL preview render it. Recommendation: re-upload with the
ui_asset flag, since a link-only GIF is a worse experience than every other
client offers.

**Two things the operator should weigh before picking a provider:**

- KLIPY's stated business model places **ads between content** and it ships an
  Ads API. Whether ad units appear in a picker for a community client is a
  product decision, not a technical one.
- All three providers see a search query and an IP for every user who opens the
  picker. That is a privacy surface this project has otherwise been careful
  about (the URL-preview opt-in exists for exactly this reason). Recommendation:
  the GIF picker is opt-in per user, same as previews.

---

## Step ledger

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| A1.1 | Shared action catalog (pure) | **landed** | | 10 entries, tagged by surface. `MAX_INTERACTION_MS` bounds how long an instance may sit in state, so a bad `action` cannot leak a node. |
| A1.2 | Chat interaction transport + rate limit | **landed** | | Actor read from `getSender()`, never content (D-in02). Freshness rejects the FUTURE as well as the past, so a chosen timestamp cannot pin an animation on screen. Receiver-side rate limit, and a backwards clock jump does not unlock it. |
| A1.3 | Overlay render layer + anchors | **landed** | | Anchors resolved once from the DOM at play time, in the scroller's coordinate space; a play whose anchor is off-screen is DROPPED, not aimed at the edge (O-in1). `AvatarPill` carries `data-user-anchor`, so every sender pill and membership row is an anchor for free. |
| A1.4 | Right-click entry point | **landed** | | Menu owned by Timeline (two rows cannot each open one), reached through a context like `profileOpener`. Targeted actions are filtered out when the target is you. Rate-limited state says so rather than doing nothing. |
| A2.1 | Domain catalog expansion | **landed** | | Registry now DERIVED from the shared catalog, filtered to the domain surface. The canvas renderers needed no change: `SelfActionEffect` and `ThrownProjectile` both animate whatever glyph the definition carries, so growing the catalog is a data change. Checks assert the deployed ids `square` and `throw` survive -- renaming either would make live clients emit events this one silently ignores. |
| E1 | Custom packs in the picker | **landed (reactions only -- see note)** | | Packs appear as a star tab and are searchable by shortcode. Wired ONLY into the reaction picker, which is the one surface that can use an mxc key today: an annotation's key IS the mxc and the strip already renders it as an image, so this is a complete slice rather than a half one. The composer is deliberately NOT given packs -- offering an emoji there that pastes `mxc://...` as literal text would be worse than not offering it. That needs E2+E3. **Known cost:** each custom emoji in the grid is its own authed fetch, so a large pack means many small requests.
| A1.5 | Overlay coordinate fix | **landed** | | The layer was mounted INSIDE the scroller, where `inset: 0` pins a child to the top of the SCROLLED CONTENT, while anchors were measured against the scroller's VISIBLE box. The two origins differ by exactly scrollTop, so every play drew off screen and was clipped -- the menu worked, the event went out, and nothing appeared. Layer now positions from its own box and is mounted as a sibling of the scroller. Geometry extracted to `ui/interactionGeometry.ts` (pure) so the two boxes are separate arguments. **Operator-confirmed working.** |
| A1.6 | Choreography pass: slower, three staged forms | **landed** | | Durations roughly doubled (a check refuses anything under 1.4s). One shared targeted animation became three, chosen by a `choreo` field on the definition rather than an id switch. **slap** = travel: whip along an arc, stick for ~40% of the play, tear off straight back. Arc side is HASHED FROM THE PLAY ID, not random, so sender and receiver stage the same slap identically. **poke/boop/hug** = approach: the actor's own avatar disc arrives beside the target and acts there. Avatar disc extracted to `ui/AvatarDisc.tsx` + `ui/avatarLook.ts` so the overlay draws THE pill's disc, not a copy. **Bug fixed on the way:** an approach needs only the TARGET's anchor, where every targeted play previously required both -- so a poke was dropped whenever the actor had not spoken recently enough to be on screen. O-in1 unchanged; the definition now says which anchors it is about. |
| E2 | Inline sending (shortcode -> MSC2545 img) | | | |
| E3 | Sanitizer widening (SECURITY, own commit) | | | |
| E4 | Animated emoji + preference | | | |
| E5 | Upload flow (gated on O-in3) | | | |
| G1 | Provider-agnostic GIF core + picker UI | | | |
| G2 | Concrete adapter (gated on docs + key) | | | |

---

## Carried from the previous pass

- **Green/orange unread counters: DEFERRED, no longer a standing request**
  (operator, 2026-08-14). Recorded for possible revisit. The counts they need
  now exist (G-tp23), and the current treatment -- orange glow, `(N)`, `@`
  ping, letter pulse -- is what ships. Nothing about this is blocked; it is
  simply not wanted yet.
- **UI7-i CLOSED:** six arrival variants is the right number (operator,
  2026-08-14). Pacing settled at 0.9-1.1s.

---

## PENDING OPERATOR VERIFICATION -- interactions-v1

Headless box: gates are self-verified, behaviour is not.

| id | what needs eyes | 2nd identity? |
| --- | --- | --- |
| IX-a | Right-click someone's sender pill -> menu with things aimed at them plus things you do yourself. Right-click YOUR OWN pill -> only the self list. | no |
| IX-b | Slap another identity: the hand travels from your pill to theirs, stretches on the way, impacts, and snaps back. Both clients see it. | yes |
| IX-c | It plays over the log without moving ANYTHING -- no reflow, no scroll jump, even while following the bottom. | no |
| IX-d | Scroll the target's pill off screen, then have them slap you: nothing plays, and nothing errors. That is the designed behaviour (O-in1), not a bug. | yes |
| IX-e | Fire two in a row: the second is refused and the menu says so rather than appearing to do nothing. | no |
| IX-f | Interactions do NOT appear as rows in the message log, and history has no `[net.41chan.interaction]` junk. | yes |
| IX-g | Rejoining / reloading does not replay a burst of old interactions. | yes |
| IX-h | `prefers-reduced-motion`: a small worded label instead of an animation. | no |
| IX-i | Domain canvas: the puck menu now offers the fuller self list, and right-click -> targeted actions arc across as before. **`Square` and `Throw` must still work** -- they are what the deployed client sends. | yes |
| IX-j | Reaction picker: a star tab appears when the room or your account has an MSC2545 pack; picking one reacts with the image. Searching matches shortcodes. | yes |
| IX-k | **Judgement call: is the catalog right?** Ten entries, glyph-based. Naming, additions and removals are one array in `interactionCatalog.ts`. | no |

### Added 2026-08-15 -- choreography pass + emoji routing

| id | what needs eyes | 2nd identity? |
| --- | --- | --- |
| IX-l | Pacing: every interaction now reads as an event rather than a flicker. Judgement call -- durations are one number each in `interactionCatalog.ts`. | no |
| IX-m | **Slap:** winds up, whips out along a curve that visibly bows to one side, STICKS to the target for about a second, then snaps straight back. Repeat slaps bow both ways over time, and both clients see the SAME slap bow the same way. | yes |
| IX-n | **Poke / boop:** your avatar disc (not the whole pill) blinks in beside the target and jabs with the finger, which points AT them rather than away. Poke jabs twice; boop is one touch from above. | yes |
| IX-o | **Hug:** your avatar fades in to the RIGHT of their pill, slides left onto them, the hug emoji appears only once they have met, rocks left and right, then bounces up and fades. | yes |
| IX-p | **Poke someone while your own pill is scrolled out of view.** It must now play -- an approach needs only the target. A slap in the same situation is still correctly dropped. | yes |
| IX-q | Custom emoji survive a reload: react with a pack emoji, hard-refresh, the image is still there rather than a "?" (O-in3). | yes |
