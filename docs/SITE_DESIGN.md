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
Each piece is its own repository, and the separations are load bearing rather
than organisational.

    Matrix (Synapse + MAS) ... identity, rooms, and site assets only.
      |                        Federation is closed: nothing leaves.
      +-- fourier-auth ...... the gate. every image request is authorised here
      +-- fourier-tunnel .... bridges images posted in Matrix into the booru,
      |                        and hosts Fourier-chan's onboarding
      +-- technetium ........ the web client people actually use
      |
    chanbooru ............... the Danbooru fork: metadata, search, tags
      |
      +-- fourier-sampling .. acquisition, tagging, posting, and the troll jail
      +-- fourier-spectrum .. the taggers (two models, one contract)
      +-- fourier-formant ... the shared design vocabulary
      +-- fourier-coherence . keeps every copy of everything honest
      +-- fourier-domain .... the public web pages, including this one
    fourier-basis ........... the private canon every other repo is delivered from

Identity is MAS (matrix-authentication-service): Synapse holds no passwords
and every login, on every surface, is an OIDC flow against MAS. Registration
on both the Matrix side and the booru side is by admin-issued token.

---

## The one idea underneath all of it

**Nothing stores the image except R2, and both surfaces show the same object.**

A normal Danbooru stores images and serves them. A normal Matrix homeserver
stores what its users post. Here neither does.

No user-posted media is kept on the homeserver at all. The only bytes it holds
are SITE ASSETS -- avatars, emojis, room icons -- the chrome the interface is
made of. Everything else goes to Cloudflare R2 and is served directly from R2.

**Viewing an image on the booru and viewing it in Matrix are the same object at
the same URL.** Not two copies kept in step; one file, referenced twice. One
URL, one check, one copy.

Three consequences, and they are the point:

- **It is fast for everyone.** R2 egress is free and Cloudflare caches at the
  edge, so an image is served from a location near the viewer rather than from
  one machine in one datacentre.
- **Storage does not multiply.** A picture posted in a room and mirrored to the
  booru is stored once, not twice, and the two can never disagree about what it
  is.
- **A leaked URL grants nothing.** Access is decided per request, before the
  redirect is issued, and the signed URL that results is short-lived.

Permission is enforced once, in one place -- fourier-auth, reading the facts
Synapse holds about rooms and membership -- rather than being re-implemented
in every surface that displays an image. Synapse is the source of the facts;
fourier-auth decides; R2 stores. None of the three does another's job.

Two things that follow, and both explain a whole class of confusion:

- Deleting a post from the booru does not delete the image, and never could.
  The booru holds a reference; the bytes are somewhere else and belong to
  another system.
- "The page loads but images are broken" is a completely different failure from
  "the page is broken", because they are different systems reached by different
  routes.

---

## fourier-auth -- the gate

**Purpose:** let a metadata store reference media without storing or exposing
the bytes.

**How it works.** A user proves a Matrix identity, by an OIDC login against
MAS or, for a first-party client, by presenting its MAS token. A server-side
session in Redis maps an opaque cookie to that token; the token never reaches
the browser. When the browser requests an image it sends the cookie;
fourier-auth resolves it and answers the permission question by reading
Synapse's own database -- which room the media was posted in, whether the
viewer is joined. Synapse's HTTP API is used only to validate the token, and
its authenticated-media endpoint is not used at all, because it authenticates
the token without enforcing room membership.

If the answer is yes, the caller gets a short-lived presigned R2 URL.
**No media byte passes through this service.** It decides and steps out of the
way. Since 2026-09-06 a Cloudflare Worker in front of both public hosts asks
this service for the decision, caches an allow at the edge for four minutes
(never a denial), and streams the object from R2 itself -- so the bytes come
from Cloudflare's edge, not from one host in one datacentre, and a viewer
who leaves a room can read for at most four more minutes.

