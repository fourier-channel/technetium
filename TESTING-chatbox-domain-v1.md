# Test pass — branch `chatbox-domain-v1`

Unattended auto run of 2026-07-20. 6 feature commits, 2272 insertions / 15 files.
Never merged, never deployed, never human-verified. tsc clean, vite running on 5173.

**How to use:** tick `[x]` when done, write anything you noticed in the NOTES line
(leave it blank if it was fine). Hand the whole file back in one shot when finished.
Untracked scratch file — delete it after the pass, or I'll fold it into the devlog.

Legend: **(2nd)** needs a second identity in a Firefox container. **(PL50)** needs
that identity at power level >= 50. Everything else is solo.

---

## 1. Composer — emoji button (`😀`, right of the input)

- [ ] Button opens the picker; clicking it again closes it
      NOTES:
- [ ] Category tabs switch sections
      NOTES:
- [ ] Search box filters by keyword
      NOTES:
- [ ] Click mid-sentence in the input, then pick — emoji lands **at the caret**, not at the end
      NOTES:
- [ ] Picker stays open across several picks in a row
      NOTES:
- [ ] Escape closes it; clicking outside closes it
      NOTES:
- [ ] Caret is still usable after the picker closes (typing continues where expected)
      NOTES:

## 2. Composer — send path (markdown)

- [ ] `**bold**`, `*italic*`, `` `code` `` render as formatting, not literal characters
      NOTES:
- [ ] Fenced code block renders as a block with its own background
      NOTES:
- [ ] Bulleted + numbered lists render
      NOTES:
- [ ] `> blockquote` renders
      NOTES:
- [ ] A table renders (and does not blow out the column width)
      NOTES:

## 3. Message row — rich text rendering

- [ ] A bare `https://` URL in a **plain** message is clickable, opens in a new tab
      NOTES:
- [ ] A bare `http://` URL likewise; a bare `javascript:` or `data:` string is **not** linked
      NOTES:
- [ ] Multi-line plaintext keeps its line breaks (shift+enter a few lines)
      NOTES:
- [ ] Inline code / code blocks / quotes / lists / tables all legible in **light** theme
      NOTES:
- [ ] Same in **dark** theme
      NOTES:
- [ ] Long unbroken URL or code line does not push the layout sideways
      NOTES:

## 4. Message row — sender pillbox

- [ ] Every row leads with one rounded pill containing avatar + display name
      NOTES:
- [ ] Avatar image loads; where there is none, a colored initial shows instead
      NOTES:
- [ ] Name is the **display name**, not a raw `@user:41chan.net`
      NOTES:
- [ ] Timestamp sits outside the pill, trailing
      NOTES:
- [ ] Pill also appears on rows inside the **thread panel**
      NOTES:
- [ ] Pill also appears in the **domain mode chat panel**
      NOTES:
- [ ] Consecutive messages from one sender each get their own pill — confirm this is
      acceptable for now (sender grouping was deliberately not built)
      NOTES:

## 5. Timeline header — chat background button (`🖼`, "Chat background")

- [ ] Button opens the panel
      NOTES:
- [ ] **Upload image** picks a local file, uploads, applies as wallpaper
      NOTES:
- [ ] Paste a URL + **Apply URL** (or Enter) applies it
      NOTES:
- [ ] A bad URL surfaces the red error text rather than failing silently
      NOTES:
- [ ] **Dim for readability** slider visibly changes the overlay; message text stays legible at 0
      NOTES:
- [ ] **Remove** clears it back to default
      NOTES:
- [ ] Reload the page -> wallpaper persists (localStorage, per-room per-user)
      NOTES:
- [ ] Switch to another room -> that room has its **own** background, not this one
      NOTES:
- [ ] Wallpaper sits **behind** the message list, does not scroll with it
      NOTES:
- [ ] Same wallpaper shows under the domain mode chat panel (shared Timeline)
      NOTES:

## 6. Domain view — resize bar (between canvas and chat)

- [ ] Bar is visible and grabbable; cursor changes over it
      NOTES:
- [ ] Dragging grows/shrinks the chat panel
      NOTES:
- [ ] Pucks and objects do **not** move or rescale during the drag
      NOTES:
