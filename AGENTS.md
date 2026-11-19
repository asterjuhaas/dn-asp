# AGENTS.md

Instructions for AI agents and humans working in this repository.

## 1. What this project is

`snake-multi` is a multiplayer terminal Snake game.

- `packages/shared` - pure game rules, protocol, storage types, bot brain.
- `packages/server` - Nitro server, WebSocket rooms, persistence adapters.
- `packages/client` - ASCII terminal client and CLI.
- `packages/diff-rend` - reusable terminal rendering and input engine.

The server is authoritative. Clients send intent, never state.

## 2. Hard rules

These are not preferences. Do not relax them without an explicit decision in
writing.

1. **ASCII only.** Source code, UI, docs, commit messages, and generated art
   must be ASCII. No Unicode glyphs, no emoji, no box-drawing characters, no
   non-ASCII punctuation. Use `+ - | / \ * # . :` and plain quotes.
2. **No jumpscare opt-out.** The jumpscare effect is part of the game. There is
   no flag, setting, or environment variable that disables it.
3. **The arena is centered.** The fixed arena is centered horizontally and the
   whole 30-row layout group is centered vertically in larger terminals. Never
   pin the arena to the top-left.
4. **Runtime-agnostic core.** `packages/shared` must never import Node, DOM,
   Cloudflare, Nitro, or client-only modules. No `process`, `Buffer`, `fs`,
   `node:*`, `setInterval`, `performance` in game rules.
5. **The server must stay deployable to Cloudflare Workers.** No process-local
   state as a correctness dependency, no `setInterval` for authoritative ticks
   in production, no Node-only APIs in shared or server core. See section 7.
6. **Server authority.** Rules, collision, RNG, scoring, and bot decisions run
   on the server. The client never decides an outcome.
7. **Vite+ owns the toolchain.** Use `vp check`, `vp test`, `vp pack`, and
   `vp dev`/`vp build` as documented below. Do not add ESLint, Prettier,
   Jest, or a separate bundler.

## 3. Package boundaries

| Package            | May import                                  | Must not import                      |
| ------------------ | ------------------------------------------- | ------------------------------------ |
| `@snake/shared`    | standard library, `@snake/shared`           | Node, DOM, Nitro, Cloudflare, client |
| `@snake/diff-rend` | Node (terminal I/O only)                    | shared game state, server, network   |
| `@snake/client`    | shared, diff-rend, browser/Node client APIs | server internals                     |
| `@snake/server`    | shared, Nitro, Cloudflare bindings          | client, diff-rend                    |

Rules of thumb:

- If a function touches the network, the clock, the filesystem, or a socket, it
  does not belong in `shared`.
- If a function decides whether a snake dies, it belongs in `shared`.
- If a function decides how a cell is drawn, it belongs in `client` (or a
  generic primitive belongs in `diff-rend`).
- If a function decides how state is stored, it belongs in `server`.

## 4. Approved game constants

Do not silently tune these. They are asserted by tests.

| Constant         | Value                              |
| ---------------- | ---------------------------------- |
| Inner arena      | 58 x 20 cells                      |
| Rendered arena   | 60 x 22 cells with a 1-cell border |
| Server tick      | 120 ms                             |
| Minimum terminal | 80 x 30                            |
| Max players      | 6                                  |
| Match length     | 1,500 ticks = 180,000 ms           |
| Countdown        | 3,000 ms                           |
| Start length     | 4                                  |
| Max length       | 32                                 |
| Normal apples    | `clamp(players + 1, 3, 6)`         |
| Mystery apples   | `players >= 5 ? 2 : 1`             |

Growth rule: eating a normal apple grows **every other living snake**, not the
eater. In 2-player games rivals gain 2; in 3+ player games rivals gain 1.

Mystery effects: jumpscare 24%, molt 20%, ghost 20%, reverse 21%, overdrive
15%. Effects are rolled only on consumption and are never on the wire before
that.

All balancing details live in `packages/shared/src/constants.ts` once the game
core lands. Update that file and its tests together.

## 5. Vite+ commands

Always from the repository root unless noted.

```bash
pnpm install
pnpm exec vp check            # format + lint + typecheck
pnpm exec vp check --fix      # autofix formatting and safe lint fixes
pnpm exec vp test             # Vitest across the workspace
pnpm exec vp -C packages/shared pack
pnpm exec vp -C packages/diff-rend pack
pnpm exec vp -C packages/client pack
pnpm exec vp -C packages/server build
```

Gotchas, learned the hard way:

- `vp check`, `vp test`, `vp build`, and `vp dev` are Vite+ **built-in
  commands**. They do not run the `package.json` script of the same name. Use
  `vpr check` / `vp run check` to run a script.
- `vp pack` builds libraries and CLIs. `vp build` builds the Nitro server. Do
  not use `vp pack` for the server.
- Vite+ 1.7 bundles Vite 8, Vitest 5, Oxlint 1.94, Oxfmt 0.79, and tsdown 0.23.
  Do not install a second copy of those tools.
