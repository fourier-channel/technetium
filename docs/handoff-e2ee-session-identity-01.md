# handoff-e2ee-session-identity-01.md -- 2026-09-10/11 session, Technetium E2EE

For a fresh session. The ledger `docs/plan/E2EE_DM_PLAN.md` (section
"2026-09-10, late") carries the detail; this is the shape and the loose ends.

## What landed (all deployed, release 20260911-014709-f4cd02b)

- **Foreign tokens fixed.** Refreshed tokens persist only into the session
  record naming the refresher's own device; resume asks whoami once before
  crypto starts and ends the session with a message naming both devices on a
  mismatch. `src/client/sessionIdentity.ts`, checked, proven live.
- **Crypto store keyed by user AND device.** A store is a device; the old
  per-user key made every forced re-login find the previous device's store.
- **Set-up recovery fixed** (the created-key callback), **rotate recovery
  key** built and proven (old key refused on a fresh device, new key
  restores and signs), the set-up device now signs itself.
- **Sessions section**: MAS GraphQL lists the account's sessions; "sign out
  the N unverified" / "all N others" behind a named confirmation. Login
  requests `urn:mas:graphql:*`; MAS keeps it across refresh; every MAS call
  refreshes an expired token once (MAS tokens live 5 min; the SDK refreshes
  only on a homeserver 401). Proven on the test account: 5 of 6 signed out,
  Synapse devices 9 -> 4.
- **MAS config**: `undocumented_oauth2_access: true` on the web listener's
  graphql resource, applied by the operator 2026-09-11 (backup beside it).
  Without it MAS answers "Invalid token" to EVERY bearer token, scope or not.
  Any future MAS config rewrite must keep it.

## Operator-side, still to happen

- Sign out of Technetium and back in once (pre-change sign-ins lack the
  scope; the panel says so and links the account page meanwhile).
- Enter the recovery key on the new device; then use the Sessions section
  on the ~94-device pile.

## Test accounts made this session

`claudekey`, `claudekey2` (MAS passwords), `claudeone` got a password and a
second device token. Passwords and tokens live only in the session
scratchpad and were never printed.
<!-- phase:G-7a1d4e -->
> **[2026-09-11 / G-7a1d4e]** mas-cli compat tokens look like mct_<body>_<check>; a grep of [A-Za-z0-9]+ truncates at the underscore and the result is "Token is not active".

## Not mine, noticed

- chanbooru has an uncommitted `db/structure.sql` (+60, a signup_tokens
  table) from another session.
- fourier-tunnel's two commits (grant-tag-write tool, whitelist tests) were
  deployed this session on operator instruction.

## Next work in canon

`docs/design/HYDRA_OFFSITE_WORKER.md` -- the hydra-on-a-rented-GPU proposal,
three rulings open.
