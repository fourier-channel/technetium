<!-- phase:S-649543 -->
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
      +-- fourier-tunnel .... bridges images posted in Matrix into the booru
      +-- the guide ......... Fourier-chan: onboarding, the on-ramp, help rooms
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

**Fourier-chan**, the mascot, is her own Matrix user and her own service: a
tenant of the bot hub every site bot speaks through, not a passenger inside
another component. She greets each new account in a direct message with the
rules, and answering yes earns the invite to the community space; she runs the
on-ramp's `!join`, takes bug reports in the help rooms, and can run an
onboarding progression. That engine is off unless configured, and the only
step that would grant privileges automatically is disabled by default.

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
- **A leaked URL grants nothing.** Access is decided per request, before any
  byte is sent, and the only signed URL involved is short-lived and never
  leaves Cloudflare's edge.

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
<!-- traced: 2026-11-27 repo=fourier-auth@1b50197 -->

**Purpose:** let a metadata store reference media without storing or exposing
the bytes.

**How it works.** A user proves a Matrix identity, by an OIDC login against
MAS or, for a first-party client, by presenting its MAS token. A server-side
session in Redis maps an opaque cookie to that token; the token never reaches
the browser. When the browser requests an image it sends the cookie;
fourier-auth resolves it and answers the permission question by reading
Synapse's own database -- which room the media was posted in, whether the
viewer is joined. A message that has been deleted no longer vouches for its
image. Synapse's HTTP API is used only to identify the token's owner and list
the rooms it has joined, and its authenticated-media endpoint is not used at
all, because it authenticates the token without enforcing room membership.

If the answer is yes, a short-lived presigned R2 URL is made -- and released
only to the Cloudflare Worker in front of both public hosts, which proves it is
the Worker with a shared secret. Every other caller gets the decision and no
URL, so the presigned URL is never a reader's to leak. **No media byte passes
through this service.** It decides and steps out of the way. A thumbnail is a
rendition already stored in R2; one still being made is a short refusal to
retry, never the full image in its place. The Worker asks for the decision,
streams the object from R2 itself, and caches an allow for 150 seconds, or 60
for a booru image or a signed-out reader; the gate keeps its own allow for 120.
A signed-in reader's refusal is never cached; a signed-out refusal is kept for
twenty seconds, and a gate that is down is asked again when it said to retry.
So the bytes come from Cloudflare's edge, not
from one host in one datacentre, and an image that has just been jailed or
whose message was deleted stays readable for about three minutes. A viewer's
joined rooms are cached for five, so after leaving a room its images can stay
readable for up to about seven and a half.

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

Both fail closed. Above both sits the booru's quarantine: an image whose post
carries a flagged, banished or jail tag is refused at every door. The gate
re-reads that list every thirty seconds and holds only which files are on it,
never the tag that put them there.

The distinction is not fussiness. Asking "which room is this in" about an avatar
is asking a question that has no answer: an avatar is in no room and in all of
them at once, so the honest answer was zero rooms and fail-closed denied it.
Every profile picture on the server 403'd. The client had already routed around
the gate for avatars -- and a client working around a gate is the clearest
possible evidence the gate is answering the wrong question.

**A third route exists for content with no room at all.** An image scraped from
4chan lives in no Matrix room, so the membership question is meaningless for it;
it is authorised by the fourier session instead, by asking the booru, as that
reader, whether a post they may see carries that file. Same login, different
question. Conflating them would have meant either inventing a fake room or
weakening the real check. The same booru question opens one more door: a
Matrix image placed on a creator's public gallery, or shown on a live published
page, reaches a reader outside its rooms -- signed out included -- because the
booru shows them that post, and for no other reason. A booru that cannot be
reached is a refusal, never a yes.

**Why this is unusual.** Most sites check permission when the page is built.
This checks per request, and no reader is ever handed a URL that opens the
object by itself -- so a leaked link is not a leak.

---

## fourier-tunnel -- the bridge
<!-- traced: 2026-11-27 repo=fourier-tunnel@d27339f -->

**Purpose:** images posted in Matrix rooms become searchable without anyone
uploading them twice.

