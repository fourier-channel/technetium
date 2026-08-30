# How this site is different, and why

A guide to 41chan for people who will run it, and eventually for people who use
it. Every component, what it does, and the reasoning behind the choices that
will surprise someone arriving from a normal imageboard or a normal Danbooru.

CANON. Lives in `fourier-basis`; hydrated into consumers by `coherence hydrate`.
This file is the only copy anyone edits.

---

## The shape of the thing

41chan is not one application. It is a Matrix homeserver, a Danbooru fork, and a
custom web client, plus a pipeline that feeds them and a gate that guards them.
Six of those pieces are separate repositories, and the separations are load
bearing rather than organisational.

    Matrix (Synapse + MAS) ... identity, rooms, and the ONLY store of media bytes
      |
      +-- fourier-auth ...... the gate. every image request is authorised here
      +-- fourier-tunnel .... bridges images posted in Matrix into the booru
      +-- technetium ........ the web client people actually use
      |
    chanbooru ............... the Danbooru fork: metadata, search, tags
      |
      +-- fourier-sampling .. acquisition, tagging, posting, and the troll jail
      +-- fourier-spectrum .. the primary autotagger
      +-- fourier-formant ... the shared design vocabulary
      +-- fourier-coherence . keeps every copy of everything honest

---

## The one idea underneath all of it

**The booru holds no media.**

A normal Danbooru stores images and serves them. Here, Synapse is the single
authority for both storage and authorisation, and the booru holds metadata that
*references* media it does not have. Every byte a viewer receives has been
authorised, for that viewer, at request time.

This is the decision the rest of the design follows from, and it is why several
things work in ways that look roundabout:

- An exposed media URI is only a pointer. It grants nothing on its own.
- Deleting a post from the booru does not delete the image, and never could.
- "The page loads but images are broken" is a completely different failure from
  "the page is broken", because they are different systems.

The benefit is that permission is enforced once, in one place, by the system
that already knows who may see what -- rather than being re-implemented in every
surface that displays an image.

---

## fourier-auth -- the gate

**Purpose:** let a metadata store reference media without storing or exposing
the bytes.

**How it works.** A user proves a Matrix identity. A server-side session in
Redis maps an opaque cookie to that user's Matrix access token. When the browser
requests an image it sends only the cookie; fourier-auth resolves it
server-side, calls Synapse's authenticated media API with the token, and Synapse
decides. The token never reaches the browser.

**Two routes, because there are two questions.**

| route | asks |
|---|---|
| `/fourier/media/<server>/<id>` | does this user share the room this media is in? |
| `/fourier/booru/<md5>.<ext>` | does this user hold a valid fourier session? |

The second exists because an image scraped from 4chan lives in no Matrix room,
so the room-membership question is meaningless for it. Same login, different
question, and conflating them would have meant either inventing a fake room or
weakening the real check.

**Why this is unusual.** Most sites check permission when the page is built.
This checks on every byte, which means a leaked URL is not a leak.

---

## fourier-tunnel -- the bridge

**Purpose:** images posted in Matrix rooms become searchable without anyone
uploading them twice.

A Matrix application service. When someone posts an image in a bridged room, the
bridge downloads it through the authenticated media API, feeds a copy to the
booru for tagging, and writes the resulting tags back into the room as a state
event keyed by the image's MXC URI -- ready for a client to render and edit.

**The reasoning.** The MXC URI is the link between the two systems. Tags live in
both places on purpose: the booru can search them, and the Matrix room can show
them without asking the booru anything. Access to the underlying media is always
the homeserver's decision, in both directions.

---

## fourier-sampling -- acquisition, tagging, and the jail

**Purpose:** everything between "an image exists somewhere" and "it is a tagged,
searchable post".

It reads 4chan's public JSON API, lands threads and images in an md5-keyed
store, uploads to R2, runs the taggers, and posts to the booru. Since 2026-08-09
it owns that whole path.

Three parts worth knowing about:

**The md5 key.** One image is one object, everywhere, forever. The same picture
posted to two boards is one object with two sightings, not two objects. Every
count in the system is per image rather than per posting, which is why a repost
cannot look like the most popular thing in the corpus.

