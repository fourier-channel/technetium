# BUR_PLAN.md -- bulk update requests through Neru-chan, decided in chat

> Ledger for the asks of 2026-10-19. It spans three repos, and is kept with
> technetium's because that session took the brief. Written client-clean: no
> infra internals, origins, ports, room ids or gating config.

---

## The brief, as given

Operator, 2026-10-19. The first ask was "information on chanbooru's BUR as it
relates to fourier-tunnel. I want to enable Neru-chan to make bulk changes to
images in response to moderator+ giving her commands in a certain channel."
After the research report came back, the operator added:

> "If anything needs immediate fixing on the chanbooru side, send a message
> out to that session to take it over. Assume that yes an admin will be
> approving the BURs somehow, I'll let you figure out the surface it belongs
> on, based on the designs from other surfaces we've implemented. And I'm
> going to lower the BUR level: It'll be a check against level in
> [the bots room] - let's say anyone with Voice or higher can submit there.
> That'll give the Voice honorific its first real use. People who are trusted
> to do BURs will get a + locally in [the bots room], which will be visibly
> active when they are in that room, and present-but-dimmed in other rooms."

| id | ask | state |
| --- | --- | --- |
| B1 | Report on chanbooru's BUR system and how it relates to fourier-tunnel | DONE, given in the session (summary under "What the booru does") |
| B2 | Hand anything on chanbooru that needs fixing now to the chanbooru session | HANDED 2026-10-19 to chanbooru-cc (items below); it accepted and queued them behind its current gate |
| B3 | Neru-chan files a BUR when someone at Voice (PL 25) or higher in the bots room commands her | DONE fourier-tunnel `59d76d3`, deployed and switched on 2026-10-19 |
| B4 | An admin approves it, on a surface modelled on what already exists | DONE technetium `ef05e14`, promoted as v2026.10.19 |
| B5 | A trusted person's + is active in the bots room and present-but-dimmed in other rooms | DONE technetium `ef05e14`, promoted as v2026.10.19 |

---

## Readings chosen

- **Moderator+ became Voice+, read live.** The gate is the sender's power
  level in the bots room, at least 25, read from that room's
  `m.room.power_levels` on every command. Giving someone a + there is the
  whole grant, and taking it away revokes it. A room version 12 creator
  counts as unlimited power, because such creators are never listed in
  `users`.
- **She files, and never approves.** On this fork nearly every BUR line needs
  ADMIN to approve. An approved BUR runs as the booru's system user, which
  is exempt from the creator-tag lock. A bot that approved on a Voice user's
  say-so would effectively make Voice an admin. Her account only needs
  Member.
- **The approval surface is the chat, built the way client tag edits are.**
  Her reply carries `net.41chan.bur: {id}`. That is a pointer, the same
  shape as `net.41chan.media.tags`' `post_id`. The card reads the BUR live
  from the booru as the viewer. An admin approves or rejects it as
  themselves, through their own booru session: a simple POST with the CSRF
  token in the body, so there is no preflight. The booru's own permissions
  decide. The BUR's own page on the booru is the fallback.
- **The card reads only Neru-chan's messages.** Anyone else's message
  carrying the key is drawn as plain text.
- **What the card offers** comes from `burActions()`. Once the booru serves
  per-viewer `can_approve` / `can_reject`, those decide (B2 item 6). Until
  then, booru Admin (read from `/profile.json`) gets the buttons, and an
  unknown level gets none.
- **The + rule is one function** (`members.ts` `shownHonorific`), asked by
  the member list and by the timeline's user line. A rank held in the room
  being viewed is drawn at full strength, even when the person ranks higher
  elsewhere. With no rank here, the highest rank they hold elsewhere is
  drawn dimmed. Before this, the timeline drew room-local rank only, and the
  member list drew a dim @ for a moderator who was voiced in the room being
  viewed. Both behaviours are replaced.

---

## What the booru does (B1, for the next reader)

- **The script** is at most 100 lines and 20,000 characters, and `reason`
  is required. Commands: alias, rename (refused when the tag has more than
  200 posts), imply, unalias, unimply, update/mass update, nuke, category,
  deprecate, undeprecate, convert.
- **Approval level** is the highest that any line needs. That is ADMIN
  except for two cases: an alias between small artist tags needs BUILDER,
  and an implication between small character tags needs MODERATOR. Any line
  touching a creator, claimed or quarantined tag needs ADMIN.
- **Reject** is open to an admin or to the BUR's creator, only while the
  BUR is pending. A failed BUR can be approved again.
- **No auto-approve.** A pending BUR is rejected automatically after 45
  days.
- **Execution.** A background job (GoodJob, no retry) runs the lines one at
  a time as the system user, with no transaction across lines.

## Handed to chanbooru (B2)

1. Mass update, nuke, convert and implications do not keep the tag
   provenance sidecar in sync; only alias and rename do. Added tags show as
   unsourced, and removed tags leave orphan rows. One reading of the code
   lets a private creator row hide an added tag, after which the cleanup
   strips it.
2. `post.save` in mass update skips a failing post silently, and the BUR
   still reports approved.
3. A failure part-way leaves the earlier lines applied, with no record of
   which line failed.
4. Approving a script that fails re-validation is a 500. It should be a 422
   with the reason. Agreed shape: `message`, plus
   `errors: [{line, text, reason}]` on both create and approve.
5. Every BUR still creates a forum topic, while the forum is retired.
6. Per-viewer `can_approve` / `can_reject` on the BUR's JSON.
7. Confirm credentialed CORS covers `/bulk_update_requests/*`.
8. Confirm that bulk matching including hidden posts is intended.

---

## Verified, and not

- **Neru-chan's suite is green.** Mutating the level gate fails her new
  tests, and so does mutating the address scrub.
- **On production,** her account's credentials reached the booru's BUR
  route. A deliberately invalid script came back 422 with
  `Invalid line: ...` in the Rails errors hash, which her parser relays.
  Nothing was created.
- **On production,** she is joined to the bots room and can speak there.
  Exactly one account in that room held level 25 or more on 2026-10-19.
- **Technetium's gate is green.** `checks/booruBur.check.ts` fails when the
  sender guard is mutated, and when the rank rule is mutated. The card's CSS
  was rendered headless (`tools/visual/burcard.html`). The served bundle
  carries the card.
- **NOT verified (PENDING OPERATOR VERIFICATION):**
  - a real `!bur` from a Voice account, end to end;
  - an admin approving and rejecting from the card against the live booru,
    which depends on B2 item 7;
  - the + drawn dim in another room, live.

## Open

- B2 items 1-8 (chanbooru).
- The card switches to the booru's per-viewer fields when B2 item 6 lands.
  `parseBur` already reads them.
- Neru-chan does not announce an approved or failed BUR. The card shows
  status live for anyone looking. A chat line on completion would need her
  to poll, and nobody asked for it.