A Matrix application service, speaking only as the courier, Neru-chan. When
someone posts an image in a bridged room, the bridge downloads it through the
authenticated media API and strips it before anything else happens: the
generation data (prompts, settings, workflows) and anything that identifies
the person who made the file, such as location or device, come off the bytes
without touching the picture, by a list of what may stay rather than a list of
what must go. An image or video whose data cannot be removed is not posted at
all, and the bridge says so in the room. It then checks the booru by md5 so a
repost is never a second post, sends the stripped bytes to fourier-spectrum
for tags, creates the booru post with those tags and an artist tag minted from
the poster's Matrix name, and writes the tags back into the room as a state
event keyed by the image's MXC URI -- ready for a client to render and edit.
Prompt tags scraped from the generation data stay private: they reach neither
the booru's tag string nor the room, and the removed data itself is kept
privately for the image's creator. When the bot joins a room it works back
through the room's history in batches, keeping its place per room, and a
periodic sweep resumes any room it has not finished.

**The reasoning.** The MXC URI is the link between the two systems. Tags live in
both places on purpose: the booru can search them, and the Matrix room can show
them without asking the booru anything.

What is NOT copied is the image. Each image is kept as one stripped file in R2,
and every link to it -- in the room, in Technetium, on the booru -- leads to
that one file; the original the homeserver received is discarded. So a picture
posted in a room and searchable on the booru is one file with two names, not
two files that have to be kept in step. Authorisation is fourier-auth's
decision in both directions, read from the facts the homeserver holds; storage
is neither system's job.

---

## fourier-sampling -- acquisition, tagging, and the jail
<!-- traced: 2026-11-27 repo=fourier-sampling@89299e3 -->

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
source is kept as a record rather than a memory.

**The troll jail.** An operator-curated block list that does two jobs at once:
it keeps material out of storage and out of every downstream feed, and it keeps
each block as a labelled training example for a future classifier. Curation is
expensive, so nothing about a block is thrown away -- the reason, who blocked
it, when, and the thread it came from.

Blocking is by md5 *and* by perceptual hash, because md5 alone is defeated by a
single re-encode. The perceptual match is gated on an image-complexity floor: a
flat or gradient image collides trivially, and one thread of minimalist
wallpapers once produced 228 false matches.

Since 2026-08-30 the jail also runs automatically from tag rules. A rule names
either a tag that is enough on its own, or a family of tags that only counts
alongside a partner family, with exemptions -- because the interesting cases
are conjunctions: *arthropods with sexual or gross intent, but not Pokemon*
cannot be written as a list of tags, and trying produces either collateral
damage or nothing.

**Jail is not deletion.** A jailed post is a deleted post carrying the jail
tag, withheld from everyone but the pipeline's own bots, admins included; the
tag alone withholds it even if the deletion did not take. The bytes are
untouched, and in Technetium the message stays in the room with a placeholder
where the image was. Release is one operation, made only from the jail panel,
and jailings made on the booru itself are reported back to that panel. Actual
destruction is a separate, gated, deliberate act. That asymmetry is what makes
an automatic jail acceptable at all: the cost of a false positive is a review,
not a lost image.

Around that core sit a few smaller jobs. A back-fill reads the public archives
of past imageboard threads; it reads each archive's robots rules before every
sweep and identifies itself honestly, with no disguised or rotating exits.
Images can be found by their original filename. The lens mirrors live threads
into Matrix rooms, in order, each post linked to its booru page, and attaches
no image whose jail status it cannot read. And since 2026-11-27 a daily census
counts the previous day's visits to the web server: one line of numbers,
holding no address, header or browser string, with the key that told visitors
apart thrown away after the run.

---

## fourier-spectrum and the taggers
<!-- traced: 2026-11-27 repo=fourier-spectrum@44ee9fa -->

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
rules written in 2026-08-30 are largely in hydra's vocabulary. Since
2026-09-24 nothing is posted until every enabled route has tagged it, hydra
included: an image posted before hydra has seen it is one the jail never
judged in hydra's words.