**Politeness is a claim about request counts.** The scraper's rate limits are
part of its design rather than a setting, and what has been asked of every
source is recorded and published alongside the data it produced.

**The troll jail.** An operator-curated block list that does two jobs at once:
it keeps material out of storage and out of every downstream feed, and it keeps
each block as a labelled training example for a future classifier. Curation is
expensive, so nothing about a block is thrown away -- the reason, who blocked
it, when, and the thread it came from.

Blocking is by md5 *and* by perceptual hash, because md5 alone is defeated by a
single re-encode. The perceptual match is gated on an image-complexity floor: a
flat or gradient image collides trivially, and one thread of minimalist
wallpapers once produced 228 false matches.

Since 2026-08-30 the jail also runs automatically from tag rules. A rule is
three sets -- a subject, an intent, and an exemption -- because the interesting
cases are conjunctions: *arthropods with sexual or gross intent, but not
Pokemon* cannot be written as a list of tags, and trying produces either
collateral damage or nothing.

**Jail is not deletion.** A jailed post is rendered inert -- tagged and
delete-flagged, so it 404s for ordinary viewers -- and the bytes are untouched.
Restoring it is one operation. Actual destruction is a separate, gated,
deliberate act. That asymmetry is what makes an automatic jail acceptable at
all: the cost of a false positive is a review, not a lost image.

---

## fourier-spectrum and the taggers

**Purpose:** image bytes in, tags out. Stateless, holds no media.

The name is the idea: a spectrum analyser decomposes a signal into component
frequencies; this decomposes an image into component tags.

Two models run, and they are not redundant.

**`wd-vit-tagger-v3`** -- the primary. A 94.6M-parameter vision transformer over
a Danbooru vocabulary of 10,861 tags (4 rating, 8,106 general, 2,751 character).
Fast enough to run on the upload in flight, about 0.7s on a four-core box. It
also handles video, by extracting keyframes.

**`hydra-3.5`** -- the secondary, added 2026-08-22. A different vocabulary
entirely -- an e621-derived taxonomy with six categories including species,
copyright, lore and meta, where the primary reports two. It is an image
classifier and cannot take video.

**Why two.** The whole point of a second opinion is that it is a different one.
Hydra sees things the primary has no words for, which is exactly why the content
rules written in 2026-08-30 are largely in hydra's vocabulary. The primary is
the required route: a post is never made on a secondary's tags alone, because
the poster has no update path and an image posted on partial tags would carry
them forever.

**A measured decision worth recording.** Hydra runs at 13.3 seconds an image on
this hardware. It was 149 seconds before a wrapper fixed two CPU pathologies:
the model hardcodes bfloat16, correct on the GPU it was built for and 75x slower
than float32 on a CPU with no bf16 hardware path; and PyTorch reads the host's
core count rather than the container's quota, starting twelve threads inside a
four-core budget. Neither is a patch to the model's own code -- the loader is
wrapped, not edited, so upstream fixes keep working.

**Routes serve both ends of the backlog.** A tagger pointed only at new images
never reaches old ones while new work keeps arriving; pointed only at old ones
it starves new uploads. Each route reserves part of every pass for the end it is
not pointed at, and the reserve is a minimum rather than a split -- whatever the
new end does not need flows to the archive.

---

## technetium -- the client

A custom Matrix client for the community. It is the surface most people will
spend their time in, and it is a real client rather than a skin: encryption,
spaces, threads and media all go through the same authorisation path described
above.

---

## chanbooru -- the fork

A Danbooru fork. What differs from stock Danbooru, and why:

**It serves no media.** Covered above. This is the largest single difference and
most of the others follow from it.

**Signup is closed and new accounts start restricted.** Accounts are made
deliberately. A viewer below the threshold sees at most 20 posts per search, and
that ceiling clamps the `limit` parameter too -- otherwise the restriction would
be one query parameter wide.

**Some content does not exist for signed-out visitors.** A configured tag list
marks material the site will not serve casually. For a signed-out visitor those
posts are removed from the query itself, so they are absent from results, counts,
pagination and next/previous navigation alike -- not merely hidden from the
page. A signed-in viewer below the threshold sees the listing without the image,
because for them there is something to do about it.

