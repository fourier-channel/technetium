# Technetium — Dependency Chart & Manifest

Deliberate version choices and the dependency structure of the Technetium client.
Companion to the Fourier `DEPENDENCIES.md`; same "record decisions, not the whole
resolved tree" discipline (`package-lock.json` is authoritative for the full tree).

Last verified: 2026-06-20.

---

## Dependency graph

### External packages

```mermaid
graph TD
    react["react 19.2.6"]
    reactdom["react-dom 19.2.6"]
    sdk["matrix-js-sdk 41.6.0<br/>(protocol engine)"]
    crypto["@matrix-org/matrix-sdk-crypto-wasm 18.x<br/>(E2EE engine — transitive)"]
    cw["@vector-im/compound-web 9.4.1<br/>(UI primitives)"]
    cdt["@vector-im/compound-design-tokens 10.2.2<br/>(CSS theme vars)"]
    inter["@fontsource/inter 5.x"]
    incon["@fontsource/inconsolata 5.x"]

    sdk -->|bundles| crypto
    cw -->|peer| cdt
    cw -->|peer| inter
    cw -->|peer| incon
    cw -->|peer| react

    classDef installed fill:#1a3a2e,stroke:#3ba776,color:#e8f5ee;
    classDef transitive fill:#2a2a3a,stroke:#7a7ad0,color:#e8e8f5;
    class react,reactdom,sdk,cw,cdt,inter,incon installed;
    class crypto transitive;
```

### Internal module graph (`src/`)

```mermaid
graph TD
    main["main.tsx<br/>(entry: imports tokens+fonts, mounts provider)"]
    app["App.tsx<br/>(thin status-driven shell)"]
    ctx["client/ClientContext.tsx<br/>(ClientProvider + useClient)"]
    build["client/buildClient.ts<br/>(IndexedDBStore + createClient)"]
    sess["client/session.ts<br/>(localStorage session)"]
    refresh["client/tokenRefresher.ts<br/>(OidcTokenRefresher persist)"]
    sdk["matrix-js-sdk"]

    main --> app
    main --> ctx
    app -->|useClient| ctx
    ctx --> build
    ctx --> sess
    ctx --> refresh
    ctx --> sdk
    build --> sdk
    refresh --> sdk
    refresh --> sess

    subgraph fourier_candidate["⚑ Fourier-passport extraction candidate"]
        sess
        refresh
    end

    classDef mod fill:#1a2a3a,stroke:#4a90d0,color:#e8f0f8;
    classDef flag fill:#3a2e1a,stroke:#d0a040,color:#f8f0e0;
    class main,app,ctx,build,sdk mod;
    class sess,refresh flag;
```

The flagged modules (`session.ts`, `tokenRefresher.ts`) plus the login flow are a
reusable browser-side MAS-auth library — the client-side counterpart to the planned
**fourier-signature**. Kept inside Technetium for now; deliberately free of
client-specific deps so a later extraction is a move, not a rewrite.

---

## Version table

| Package | Version | Constraint / reason |
|---|---|---|
| `matrix-js-sdk` | `41.6.0` | Protocol engine + OIDC. Stay on stable (latest tag is an RC). Bundles crypto-wasm. |
| `@matrix-org/matrix-sdk-crypto-wasm` | `18.x` | **Transitive** via js-sdk (`^18.2.0`). Never pinned directly. Powers E2EE when activated. |
| `react` / `react-dom` | `19.2.6` | Satisfies Compound's `^18 \|\| ^19` peer range. |
| `@vector-im/compound-web` | `^9.4.1` | Element's design system — UI primitives. |
| `@vector-im/compound-design-tokens` | `^10.2.2` | Theme CSS vars (`--cpd-*`); light/dark via prefers-color-scheme. |
| `dompurify` | `^3.4.11` | Mandatory HTML sanitizer before rendering any message HTML. Ships its OWN types since v3, so no `@types/dompurify` (that stub is deprecated for v3 and was removed 2026-07-18). |
| `marked` | `^18.0.5` | Markdown -> HTML for the composer (`messageFormat.ts`); its output is ALWAYS piped through `dompurify` before render. Chosen for its small, sync, zero-dep core. |
| `@fontsource/inter` | `^5.2.8` | UI font. Weights 400/500/600/700 imported. |
| `@fontsource/inconsolata` | `^5.2.8` | Mono font. Weight 400 imported. |
| `@fontsource/space-grotesk` | `^5.2.10` | Techy-but-readable room-list face. Weights 400/500/600/700 imported; surfaced as CSS var `--tc-ui-font` (user-swappable via settings UI). OFL. |
| `vite` | `8.0.14` | Dev server + build. |
| `typescript` | (scaffold) | — |

### Deferred (install when the phase needs them)
- `@matrix-org/matrix-wysiwyg` — rich composer (Phase: composer). Still deferred;
  the current composer uses `marked` + `dompurify` (both now installed, above).
- `matrix-widget-api` — only if widgets are embedded (later/maybe).

---

## Fragile internal imports (SCAN BEFORE ANY matrix-js-sdk UPGRADE)

- **`matrix-js-sdk/lib/sliding-sync`** — `src/client/slidingSync.ts` deep-imports
  the INTERNAL `SlidingSync` class. It is NOT public in 41.6.0 (only
  `SlidingSyncEvent` is exported from the package root), so this reaches into
  unsupported surface. Operator-approved deviation (2026-07-18) to use native
  Simplified Sliding Sync (MSC4186), which `matrix.41chan.net` advertises
  (`org.matrix.simplified_msc3575`) with no proxy. Kept behind `VITE_SLIDING_SYNC`
  (default off); all the fragile surface lives in that ONE module.
  - **RULE:** before recommending ANY matrix-js-sdk bump, scan the target version
    for sliding-sync changes — is `SlidingSync` public yet? did the class
    signature / list-config shape / endpoint move? — and re-verify
    `slidingSync.ts` against it. **Never bump the SDK blind.**

---

## License note

All current dependencies are permissively licensed (matrix-js-sdk: Apache-2.0;
Compound: Apache-2.0; fontsource: OFL fonts + MIT tooling), imposing no copyleft
floor. Technetium itself is AGPL-3.0 by choice, not obligation. Re-check with a
license pass before any public release if new deps are added.
