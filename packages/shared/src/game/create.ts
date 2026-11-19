import { PLAYER_COLORS, RULES, SPAWN_ANCHORS } from "../constants";
import { DIR_DELTAS } from "../constants";
import type { BotDifficulty, Dir, PlayerId } from "../protocol";
import { rngFromState } from "./rng";
import { maintainApples } from "./spawn";
import type { GameState, Point, SnakeState } from "./types";

/** Minimal player description accepted by {@link createGame}. */
export interface PlayerInit {
  id: PlayerId;
  name: string;
  color?: number;
  isBot?: boolean;
  difficulty?: BotDifficulty;
}

/** Build a body of `length` cells with the head at `(x, y)` heading `dir`. */
export function buildBody(x: number, y: number, dir: Dir, length: number): Point[] {
  const delta = DIR_DELTAS[dir];
  const body: Point[] = [];
  for (let i = 0; i < length; i++) {
    body.push({ x: x - delta.x * i, y: y - delta.y * i });
  }
  return body;
}

/**
 * Create a fresh, playable match.
 *
 * Snakes are placed on the fixed spawn anchors in order. Apples are spawned
 * immediately, with the normal head-distance safety rule. The returned state is
 * fully deterministic for a given seed and player order.
 */
export function createGame(
  players: readonly PlayerInit[],
  seed: number,
  options: { startLength?: number; phase?: GameState["phase"] } = {},
): GameState {
  const startLength = options.startLength ?? RULES.startLength;
  if (players.length > RULES.maxPlayers) {
    throw new Error(`at most ${RULES.maxPlayers} players are supported`);
  }

  const snakes: SnakeState[] = players.map((player, index) => {
    const anchor = SPAWN_ANCHORS[index]!;
    return {
      id: player.id,
      name: player.name,
      color: player.color ?? PLAYER_COLORS[index % PLAYER_COLORS.length]!,
      isBot: player.isBot ?? false,
      ...(player.difficulty !== undefined ? { difficulty: player.difficulty } : {}),
      body: buildBody(anchor.x, anchor.y, anchor.dir, startLength),
      dir: anchor.dir,
      alive: true,
      score: 0,
      apples: 0,
      kills: 0,
      growth: 0,
      effects: { ghost: 0, reverse: 0, overdrive: 0 },
      jumpscareCooldown: 0,
      overdriveCredits: 0,
      ejectionTicks: 0,
    };
  });

  const state: GameState = {
    tick: 0,
    phase: options.phase ?? "PLAYING",
    seed: seed >>> 0,
    rngState: seed >>> 0,
    snakes,
    apples: [],
    sheds: [],
    nextAppleId: 0,
    nextEventId: 1,
    lastMysteryTick: {},
  };

  maintainApples(state, rngFromState(state));
  return state;
}