**Deleted posts are hidden at query level, not at render level.** Upstream
returns and counts them and declines to draw them, which is why a stock Danbooru
page can report more results than it shows. Here they are removed from the query.

**Private tags are never published to the page.** Creator-supplied tags marked
private do not reach the DOM. The deliberate consequence: a viewer's blacklist
cannot match a tag that viewer is not allowed to see -- you cannot filter on what
you cannot be shown, and the alternative is disclosing it.

**Tags carry provenance.** Every tag records whether it came from a creator, a
model, a human editor, or is metadata -- and a tag can be several at once. The
UI does not colour tags by which model produced them; provenance is recorded
because it is true, not because it should be decorated.

For the operational detail of all six gates, see `docs/CONTENT_GATING.md` in
chanbooru.

---

## fourier-formant -- why every surface feels the same

Named for the resonances that make a vowel recognisable as that vowel regardless
of pitch, speaker or instrument: identity carried across wildly different
signals. Three stacks, one recognisable product.

In the operator's words:

> "This will hold all of the design elements referenced across the project to
> produce one recognizable familiar interface. It's not just about the colors,
> it's about the way the site feels to use. If you want to do action A, the
> button is the same place as action A on another surface. If you want to change
> option B, the menu is exactly where you expect it to be."

So it holds two things: a token vocabulary -- colours, radii, spacing -- and a
grammar of where things go and how they behave. The second has never had a home
in most projects, and it is the one that makes three separately-built surfaces
feel like one site.

The tokens are delivered to each surface rather than copied. chanbooru is the
exception and holds itself to them by ASSERTION instead: its tokens live inside
a theme mixin applied at a preset, while canon declares them at the root, and
importing canon directly would hand one preset's palette to the untouched
upstream interface. So a test compares the delivered file against every token
the fork defines, and a value edited on either side fails the build rather than
drifting quietly.

---

## fourier-coherence -- keeping the copies honest

**Purpose:** the same thing existing in several places is the failure mode this
whole project is most exposed to, and this is the component that reports on it.

It began from one incident: a live production feature that existed only as an
uncommitted edit on a second checkout, saved by a `git pull` that happened to
abort rather than by any process.

It does three things:

**Observation never mutates.** It looks at every copy of every repository on
every machine and reports what disagrees. No path from that observation can
write, fetch or clone. An earlier engine cloned missing repositories as a side
effect of looking at them, which is how "reporting on the world" becomes
"changing it".

**Delivery.** Documents and tools that must be identical everywhere are
*hydrated* from canon into each consumer, with a pointer beside each copy
carrying the hash of what was delivered -- so staleness is machine-checkable
rather than assumed. A copy that has been edited in place and is also behind
canon is never overwritten: that edit exists in one place and nowhere else.

**The gate.** One Go/No-Go before a commit. Universal checks run identically
everywhere -- invisible characters in code, a canonical file's hash, committed
secrets, documentation that hand-maintains a number a command computes. The
repository's own tests stay the repository's business.

Three verdicts, not two: PASS, FAIL, and PARTIAL. A skipped check is named and
the run is marked PARTIAL rather than passed, because a gate that quietly covers
less than it appears to converts "I did not check" into "it passed".

---

## Principles you will see repeated

These are not aspirations; they are rules paid for by incidents, and they
explain most of the design decisions above.

**A check reporting success is evidence about the check, not about the thing it
guards.** Every expensive failure here has been a confident green rather than a
silence.

**Never fail silently, and never fail green.** If truth cannot be established,
stop and say so. Replacing a good report with an empty one is worse than
crashing.

**Unmeasured never renders as healthy.** A check that did not run must not look
like one that ran and passed.

**Merge by adding, never by replacing.** A resumed or partial run must not
delete what an earlier one collected.

**Do not hand-maintain a fact that a command derives.** A test count belongs in
the command that produces it. Every number written down that could have been
computed is a number that will eventually be wrong.

**A gate is unlocked, not bypassed.** An unlocked gate still runs and still has
an opinion -- it just says "okay". A bypassed gate has its opinion discarded, and
cannot afterwards be asked why.
