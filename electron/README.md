<!-- coherence:hydrated -- canon is fourier-basis/docs/repos/technetium/electron/README.md
     Edit canon and run `coherence hydrate`, never this delivered copy.
     An edit here is drift: hydration will refuse to overwrite it and the
     doc axis reports it edited-in-place until someone promotes or discards it. -->
# Technetium desktop shell

Wrapper A: this shell loads the **deployed** client (`https://tc.41chan.net`)
rather than bundled assets. The client derives its OIDC `redirect_uri` from
`window.location.origin`, so serving the same origin keeps the registered MAS
client, the redirect and the CORS allow-list working with no production change
-- and a deploy updates the product without shipping a new installer.

Override the origin for testing with `TECHNETIUM_ORIGIN`.

## Layout

| File | Role |
|---|---|
| `main.js` | Window, security posture, single instance, `--qq` seam, menu |
| `preload.js` | The only bridge. Two booleans in, two booleans out. |
| `settings.js` | Per-installation prefs (atomic write via temp+rename) |
| `quickqueue.js` | argv parsing and the integration stubs |
| `navpolicy.js` | What the window may navigate to. Login depends on it. |
| `tests/run.js` | Table-driven checks for both pure modules (`npm run check`) |
| `consent/` | First-run disclosure + the two pill toggles |

Settings are per-INSTALLATION, not Matrix account data: they describe whether
this machine's shell has been claimed, which must not follow an account onto a
second machine.

## Running it on vesper (headless bench)

vesper has no display, but it can run Electron under Xvfb since the GTK/ATK
stack was installed 2026-08-19. Three environment facts, each of which costs a
confusing failure if missed:

1. **`ELECTRON_RUN_AS_NODE=1` is inherited** from the VS Code server that hosts
   editor terminals and agent sessions. It makes Electron run as plain Node, so
   `require('electron')` returns a path string and every API reads `undefined`
   -- with a stack trace pointing at your code, not at the environment. Always
   launch with `env -u ELECTRON_RUN_AS_NODE`.
2. **`chrome-sandbox` must be root-owned and mode 4755.** npm cannot set that,
   so it needs fixing after every install that replaces the binary. Do NOT
   reach for `--no-sandbox`: the renderer hosts remote content and the sandbox
   is part of the posture.
3. **Run a window manager.** Without one, X gives no focus or stacking, so
   clicks land on whatever was raised last and dialogs vanish behind the main
   window. `openbox` is enough.

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
Xvfb :99 -screen 0 1600x1000x24 & sleep 2
DISPLAY=:99 openbox & sleep 1
env -u ELECTRON_RUN_AS_NODE DISPLAY=:99 ./node_modules/electron/dist/electron .
# screenshot:  DISPLAY=:99 import -window root /tmp/shot.png
# stop:        pgrep -x electron | xargs -r kill     # -x, never -f (G-143bab)
```

`npm install` may skip Electron's postinstall; if `dist/` is absent, run
`node node_modules/electron/install.js`.

What the bench CAN prove: the window loads, the client boots, consent renders
and persists, single-instance argv forwarding, menu wiring. What it CANNOT:
anything Windows -- the shell verb, `MultiSelectModel`, the installer. Those
need the `claude-sandbox` VM.
