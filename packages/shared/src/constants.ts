/**
 * Runtime-agnostic game constants.
 *
 * This module must stay free of Node.js, DOM, and Cloudflare APIs so it can be
 * imported by the server (Node or Workers), the client, and tests.
 */
export const PROTOCOL_VERSION = 1 as const;

export const ARENA = {
  width: 58,
  height: 20,
  border: 1,
  renderedWidth: 60,
  renderedHeight: 22,
} as const;

export const LAYOUT = {
  minTerminalWidth: 80,
  minTerminalHeight: 30,
  headerRows: 3,
  footerRows: 3,
  arenaTop: 4,
  arenaInnerTop: 5,
  footerTop: 27,
} as const;

export const TIMING = {
  tickMs: 120,
  countdownMs: 3_000,
  matchTicks: 1_500,
  gameOverMs: 20_000,
  reconnectGraceMs: 60_000,
  botTakeoverMs: 3_000,
} as const;

export const RULES = {
  maxPlayers: 6,
  minPlayers: 2,
  startLength: 4,
  maxLength: 32,
  normalAppleScore: 10,
  mysteryAppleScore: 25,
  killScore: 5,
  spawnMinHeadDistance: 5,
  normalAppleTtlTicks: 209,
  mysteryAppleTtlTicks: 167,
  maxTurnQueue: 2,
  moltSegments: 3,
  moltShedTicks: 84,
  moltGraceTicks: 13,
  ghostTicks: 42,
  reverseTicks: 67,
  overdriveTicks: 50,
  jumpscareCooldownTicks: 84,
  maxShedCells: 18,
  spawnRelaxedDistance: 3,
} as const;

/** Deterministic spawn slots. Body extends opposite the heading. */
export const SPAWN_ANCHORS = [
  { x: 6, y: 4, dir: "right" },
  { x: 51, y: 15, dir: "left" },
  { x: 6, y: 15, dir: "right" },
  { x: 51, y: 4, dir: "left" },
  { x: 6, y: 9, dir: "right" },
  { x: 51, y: 10, dir: "left" },
] as const;

/** Mystery apple effect weights. They must sum to 100. */
export const MYSTERY_WEIGHTS = {
  jumpscare: 24,
  molt: 20,
  ghost: 20,
  reverse: 21,
  overdrive: 15,
} as const;

/** Effect duration in ticks. Jumpscare is a client overlay, not a simulation effect. */
export const EFFECT_TICKS = {
  jumpscare: 5,
  molt: 84,
  ghost: 42,
  reverse: 67,
  overdrive: 50,
} as const;

/** Effect duration in milliseconds, for HUD copy and protocol. */
export const EFFECT_MS = {
  jumpscare: 500,
  molt: 10_080,
  ghost: 5_040,
  reverse: 8_040,
  overdrive: 6_000,
} as const;

/** Canonical direction deltas. */
export const DIR_DELTAS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
} as const;

export const PLAYER_COLORS = [14, 10, 11, 13, 12, 208] as const;

/** UI is ASCII-only. These are the only glyphs allowed in gameplay rendering. */
export const ASCII_GLYPHS = {
  headUp: "^",
  headDown: "v",
  headLeft: "<",
  headRight: ">",
  body: "#",
  ghostBody: ".",
  normalApple: "*",
  mysteryApple: "?",
  shed: ":",
  borderHorizontal: "-",
  borderVertical: "|",
  borderCorner: "+",
  playerHuman: "o",
  playerBot: "b",
  playerOffline: "x",
} as const;
