<!-- coherence:hydrated -- canon is fourier-basis/docs/repos/technetium/README.md
     Edit canon and run `coherence hydrate`, never this delivered copy.
     An edit here is drift: hydration will refuse to overwrite it and the
     doc axis reports it edited-in-place until someone promotes or discards it. -->
# Technetium

A custom [Matrix](https://matrix.org) client for the 41chan community.

Technetium is a from-scratch web client built directly on the Matrix
Client-Server API. Its goal is a more compact, familiar chat experience than
existing Matrix clients tend to offer -- closer to the everyday tools people
are already used to. It speaks standard Matrix, and it is also shaped around
one deployment: authentication is delegated to
[matrix-authentication-service (MAS)](https://github.com/element-hq/matrix-authentication-service),
session management talks to MAS directly, and a family of `net.41chan.*`
state and account-data events drives layout and the features below. On
another homeserver it works as a plain client; those features stay dormant.

## Status

**Alpha, deployed, in daily use by its community.** Single-developer software
that changes constantly. There is no stable version and no support; the
in-app banner asks for bug reports. If you need a mature Matrix client today,
use [Element](https://element.io).

## What it does

- The ordinary chat surface: replies, edits, redactions, reactions, read
  receipts, pinned messages, forwarding, mention autocomplete, threads,
  polls, search, spaces, typing indicators, link previews, a lightbox for
  media, room creation and a user directory.
- **End-to-end encryption for direct messages**, off by default and switched
  on per browser behind a passphrase. Encrypted DMs, encrypted attachments
  with sender-side thumbnails, device verification by emoji, key backup,
  recovery keys (set up, restore, rotate), and a settings panel that says
  plainly what state your keys are in.
- **Sessions**: the settings panel lists every session on the account and
  signs out the unverified ones, or all others, in one action.
- **Sliding sync** (MSC4186) behind a build flag, through a deliberate
  deep-import of the SDK's internals. Re-verify before any SDK bump.
- **A DM dock**: a pinned panel of direct messages across the top of the
  main column, with lock, pin and proportional resizing of every pane.
- **Domain canvas**: a spatial room view with movable objects, per-domain
  backgrounds and moderation controls.
- **Chat interactions** between users, rendered in the timeline, and
  **media tags** on images from the community's tagger.
- **Onboarding**: a guided walkthrough with the mascot before sign-in, with
  Back and Skip on every screen.
- **Egress consent**: before the client hands your information to any
  surface it does not control, it tells you plainly and you can decline;
  every ambiguous state resolves to blocked.
- **A desktop shell** in `electron/`, which hosts the deployed origin rather
  than bundled assets and has its own first-run consent screen.

## Getting started

```
npm install
npm run dev            # Vite dev server
npm run build          # tsc -b && vite build
npm run preview        # serve the built dist locally
npm run lint           # eslint
npm run check          # the whole check suite (see below)
npm run check:derived  # the derived-facts check alone
npm run gate           # lint + check + build: the pre-merge gate
```

Configuration is by `VITE_*` variables at build time. Without them the
client falls back to in-repo development defaults, which is the wrong
homeserver for anyone but the developer, so set them for any real build:

| Variable | Meaning |
|---|---|
| `VITE_HOMESERVER` | Homeserver base URL |
| `VITE_MAS_CLIENT_ID` | The OIDC client id registered with MAS |
| `VITE_SLIDING_SYNC` | `1` to use sliding sync instead of classic sync |
| `VITE_E2EE` | `1` to turn encryption on for every user of the build. Compared as the string `1`; any other value is off. The per-browser switch in Settings works either way. |
| `VITE_BOORU_URL`, `VITE_BOORU_LOGIN_URL`, `VITE_BOORU_EXCHANGE_URL` | The community image board panel and its sign-in bridge |

Deployment is `./deploy.sh`, which builds `dist/`, ships it into a
timestamped release directory and flips a `current` symlink. It is the only
sanctioned deploy path.

## Tests

The suite is dependency-free: each `checks/*.check.ts` is a plain script
run under `node --import ./checks/_hooks.mjs`, and `npm run check` runs them
all. Several are source guards that read files and refuse specific patterns;
that is deliberate, and their headers say what they protect.

## Layout

| Path | What |
|---|---|
| `src/client/` | Protocol and state: the Matrix client, crypto, sliding sync, sessions, recovery, and the pure decision modules the checks exercise |
| `src/ui/` | React components |
| `src/onboarding/` | The guided flow before sign-in |
| `checks/` | The check suite |
| `electron/` | The desktop shell |
| `docs/plan/` | Campaign ledgers: parity, interactions, E2EE, egress consent. The design record lives here. |

## Built with

- [matrix-js-sdk](https://github.com/matrix-org/matrix-js-sdk) with its Rust crypto engine
- Vite + React + TypeScript
- Element's Compound design system and tokens
- DOMPurify for every rendered message body; marked and highlight.js for formatting

## License

Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See
[LICENSE](LICENSE).

If you run a modified version of this software as a network service, the AGPL
requires you to make your modified source available to its users.
