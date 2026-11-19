# snake-multi

Multiplayer terminal Snake. Weaponized apples, hidden mystery effects, ASCII
only, server-authoritative.

This repository is under active construction. Phase 0 (workspace scaffolding,
toolchain, runtime constraints, reusable renderer) is in place.

## Requirements

- Node.js >= 22.18
- pnpm 10.18.0 (pinned in `package.json`)

`vp` comes from the workspace, so use `pnpm exec vp`.

## Install

```bash
pnpm install
```

## Validate

```bash
pnpm exec vp check     # format, lint, typecheck
pnpm exec vp test      # unit tests
```

## Build

```bash
pnpm exec vp -C packages/shared pack
pnpm exec vp -C packages/diff-rend pack
pnpm exec vp -C packages/client pack
pnpm exec vp -C packages/server build
```

`vp pack` builds libraries and the CLI. `vp build` builds the Nitro server.

## Run the server

```bash
pnpm exec vp -C packages/server dev
```

- Health: `GET http://127.0.0.1:3000/api/health`
- WebSocket: `ws://127.0.0.1:3000/_ws`

The current WebSocket route is a scaffold that answers `ping`.

## Run the client

```bash
pnpm exec vp -C packages/client dev
node packages/client/dist/cli.mjs --help
```

The current CLI prints build and layout information. The interactive TUI lands
in a later phase.

## Layout

```text
packages/
  shared/      pure game rules, protocol, storage types, bot brain
  diff-rend/   reusable ASCII renderer, draw helpers, Kitty input, frame clock
  server/      Nitro server, WebSocket rooms, persistence adapters
  client/      ASCII terminal client and CLI
```

## Runtime targets

- Local and Node hosting today.
- Cloudflare Workers later, via the `cloudflare_module` Nitro preset and
  runtime adapters. See `AGENTS.md` sections 6 and 7.

Game rules and the protocol never depend on Node or Cloudflare APIs.

## Rules of the project

- ASCII only, in code, UI, docs, and art.
- The arena is always centered.
- No jumpscare opt-out.
- The server is authoritative.
- `vp check` and `vp test` must pass before every commit.

## Documentation

- `AGENTS.md` - architecture, toolchain gotchas, Nitro and Cloudflare notes,
  package boundaries, and validation gates.
- `packages/diff-rend` - reusable engine extracted from `dn-gasbag` (MIT).
