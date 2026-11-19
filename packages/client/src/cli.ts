import { ARENA, LAYOUT, PROTOCOL_VERSION, RULES, TIMING } from "@snake/shared";

const BANNER = String.raw`
+----------------------------------------------------------------+
|  SNAKE//MULTI                                                  |
|  multiplayer terminal snake                                    |
+----------------------------------------------------------------+
`;

const HELP = String.raw`
Usage: snake [options]

Phase 0 scaffold. Gameplay is implemented in later phases.

Options:
  --help       Show this help.
  --version    Show protocol and build information.
  --server     WebSocket URL (default: ws://127.0.0.1:3000/_ws).
  --room       Room code to join later.
  --name       Callsign, 2-12 chars, A-Z 0-9 _ -.

Runtime:
  Nodes: ${RULES.maxPlayers}
  Arena: ${ARENA.width} x ${ARENA.height} inner cells
  Terminal minimum: ${LAYOUT.minTerminalWidth} x ${LAYOUT.minTerminalHeight}
  Tick: ${TIMING.tickMs} ms
`;

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function main(args: string[] = process.argv.slice(2)): number {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(BANNER + HELP);
    return 0;
  }

  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(
      `snake-multi 0.1.0 protocol=${PROTOCOL_VERSION} arena=${ARENA.width}x${ARENA.height} tick=${TIMING.tickMs}ms\n`,
    );
    return 0;
  }

  const server = valueAfter(args, "--server") ?? "ws://127.0.0.1:3000/_ws";
  const room = valueAfter(args, "--room");
  const name = valueAfter(args, "--name") ?? "PLAYER";

  process.stdout.write(BANNER);
  process.stdout.write(`server: ${server}\n`);
  process.stdout.write(`room:   ${room ?? "(not set)"}\n`);
  process.stdout.write(`name:   ${name}\n`);
  process.stdout.write("status: scaffold only; the interactive TUI starts in a later phase.\n");
  return 0;
}

const exitCode = main();
process.exitCode = exitCode;
