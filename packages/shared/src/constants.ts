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