**A measured decision worth recording.** Hydra costs about seventeen seconds an
image on the serving box, some forty-six core-seconds, and does not scale past three cores in
one process, so capacity is more instances rather than more threads. It was
149 seconds an image before a wrapper fixed a CPU pathology: the model
hardcodes bfloat16, correct on the GPU it was built for and 75x slower than
float32 on a CPU with no bf16 hardware path. The loader is wrapped, not
edited, so upstream fixes keep working. The serving box has no GPU; both
taggers also run as GPU copies on the operator's workstation, each an endpoint
of the same route. The workstation's copy is preferred while it is on and the
serving box's copies take over when it is not, and a health lamp says which one
is answering. A proposal to run hydra as a post-hoc batch worker on a rented
GPU is in canon, unruled.

**Routes serve both ends of the backlog.** A tagger pointed only at new images
never reaches old ones while new work keeps arriving; pointed only at old ones
it starves new uploads. The primary works oldest-first and gives a quarter of
every pass to the newest images, a minimum rather than a split -- whatever the
new end does not need flows to the archive. Hydra works in lanes instead:
urgent work (live threads and chat uploads) first, then catch-up, then the
backlog, with one instance always held back for urgent work.

---

## technetium -- the client
<!-- traced: 2026-11-27 repo=technetium@73b9fc1 -->

A custom Matrix client for the community, built from scratch on the Matrix
client-server API. It is the surface most people will spend their time in, and
it is a real client rather than a skin: spaces, threads, polls, search and
media all go through the same authorisation path described above, and the
booru is mounted inside it with a sign-in that costs no clicks.

Three things about it that a normal Matrix client does not do:

**Encryption is for direct messages, and it is on by default.** Content rooms
are unencrypted by design -- the pipeline tags what is posted in them. DMs are
end-to-end encrypted, with recovery keys, device verification, key backup,
encrypted attachments and a panel that says plainly what state your keys are
in; a browser can turn encryption off, behind the passphrase box in Settings.
The client runs in one tab per device, and another tab offers to take over
("Use it here") rather than running a second copy. The settings panel also
lists every session on the account and signs out the unverified ones, or all
the others, in one action.

**It asks before your browser reaches anything it does not control.** Before
the client hands your information to any third-party surface, it says so and
you can decline; every ambiguous state resolves to blocked.

**It has its own geography.** A pinned dock of direct messages and chat
interactions between users rendered in the timeline. A spatial "domain" view
of a room, with movable objects and per-domain backgrounds, is unfinished and
stays off unless a reader turns it on under unfinished features. A desktop
shell hosts the same deployed origin.

---

## chanbooru -- the fork
<!-- traced: 2026-11-27 repo=chanbooru@48a75cd -->

A Danbooru fork. What differs from stock Danbooru, and why:

**It serves no media.** Covered above. This is the largest single difference and
most of the others follow from it.

**Signup is by invite code and new accounts start restricted.** An admin issues
an invite code good for one registration, several, or unlimited, which can
expire or be revoked; without one the signup POST is refused. A viewer below
Member sees every list as one page of at most 20 posts -- page 2 answers 410
Gone -- and that ceiling clamps the `limit` parameter too, otherwise the
restriction would be one query parameter wide. Comments, notes and the forum
do not exist on this fork; they 404 rather than merely leaving the nav.

**It looks like a different site.** "Modulation" is a replacement skin and
post page -- gallery, navbar, landing panel at the root route, a session strip
-- and it is the default everywhere but the test environment. Upstream's
interface is still there underneath and holds to the same design tokens by
assertion (see fourier-formant).

**Some content does not exist below Gold.** A configured tag list marks
material the site will not serve casually. For anyone below Gold, signed out
included, those posts are removed from the query itself, so they are absent
from results, counts, pagination and next/previous navigation alike -- not
merely hidden from the page. The post page answers 404, the image is refused,
and the tag names themselves are missing from tag lists and autocomplete. The
only ways past are the creator's own grant and a live published page.
Separately, a signed-out visitor sees general-rated posts only, and pages that
are not public answer 404.