- `vite` is aliased to `@voidzero-dev/vite-plus-core` at the workspace root.
  Keep the alias and the pnpm override in sync.
- The typechecker is `tsgo` (TypeScript 7 preview). It is strict and fast, but
  optional-dependency conditional types can collapse to `never`. See section 9.
- `pnpm` must be 10.18.0 (pinned via `packageManager`). Do not use corepack
  pnpm 11 with the Node version in this environment.
- `pnpm view` fails here because `npm` is not installed. Query the registry with
  `curl https://registry.npmjs.org/<pkg>/latest` instead.

## 6. Nitro notes (from nitro.build/llms.txt)

Captured so agents do not have to re-fetch the docs.

### WebSockets

- Enable with `features: { websocket: true }` in `nitro.config.ts`.
- Nitro 3 defaults `serverDir` to `false`. Set `serverDir: "server"` when
  routes live in `server/routes`, otherwise the build emits no handlers and
  every request 404s. Nitro 2 used `server/` implicitly; Nitro 3 does not.
- The Nitro Vite plugin takes `rootDir` from Vite's `root`. Vite+ runs from the
  workspace root even with `-C packages/server`, so set `root: import.meta.dirname`
  in `packages/server/vite.config.ts`; without it Nitro scans the repo root.
- A route file named `_ws.ts` becomes the WebSocket endpoint.
- Handler shape: `defineWebSocketHandler({ open, message, close, error })`
  imported from `nitro`.
- `peer.id` is the connection id; `peer.send(data)` sends to one peer;
  `peer.publish(topic, data)` sends to a topic and excludes the sender;
  `peer.subscribe(topic)` joins a topic.
- `message.text()` returns text; `message.toString()` is the raw payload.
- WebSockets work on Node, Bun, Deno, Vercel, and Cloudflare Workers.
- Prefer SSE for one-way server-to-client streams. Snake needs bidirectional
  input, so WebSockets are correct here.

### KV storage

- `useKV()` comes from `nitro/kv`. `useStorage()` from `nitro/storage` still
  exists but is the older name; use `useKV` in new server code.
- `useKV()` defaults to the in-memory driver. `useKV("prefix")` scopes keys.
- Configure mounts in `nitro.config.ts` under `kv`.
- Built-in `unstorage` drivers include `memory`, `fs`, `lru-cache`, and
  `cloudflare-kv-binding`.
- `unstorage` is installed automatically when `nitro/kv` is imported or a `kv`
  mount is configured. In this repo it is also an explicit dependency so type
  resolution is deterministic.

### Vite integration

- Nitro is a Vite plugin: `import { nitro } from "nitro/vite"` and add
  `nitro()` to `plugins`.
- `vite dev` runs one dev server for app and server. `vite build` emits
  `.output/`. `vite preview` serves the built app, including WebSockets.
- In this repo the Nitro plugin is wired in `packages/server/vite.config.ts`.

### Cloudflare Workers

- Preset: `cloudflare_module` in `nitro.config.ts` for deployment.
- Local preview: build, then `wrangler dev`. Deploy with `wrangler deploy`.
- Durable Objects are declared in `wrangler.json` under `durable_objects` and
  exported under `exports` with `"storage": "sqlite"` for SQLite-backed state.
- Access a binding from a handler with
  `event.req.runtime.cloudflare.env.BINDING`.
- A custom `server.ts` needs a default export; keep an empty `fetch` handler if
  the file exists only for Durable Object classes.
- Local Durable Object state persists in `.wrangler/state/v3`.

## 7. Cloudflare deployment strategy

The target is "runs on Node today, runs on Workers later" without a rewrite.

### What is forbidden now

- `setInterval` / `setTimeout` as the authoritative game clock in production.
- Module-level mutable state that must survive across isolates.
- `process.env` reads in `shared` or game core. Read config once at the server
  boundary.
- `Buffer`, `node:crypto`, `node:fs`, `node:net`, or `ws` in shared or server
  core.
- Relying on one process serving every room.

### Runtime adapters

Design the server so each of these has one interface and two implementations:

| Concern            | Node adapter                    | Workers adapter                      |
| ------------------ | ------------------------------- | ------------------------------------ |
| Room isolation     | room object in process          | one Durable Object per room          |
| Authoritative tick | alarm / scheduled tick          | Durable Object alarm                 |
| Live pub/sub       | `peer.publish` + peer map       | Durable Object WebSocket hibernation |
| Hot state          | memory + KV snapshot            | Durable Object SQLite storage        |
| Cold history       | `useKV` (fs locally, KV remote) | KV or D1                             |
| Room index         | memory + KV                     | KV                                   |
| Clock              | `Date.now()`                    | `Date.now()`                         |

Rules:

- The tick function must be a pure `step(state, inputs, rng) -> result`.
- Drive it from an alarm or scheduler, not from a long-lived interval.
- Rooms must be addressable by code and reconstructible from persisted state.
- All cross-request state goes through a storage interface, never a global.
- Use `features: { websocket: true }`; it works on Workers.
- Deployment config is additive: `preset: "cloudflare_module"` plus bindings.
  Do not fork the server for Cloudflare.