- [ ] **CD-23 decision:** at the default chat height the canvas bottom is clipped, so a
      puck near the bottom is off-screen until you shrink the chat. Acceptable, or switch
      to fit-to-default + letterbox?
      NOTES:
- [ ] Size persists across a reload (or note if it does not — persistence was not claimed)
      NOTES:

## 7. Domain canvas — media card right-click

- [ ] Right-click a media card -> menu with **Detach to canvas**
      NOTES:
- [ ] Detach creates a standalone image on the canvas
      NOTES:
- [ ] **(2nd)** the other client sees the detached object appear
      NOTES:
- [ ] Non-poster / non-admin does **not** get the Detach option
      NOTES:

## 8. Domain canvas — detached object (drag)

- [ ] Drag moves it; **(2nd)** the other client sees it move
      NOTES:
- [ ] A plain click (no drag) still opens the lightbox — 5px threshold holds
      NOTES:
- [ ] No text selection or ghost-image drag artifacts while dragging
      NOTES:
- [ ] Object survives a page reload
      NOTES:

## 9. Domain canvas — detached object right-click (owner/admin only)

- [ ] **Open image** works from the menu
      NOTES:
- [ ] Current permission is marked with the `•` bullet
      NOTES:
- [ ] **Anyone** -> **(2nd)** other user can drag it
      NOTES:
- [ ] **Only me** -> **(2nd)** a normal user cannot drag it
      NOTES:
- [ ] **Only me** -> **(PL50)** a mod-level user *can still* drag it. This is a known code
      gap (`useDomainObjects.ts:63-71` — admin short-circuits the perm check), which makes
      "Only me" behave identically to "Mods & me". Confirm whether that needs fixing.
      NOTES:
- [ ] **Mods & me** -> **(PL50)** can drag, **(2nd)** normal user cannot
      NOTES:
- [ ] **Whitelist (edit TBD)** -> selecting it locks the object to owner-only (empty list,
      no editor). Confirm you can still switch back out of it via the menu.
      NOTES:
- [ ] **Remove from canvas** clears it for **both** clients
      NOTES:
- [ ] A non-owner, non-admin gets no permission/remove items at all
      NOTES:

## 10. Domain canvas — own puck menu, Actions row

- [ ] Right-click own puck -> **Actions** row is present under Reset
      NOTES:
- [ ] **⬛ Square** pops a square beside you and it shrinks away after ~2s
      NOTES:
- [ ] **(2nd)** the other client sees the square
      NOTES:
- [ ] Reload -> the square does **not** replay from history (8s freshness gate)
      NOTES:

## 11. Domain canvas — other-user right-click menu

- [ ] Right-click another user -> **Throw ⭐** present
      NOTES:
- [ ] ⭐ arcs from you to them, spinning, and lands
      NOTES:
- [ ] **(2nd)** the target's client sees the same arc
      NOTES:
- [ ] **(2nd)** fire a Throw from a client that has *just* joined the room, while it is still
      syncing — does it animate, or get eaten by the 8s freshness gate?
      NOTES:
- [ ] Inspect / Force-collapse still work (not new, but same menu was touched)
      NOTES:

## 12. Accessibility — `prefers-reduced-motion`

Devtools -> Rendering -> Emulate CSS `prefers-reduced-motion: reduce`.

- [ ] Square becomes a fade rather than a pop
      NOTES:
- [ ] Throw appears at the target rather than arcing
      NOTES:
- [ ] Object dragging still fully works
      NOTES:

## 13. Login screen — alpha notice

- [ ] The alpha-client / report-anything-that-feels-off copy is present and reads correctly
      NOTES:

## 14. Passive — background self-heal (leave running all session)

Cannot be forced quickly. Check at the end of the pass.

- [ ] Domain background is still there after a long session (the old bug blanked it
      permanently on one transient fetch error)
      NOTES:
- [ ] If it ever did blank, switching tab away and back brought it back
      NOTES:
- [ ] Any red 401 / media errors in console worth reporting
      NOTES:

---

## Free-form

Anything that felt wrong, ugly, or off — UI satisfaction is the #1 goal, so
"I don't like how this looks" is a valid and wanted finding:

