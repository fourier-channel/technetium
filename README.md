# Technetium

A custom [Matrix](https://matrix.org) client for the 41chan community.

Technetium is a from-scratch web client built directly on the Matrix
Client-Server API. Its goal is a more compact, familiar chat experience than
existing Matrix clients tend to offer — closer to the everyday tools people are
already used to — while remaining a standard Matrix client that works against
any conformant homeserver.

## Status

**Massive work in progress. Not usable yet.**

This is early-stage, single-developer software under active construction. Right
now it can authenticate and list rooms, and not much else. Expect it to be
incomplete, broken in places, and changing constantly — there is no release, no
stable version, and no support. If you need a working Matrix client today, use
[Element](https://element.io) or another mature client.

## Built with

- [matrix-js-sdk](https://github.com/matrix-org/matrix-js-sdk) — the Matrix protocol engine
- Vite + React + TypeScript

Authentication is OIDC-native, delegated to
[matrix-authentication-service (MAS)](https://github.com/element-hq/matrix-authentication-service).

## License

Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See
[LICENSE](LICENSE).

If you run a modified version of this software as a network service, the AGPL
requires you to make your modified source available to its users.