### Storage today

- Default: in-memory `useKV()`.
- Local development: filesystem driver under `.data/kv` (see
  `packages/server/nitro.config.ts`).
- Cloudflare (later): mount `cloudflare-kv-binding` for cold data, D1 for
  match history, and Durable Object SQLite for hot room state.

Memory KV is not durable across process restarts. Never claim it is. Recovery
that must survive a restart requires a persistent driver and is a later phase.

## 8. Reusable engine (`packages/diff-rend`)

This package is a vendored, cleaned-up fork of the engine in `dn-gasbag`
(MIT, same author). It is the only approved renderer and input layer.

- `screen.ts` - double-buffered cell grid, packed styles, SGR diffing,
  synchronized output, sprites, capture, resize.
- `sprite.ts` - sprite types and ASCII-art parsing.
- `draw.ts` - `fillRect`, `hline`, `vline`, `box`, `truncate`, `fit`,
  `centerText`, `centeredRect`, `textWidth`.
- `input.ts` - Kitty keyboard protocol with legacy fallback, press/hold/release.
- `clock.ts` - frame clock and loop (client-side only).
- `system.ts` - terminal title.

Changes versus the original engine:

- Removed the `keys.log` disk write from `Input.dispatch`.
- `Screen` accepts `ScreenOptions { w, h, write }` and is fully headless when
  all three are given. No options preserves the original behaviour.
- Added `draw.ts` helpers and `centeredRect` for consistent arena centering.
- Added a full Vitest suite.

Rules:

- Keep the engine generic. Game-specific layout goes in `packages/client`.
- Do not add non-ASCII art to the engine or its tests.
- Do not re-introduce filesystem writes in the input path.
- Treat `Screen.render()` as the only terminal writer; do not write escapes
  directly from game code.
- The jumpscare is a draw-order overlay, not a second renderer: draw world,
  then HUD, then modal, then FX. Opaque spaces in a sprite are what obscure the
  arena.

## 9. Known toolchain workarounds

- Nitro 3 RC (`3.0.261103-rc`) types `KVMount` as `never` under `tsgo` because
  its built types import optional dependencies behind `@ts-ignore`. The
  workaround is the single `kvMount()` cast in
  `packages/server/nitro.config.ts`. Do not spread that cast into other files.
- `packages/diff-rend` disables `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` because it is vendored performance code written
  against looser settings. Do not weaken those flags anywhere else.
- `packages/shared` exports its source for monorepo DX
  (`./src/index.ts`). Before publishing, switch exports to `./dist` and verify
  the packed build.
- Vite+ may auto-install `jiti` in `packages/server` when loading config. That
  is expected and safe to commit in the lockfile.

## 10. Validation gates

Every change must pass:

```bash
pnpm exec vp check
pnpm exec vp test
```

Before a commit that touches build output or packaging, also run the relevant
build:

```bash
pnpm exec vp -C packages/shared pack
pnpm exec vp -C packages/diff-rend pack
pnpm exec vp -C packages/client pack
pnpm exec vp -C packages/server build
```

Do not commit if `vp check` fails. Do not "fix" a failure by disabling a rule
globally. Fix the code or add a narrow, commented override.

## 11. Testing expectations

- Pure game logic: exhaustive unit tests. Every collision cause, every growth
  case, every effect expiry, and RNG determinism.
- Protocol: round-trip serialization tests and validation tests.
- Server: two real WebSocket clients through lobby, countdown, play, and game
  over; disconnect and reclaim; host migration.
- Client rendering: headless `Screen` snapshots at 80x30, 120x40, 79x30, and
  80x29. The warning screen is part of the contract.
- Bots: seeded games with an illegal-move assertion on every tick.
- No test may depend on wall-clock timing. Inject clocks and RNG.

## 12. Copy and UX rules

- All UI strings are ASCII. Exact strings are part of the spec; change them
  deliberately, not incidentally.
- The footer is the only place for key hints. Keep it one line per role.
- Active effects are shown as `G3.2s`, `R6.0s`, `O4.1s`; inactive is `-`.
- The mystery apple is always `?` on the board. Its effect is revealed only on
  consumption.
- The warning screen appears below 80x30 and never crashes the client.
- The terminal must always be restored on exit, including errors and Ctrl+C.

## 13. Commits

- Commit as `Aster Juhas <aster@juhaas.dev>` by default:
  `git -c user.name="Aster Juhas" -c user.email="aster@juhaas.dev" commit`.
- GitHub authentication and PRs stay with the official account.
- Commit in small, verifiable steps. One phase or one coherent slice per commit,
  with `vp check` and `vp test` green before each commit.
- Never commit `.data/`, `.output/`, `dist/`, or `node_modules/`.

## 14. When unsure

Ask. Do not assume mechanics, copy, layout, or storage behaviour. If a spec
detail is missing, propose the smallest concrete option and wait for a decision.