An earlier version proxied from Synapse whenever R2 could not answer. That was
deleted rather than switched off, for two reasons: it put media bytes through
this host, and -- worse -- it meant a request this gate had already refused
could still be served through the fallback. A gate with a path around it is not
a gate.

**It classifies the object first, then asks the right question.** This is the
part that is easy to get wrong, and it was wrong once:

| the object is | the question |
|---|---|
| a site asset -- avatar, emoji, room icon | is this token one of ours? |
| content -- anything a user posted | is the caller in a room containing it? |

Both fail closed and there is no third answer.

The distinction is not fussiness. Asking "which room is this in" about an avatar
is asking a question that has no answer: an avatar is in no room and in all of
them at once, so the honest answer was zero rooms and fail-closed denied it.
Every profile picture on the server 403'd. The client had already routed around
the gate for avatars -- and a client working around a gate is the clearest
possible evidence the gate is answering the wrong question.

**A third route exists for content with no room at all.** An image scraped from
4chan lives in no Matrix room, so the membership question is meaningless for it;
it is authorised by the fourier session instead. Same login, different question.
Conflating them would have meant either inventing a fake room or weakening the
real check.

**Why this is unusual.** Most sites check permission when the page is built.
This checks per request, before any URL is handed out, and the URL it hands out
expires -- so a leaked link is not a leak.

---

## fourier-tunnel -- the bridge

**Purpose:** images posted in Matrix rooms become searchable without anyone
uploading them twice.

A Matrix application service. When someone posts an image in a bridged room, the
bridge downloads it through the authenticated media API, checks the booru by
md5 so a repost is never a second post, sends the bytes to fourier-spectrum for
tags, creates the booru post with those tags and an artist tag minted from the
poster's Matrix name, and writes the tags back into the room as a state event
keyed by the image's MXC URI -- ready for a client to render and edit. Prompt
tags scraped from AI-image metadata stay private: they reach neither the
booru's tag string nor the room. When the bot is invited into a room it walks
the room's history once and catches up.

**The reasoning.** The MXC URI is the link between the two systems. Tags live in
both places on purpose: the booru can search them, and the Matrix room can show
them without asking the booru anything.

The same appservice carries **Fourier-chan**, the mascot, as her own user: she
greets each new account, offers the on-ramp room, and can run an onboarding
progression. That engine is off unless configured, and the only step that
would grant privileges automatically is disabled by default.

What is NOT copied is the image. The homeserver pushes what it receives straight
to R2, and the booru is given a reference to that same object -- so a picture
posted in a room and searchable on the booru is one file with two names, not two
files that have to be kept in step. Authorisation is the homeserver's decision
in both directions; storage is neither system's job.

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
Fast enough to run on the upload in flight: about a second and a half for a
still on the deployed four-core cap. It also handles video, by extracting
keyframes, and the service runs one inference at a time behind a queue that
puts a user's upload ahead of the scraper's backlog.

**`hydra-3.5`** -- the secondary, added 2026-08-22. A different vocabulary
entirely -- an e621-derived taxonomy with six categories including species,
copyright, lore and meta, where the primary reports two. Like the primary it
is a still-image classifier; video reaches either only because the service
decodes keyframes first.

**Why two.** The whole point of a second opinion is that it is a different one.
Hydra sees things the primary has no words for, which is exactly why the content
rules written in 2026-08-30 are largely in hydra's vocabulary. The primary is
the required route: a post is never made on a secondary's tags alone, because
the poster has no update path and an image posted on partial tags would carry
them forever.

**A measured decision worth recording.** Hydra costs about seventeen
core-seconds an image on this hardware and does not scale past three cores in
one process, so capacity is more instances rather than more threads. It was
149 seconds an image before a wrapper fixed a CPU pathology: the model
hardcodes bfloat16, correct on the GPU it was built for and 75x slower than
float32 on a CPU with no bf16 hardware path. The loader is wrapped, not
edited, so upstream fixes keep working. No box in the suite has a GPU; a
proposal to run hydra as a post-hoc batch worker on a rented one is in canon,
unruled.

