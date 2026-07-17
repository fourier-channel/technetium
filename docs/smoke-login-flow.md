# Login flow — "need to feel it" smoke list

> Things that compiled + self-verified (tsc / eslint / build) but that only a
> human driving the running app can actually confirm. Kept updated per L-step,
> alongside the code. Branch: `login-flow`.
>
> Run: on `login-flow`, dev server up (`tmux attach -t vite`), app at
> 127.0.0.1:5173. Log out to reach the landing.

## L1 — landing + choice node
- [ ] Logged out, the landing shows the wordmark + **Create account** / **Log in**
      on a clean surface with the faint signal-grid (not the old bare button).
- [ ] **Create account** opens the choice node: "Walk me through it" vs "I know
      what I'm doing". **Back** returns to the landing.
- [ ] Every door reaches the real MAS sign-in (advanced/login immediately; guided
      after the walkthrough — see L3).
- [ ] A deliberately broken logo (bad `src`) leaves the wordmark text, no error
      box, no layout shift (SilentBoundary / asset fallback).

## L2 — perceptible boot + stale-then-live rooms
- [ ] First load ever (no cache): a MOVING boot screen (signal-spectrum bars),
      not a static word; then the shell with a top progress bar while syncing.
- [ ] Second load (cache warm): the room list **paints instantly, dimmed, with a
      pulsing "Syncing your rooms…" dot**, then reconciles to full opacity the
      moment live sync lands. Live vs stale is obvious.
- [ ] The stale list never gets wiped to empty mid-sync (the guard): rooms don't
      flicker to blank before going live.
- [ ] Reduced-motion: boot bars / stale pulse / progress sweep go static, still
      functional.
- [ ] Reload with rooms open a couple times — the cached shape matches what you
      actually have (names/nesting), not a wrong/old shape that misleads.

## L3 — guided walkthrough (Fourier-chan)
- [ ] (pending build)

## Watch items
- [ ] Cache is `localStorage` key `net.41chan.server_shape` — clearing site data
      should fall back cleanly to the first-load boot, not error.
- [ ] Mid-sync, the center pane shows the room-less state, not a crash, with no
      room selected.
