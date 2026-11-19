import { ARENA, RULES } from "../constants";
import { inBounds, manhattan, samePoint } from "./grid";
import type { Rng } from "./rng";
import type { AppleState, GameState, Point } from "./types";

/** Living snakes' heads, used for spawn-distance checks. */
export function heads(state: GameState): Point[] {
  return state.snakes.filter((snake) => snake.alive).map((snake) => snake.body[0]!);
}

/** Minimum distance from `p` to any living head. */
export function distanceToNearestHead(state: GameState, p: Point): number {
  let best = Number.POSITIVE_INFINITY;
  for (const head of heads(state)) best = Math.min(best, manhattan(head, p));
  return best;
}

/** True when an apple may occupy `p`: free, in bounds, and not on the border margin. */
export function isFreeCell(state: GameState, p: Point): boolean {
  if (p.x < 1 || p.y < 1 || p.x >= ARENA.width - 1 || p.y >= ARENA.height - 1) return false;
  if (state.snakes.some((s) => s.alive && s.body.some((cell) => samePoint(cell, p)))) {
    return false;
  }
  if (state.sheds.some((shed) => samePoint(shed, p))) return false;
  if (state.apples.some((apple) => samePoint(apple, p))) return false;
  return true;
}

/**
 * Choose a free cell for an item, trying the preferred head distance first.
 * Returns undefined only when the arena has no free cell at all.
 */
export function findSpawnCell(state: GameState, rng: Rng): Point | undefined {
  const all: Point[] = [];
  for (let y = 1; y < ARENA.height - 1; y++) {
    for (let x = 1; x < ARENA.width - 1; x++) {
      const p = { x, y };
      if (isFreeCell(state, p)) all.push(p);
    }
  }
  for (const distance of [RULES.spawnMinHeadDistance, RULES.spawnRelaxedDistance, 0]) {
    const candidates = all.filter((p) => distanceToNearestHead(state, p) >= distance);
    if (candidates.length > 0) return rng.pick(candidates);
  }
  return undefined;
}

/** Spawn one apple of the given kind, advancing the RNG. */
export function spawnApple(
  state: GameState,
  rng: Rng,
  kind: AppleState["kind"],
): AppleState | undefined {
  const cell = findSpawnCell(state, rng);
  if (!cell) return undefined;
  const apple: AppleState = {
    id: `a${state.nextAppleId++}`,
    kind,
    x: cell.x,
    y: cell.y,
    ttl: kind === "normal" ? RULES.normalAppleTtlTicks : RULES.mysteryAppleTtlTicks,
  };
  state.apples.push(apple);
  return apple;
}

/** Desired counts for the current player count. */
export function appleTargets(playerCount: number): { normal: number; mystery: number } {
  return {
    normal: Math.min(6, Math.max(3, playerCount + 1)),
    mystery: playerCount >= 5 ? 2 : 1,
  };
}

/** Top up apples until the target counts are met. */
export function maintainApples(state: GameState, rng: Rng): void {
  const targets = appleTargets(state.snakes.length);
  let normal = state.apples.filter((apple) => apple.kind === "normal").length;
  let mystery = state.apples.filter((apple) => apple.kind === "mystery").length;

  while (normal < targets.normal) {
    if (!spawnApple(state, rng, "normal")) break;
    normal++;
  }
  while (mystery < targets.mystery) {
    if (!spawnApple(state, rng, "mystery")) break;
    mystery++;
  }
}

/** Reposition an apple after a shed wall lands on it. Returns false if nowhere is free. */
export function relocateApple(state: GameState, apple: AppleState, rng: Rng): boolean {
  const cell = findSpawnCell(state, rng);
  if (!cell) return false;
  apple.x = cell.x;
  apple.y = cell.y;
  apple.ttl = apple.kind === "normal" ? RULES.normalAppleTtlTicks : RULES.mysteryAppleTtlTicks;
  return true;
}

/** All in-bounds checks used by the tick; kept here so spawn and collision agree. */
export function isSpawnable(state: GameState, p: Point): boolean {
  return inBounds(p) && isFreeCell(state, p);
}