**Some content waits for review.** An admin can flag a tag, and the tag and
every post carrying it disappear at once for everyone but admins, the Owner and
the bots; from the review queue the flag is released or the tag banished. A
flag jails nothing. A published page is the deliberate exception in the other
direction: a thread published by a moderator, or a creator's timed link to a
few of their own posts, at a random address that can expire. While it is live
it shows its images to anyone holding the address, and it never releases a
jailed, banished or flagged image.

**Deleted posts are hidden at query level, not at render level.** Upstream
returns and counts them and declines to draw them, which is why a stock Danbooru
page can report more results than it shows. Here they are removed from the query.

**Private tags are never published to the page.** Creator-supplied tags marked
private do not reach the DOM. The deliberate consequence: a viewer's blocklist
cannot match a tag that viewer is not allowed to see -- you cannot filter on what
you cannot be shown, and the alternative is disclosing it. Only the creator
sees them; no grant reveals them to anyone else.

**Some words do not exist here.** A banished tag is removed from the
vocabulary for everyone, admins included, and every post carrying it is
withheld from everyone but the pipeline; moderating them happens in sampling's
troll jail panel, never on the booru. A viewer's own **blocklist** is a
different thing: a filter they keep, lock and edit, applied in their browser
to what they are already allowed to see. Neither is the content gating that
decides who may see a post at all.

**Tags carry provenance.** Every tag records whether it came from a creator, a
model, a human editor, or is metadata -- and a tag can be several at once. A
small lamp on each tag shows where it came from: orange for the primary
tagger, green for hydra, a green and orange swirl when both found it, white
when a person added it. The tag's own tint still says its category, and the
swirl holds still for a reader who asks for reduced motion.

For the operational detail of all thirteen gates, numbered 0 to 12, see `docs/CONTENT_GATING.md`
in chanbooru, published beside this page.

---

## fourier-formant -- why every surface feels the same
<!-- traced: 2026-11-27 repo=fourier-formant@a589b97 -->

Named for the resonances that make a vowel recognisable as that vowel regardless
of pitch, speaker or instrument: identity carried across wildly different
signals. Three stacks, one recognisable product.

It holds every design element the project uses, so that every surface reads
as one recognisable, familiar interface. That is more than colour: it is how
the site feels to use. Action A sits in the same place on every surface that
offers it, and option B's menu is exactly where you expect it to be.

So it holds three things: a token vocabulary -- colours, typefaces, radii,
spacing -- a grammar of where things go and how they behave, and a few small
widgets, such as the calendar, built without a framework so any surface can
carry them. Every font is a token, so a change to the site's design switches
every surface at once. The grammar has never had a home in most projects, and
it is the one that makes three separately-built surfaces feel like one site.

The public pages on 41chan.net -- the one you are reading included -- joined on
2026-09-17, and they were the last surface in the estate still painting from
values typed by hand: a pure black ground, and a green and an orange that
existed on these pages and nowhere else. They are not SERVED the token file,
because every page on that origin is a single self-contained file that cannot
break because a request did not arrive. The renderer reads the delivered copy
and writes the declarations into each page instead, and the command that
compares the two is that repository's gate -- so a page painting from something
other than canon fails a commit rather than going quietly out of step.

Four rules govern how the loud colours are spent, and they hold on every
surface:

- **Green is structure.** Headings, links, and anything you can act on. It
  means IMPORTANT.
- **Green is getting there.** In terms of completion, green is done with
  something still to do -- the fill that is rising. On a lamp, healthy.
- **Orange is complete, and the next thing to do.** Full completion, ready to
  go; and on a screen, the correct or next action -- the one thing it points
  people towards. It is not urgency, and it is never a warning.
- **Amber is a problem.** "There seems to be a problem": degraded, or close to
  a limit, but not failed -- a process nearing its memory ceiling, say. Red is
  the failure itself.

The sampling calendar is the worked example: a day's green border says it is
fully indexed, and its orange fill says everything in it has been captured.
Orange and amber sit close together on the wheel and mean opposite things:
orange says it is finished, or go here; amber says something may be wrong.