**Routes serve both ends of the backlog.** A tagger pointed only at new images
never reaches old ones while new work keeps arriving; pointed only at old ones
it starves new uploads. Each route reserves part of every pass for the end it is
not pointed at, and the reserve is a minimum rather than a split -- whatever the
new end does not need flows to the archive.

---

## technetium -- the client

A custom Matrix client for the community, built from scratch on the Matrix
client-server API. It is the surface most people will spend their time in, and
it is a real client rather than a skin: spaces, threads, polls, search and
media all go through the same authorisation path described above, and the
booru is mounted inside it with a sign-in that costs no clicks.

Three things about it that a normal Matrix client does not do:

**Encryption is for direct messages, and it is opt-in.** Content rooms are
unencrypted by design -- the pipeline tags what is posted in them. DMs can be
end-to-end encrypted, switched on per browser from Settings, with recovery
keys, device verification, key backup, encrypted attachments and a panel that
says plainly what state your keys are in. The settings panel also lists every
session on the account and signs out the unverified ones in one action, which
Element makes you do one at a time.

**It asks before your browser reaches anything it does not control.** Before
the client hands your information to any third-party surface, it says so and
you can decline; every ambiguous state resolves to blocked.

**It has its own geography.** A pinned dock of direct messages, a spatial
"domain" view of a room with movable objects and per-domain backgrounds, and
chat interactions between users rendered in the timeline. A desktop shell
hosts the same deployed origin.

---

## chanbooru -- the fork

A Danbooru fork. What differs from stock Danbooru, and why:

**It serves no media.** Covered above. This is the largest single difference and
most of the others follow from it.

**Signup is by token and new accounts start restricted.** An admin issues a
signup token good for one registration, several, or unlimited; without one
the signup POST is refused. A viewer below the threshold sees at most 20 posts
per search, and that ceiling clamps the `limit` parameter too -- otherwise the
restriction would be one query parameter wide. Comments, notes and the forum
do not exist on this fork; they 404 rather than merely leaving the nav.

**It looks like a different site.** "Modulation" is a replacement skin and
post page -- gallery, navbar, landing panel at the root route, a session strip
-- and it is the default everywhere but the test environment. Upstream's
interface is still there underneath and holds to the same design tokens by
assertion (see fourier-formant).

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
you cannot be shown, and the alternative is disclosing it. A creator can open
that door per person with a tag grant, which is a whitelist on their own tag.

**Some words do not exist here.** A banished-tag list removes terms from the
vocabulary for everyone, admins included unless they switch a reveal on; an
enforced blacklist hides the same material from every viewer's view without
touching any account's own list. Both are distinct from the content gating
that decides who may see a post at all.

**Tags carry provenance.** Every tag records whether it came from a creator, a
model, a human editor, or is metadata -- and a tag can be several at once. The
UI does not colour tags by which model produced them; provenance is recorded
because it is true, not because it should be decorated.

For the operational detail of all seven gates, see `docs/CONTENT_GATING.md`
in chanbooru, published beside this page.

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
secrets, documentation that hand-maintains a number a command computes, a
`CLAUDE.md` that has fallen behind canon. The repository's own tests stay the
repository's business, and since 2026-09-11 each repository's tests include a
check that its README names what the code actually has.

It also watches what is not in git at all: files that live both on the serving
box and in canon (the edge proxy's config, the booru's runtime config) are
compared by hash in both directions, and a security audit of the box's sshd,
secret file modes and service users runs on a timer. Every Claude Code session
on every machine reads and writes one memory store, kept in canon.

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

**Current state is not a rule.** A convention with no author is a previous
session's assumption that got old. What the operator ruled, with a date, is a
rule; everything else is current state, changed when the work needs it and
left alone when it does not.

**A thousand no-gos is useless without a go.** Checks guard a process against
regression; the evidence that it works is the process run from beginning to
end, on the real thing, once. A turn that ends with checks green and the run
never attempted has verified nothing.
