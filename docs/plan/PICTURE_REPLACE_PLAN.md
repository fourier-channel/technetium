# PICTURE_REPLACE_PLAN.md -- creators replace their own posts' pictures

> Ledger for the asks of 2026-10-19. Spans technetium, fourier-tunnel and
> chanbooru; kept with technetium's because that session took the brief.
> Written client-clean.

---

## The brief, as given

Operator, 2026-10-19: "Do we have a way for creators to upload new/higher
quality versions of their posts, while still keeping track (though not
necessarily keeping) of the original(s)?" Then: "Creator only." Then: "Sorry.
Creator only. The Matrix image link should just switch to the updated file
url and a reload should be forced on that post. The creator can then decide
to keep old copies of those posts, or allow them to expire after x period, at
which point a collector grabs them to schedule for deletion."

| id | ask | state |
| --- | --- | --- |
| P1 | Creators (only) replace their own post's picture | Technetium `a0b004a` (held) + fourier-tunnel `22bf6ab` (deployed, off); booru door HANDED to chanbooru |
| P2 | The Matrix image link switches to the new file; a reload is forced | DONE by design: the gesture is an edit of the picture message (below) |
| P3 | The original is tracked, not necessarily kept | booru PostReplacement row (old md5, size, dimensions, source); HANDED |
| P4 | The creator chooses: keep the old file, or let it expire after x | choice sent on the edit (`net.41chan.replace.old_file`, keep/expire, default keep); storage and later change HANDED; **x NOT RULED** |
| P5 | A collector schedules expired old files for deletion | HANDED to chanbooru; schedules, never deletes |
| P6 | "Keep it" is the default; the next time, the dialog starts on the last choice; ask to keep only for a compelling reason | DONE technetium `1ec09d6` (account data `net.41chan.replace_prefs`) |
| P7 | Originals kept 24 h regardless; "don't keep" can be undone inside that window; no "refresh" loophole | technetium `1ec09d6` (card offers only what the booru allows); the window, anchored to the replacement and enforced server-side, HANDED to chanbooru |
| P8 | A repost of the same picture is the same picture: replaced everywhere | fourier-tunnel `6bbf571` (canon repoint of every copy + `index/replaced/<old md5>.json`), technetium `1ec09d6` (versioned URLs, live refetch), fourier-auth `9fd3fb3` (forget door + Worker `v`; route approved by the operator 2026-10-19: "a fairly handy tool for forcing a refresh on any given link"), wired in fourier-tunnel `2ea1099`; fourier-auth deploy waits on its owner |

## Readings chosen

- **The gesture is a Matrix edit (m.replace) of the creator's own picture
  message.** That is the link switching: the message names the new mxc, every
  client draws the edited content, and a new URL is a reload no cache stands
  in front of. Re-pointing the OLD mxc to the new file was considered and
  rejected: fourier-auth caches canon's index 24 h and thumbnails 6 h, and
  downloads are served immutable for a year, so an old URL cannot be made to
  change for a reader who already has it. Only the sender can edit, which is
  the creator-only rule; Neru-chan checks it again and the booru checks the
  RECORDED creator (FourierPostCreator).
- **One file.** The new picture is made canonical by canon.js (stripped, one
  object, generation data under its own md5); the booru post is pointed at
  THAT upload's media asset -- nothing is sent twice and nothing is copied.
- **Old-file default is keep** until x and the default are ruled: nothing is
  lost by a default.
- **The collector's check.** An old file may be scheduled after expiry when no
  post holds its md5 and no mxc other than the creator's own replaced message
  carries those bytes (gate-3 aliases registered before the replacement are
  other people's re-uploads still showing the original).
- **Found on the way:** the tunnel had no edit handling at all; a picture
  edit's fallback carries a url, so any picture edit would have been posted
  as a new picture. Every edit is now consumed first; backfill and catch-up
  skip edits (fourier-tunnel `22bf6ab`).

## Verified, and not

- fourier-tunnel suite green; mutations of the sender check and the backfill
  edit filter fail the new tests; deployed 2026-10-19 with
  `bridge.replace` absent (off).
- technetium gate green; `checks/pictureReplace.check.ts` pins the edit
  shape Neru-chan parses; dialog CSS rendered headless; in the served
  v2026.10.19.2 bundle, held behind `VITE_REPLACE_PICTURE`.
- **NOT verified:** any live replacement -- the booru door does not exist yet.

## Open

- chanbooru: the creator-replacement door, retention fields, creator-only
  later change, the collector.
- fourier-auth `9fd3fb3` and the Worker deploy (fourier-sampling-85's, after
  the 2026-10-19 booru-visibility incident clears).
- Then: `bridge.replace.enabled: true` on the box, `VITE_REPLACE_PICTURE=1`,
  and a first live replacement on one of the operator's own posts.