They are easy to invert and expensive to leave inverted. These generated pages
had green as the body text colour with orange on every heading, every link and
every inline name, which spent both colours on every sentence and left neither
able to mark anything. The ground underneath is now formant's warm dark grey
rather than black, flat to the edge -- the same ground Technetium sits on, so
moving between the client and the pages describing it no longer changes the
room. Since 2026-11-22 these pages also take their type and motion from
formant: IBM Plex, served from this origin, and two animations that end -- a
trace drawing itself in and a mark arriving. A reader whose system asks for a
light page gets formant's warm paper ramp with the same roles.

The tokens are delivered to each surface from canon, with a hash pointer beside
each copy, rather than copied by hand. chanbooru is the exception and holds
itself to them by ASSERTION instead: its tokens live inside a theme mixin
applied at a preset, while canon declares them at the root, and importing canon
directly would hand one preset's palette to the untouched upstream interface.
So a test compares the delivered file against every token the fork's preset
declares, and a value edited on either side fails the build rather than
drifting quietly.

---

## fourier-coherence -- keeping the copies honest
<!-- traced: 2026-11-28 repo=fourier-coherence@d75c30b -->

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
"changing it". The few things it can change are separate, named commands --
delivering canon, collecting memory, running a repository's declared gate,
starting a named job -- and none of them runs as a side effect of a look.

**Delivery.** Documents and tools that must be identical everywhere are
*hydrated* from canon into each consumer, with a pointer beside each copy
carrying the hash of what was delivered -- so staleness is machine-checkable
rather than assumed. A copy that has been edited in place and is also behind
canon is never overwritten: that edit exists in one place and nowhere else.

**The gate.** One Go/No-Go before a commit. Universal checks run identically
everywhere -- invisible characters in code, a canonical file's hash, secrets
sitting in environment files, documentation that hand-maintains a number a
command computes, a `CLAUDE.md` whose shared header has fallen behind canon, a
checkout that has fallen behind its origin. The repository's own tests stay the
repository's business, and since 2026-09-11 several repositories' tests include
a check that the README names what the code actually has. A repository can opt
in to a deploy tier: a passing run stamps the commit, and a deploy of a commit
with no stamp is refused.

**The plane.** An agent on each machine reports what it sees, and one board
shows every repository and service as GREEN, YELLOW, RED or UNKNOWN -- never a
confident green without a witness. It can also ask whether each running
process is running what was last pushed.

It also watches what is not in git at all: files that live both on the serving
box and in canon (the edge proxy's config, the booru's runtime config) are
compared by hash in both directions, and a security audit of the box's sshd,
secret file modes and service users runs on a timer. Every Claude Code session
on every machine reads and writes one memory store, kept in canon.

Three verdicts, not two: PASS, FAIL, and PARTIAL, and only PASS is a Go. A
skipped check is named and the run is marked PARTIAL rather than passed, because a gate that quietly covers
less than it appears to converts "I did not check" into "it passed".

---

## Principles you will see repeated

These are not aspirations; they are rules paid for by incidents, and they
explain most of the design decisions above.

**There exists one single source of truth.** Surfaces cannot disagree when they
share the same provenance.

**A check reporting success is evidence about the check, not about the thing it
guards.** Every expensive failure here has been a confident green rather than a
silence.

**Never fail silently, and never fail green.** If truth cannot be established,
stop and say so. Replacing a good report with an empty one is worse than
crashing.

**Unmeasured never renders as healthy.** A check that did not run must not look
like one that ran and passed.

**Stale state is a defect in and of itself.** A change rendered behind the
scenes should include the refresh mechanism that presents that change to
observers.

**Merge by adding, never by replacing.** A resumed or partial run must not
delete what an earlier one collected.

**Do not hand-maintain a fact that a command derives.** A test count belongs in
the command that produces it. Every number written down that could have been
computed is a number that will eventually be wrong.

**A gate is unlocked, not bypassed.** An unlocked gate still runs and still has
an opinion -- it just says "okay". A bypassed gate has its opinion discarded, and
cannot afterwards be asked why.

**A thousand no-gos is useless without a go.** Checks guard a process against
regression; the evidence that it works is the process run from beginning to
end, on the real thing, once. A turn that ends with checks green and the run
never attempted has verified nothing.
