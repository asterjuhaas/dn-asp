import { DIR_DELTAS } from "../constants";
import type { Dir } from "../protocol";
import { oppositeDir } from "../game/effects";
import { samePoint } from "../game/grid";
import type { GameState, Point, SnakeState } from "../game/types";
import type { Rng } from "../game/rng";
import { BOT_PROFILES } from "./difficulty";
import { distanceField, distanceTo, floodFill, indexOf, type GridScratch } from "./pathfinding";

const DIRS: readonly Dir[] = ["up", "right", "down", "left"];

/** Fill the scratch blocked grid with sheds and every living snake body. */
function buildBlocked(scratch: GridScratch, state: GameState): void {
  scratch.blocked.fill(0);
  for (const snake of state.snakes) {
    if (!snake.alive) continue;
    for (const cell of snake.body) {
      const index = indexOf(cell);
      if (index >= 0) scratch.blocked[index] = 1;
    }
  }
  for (const shed of state.sheds) {
    const index = indexOf(shed);
    if (index >= 0) scratch.blocked[index] = 1;
  }
}

/** True when a cell is inside the arena and free of bodies and sheds. */
function isOpen(scratch: GridScratch, p: Point): boolean {
  const index = indexOf(p);
  return index >= 0 && scratch.blocked[index] === 0;
}

function targetOf(head: Point, dir: Dir): Point {
  const delta = DIR_DELTAS[dir];
  return { x: head.x + delta.x, y: head.y + delta.y };
}

/** Cells an enemy head could enter on its next move, plus whether that enemy is longer. */
function threatenedCells(
  state: GameState,
  self: SnakeState,
): Array<{ cell: Point; longer: boolean }> {
  const cells: Array<{ cell: Point; longer: boolean }> = [];
  for (const snake of state.snakes) {
    if (!snake.alive || snake.id === self.id) continue;
    const head = snake.body[0]!;
    const longer = snake.body.length > self.body.length;
    for (const dir of DIRS) cells.push({ cell: targetOf(head, dir), longer });
  }
  return cells;
}

interface Candidate {
  dir: Dir;
  target: Point;
  area: number;
  safe: boolean;
  score: number;
}

/**
 * Choose one direction for a bot.
 *
 * Pure and deterministic for a given state, difficulty, seed and scratch
 * buffers. The server calls it inside the authoritative tick; the dev-only
 * `--bot` harness calls the same function over the network.
 *
 * Scoring: flood-fill safety first, then open space, apples and mystery value,
 * head danger, corridor avoidance, and a straight-line bias. Difficulty adds a
 * controlled mistake rate on top.
 */
export function decideBotTurn(
  state: GameState,
  botId: string,
  difficulty: keyof typeof BOT_PROFILES,
  rng: Rng,
  scratch: GridScratch,
): Dir | null {
  const snake = state.snakes.find((candidate) => candidate.id === botId);
  if (!snake || !snake.alive) return null;

  const profile = BOT_PROFILES[difficulty];
  const head = snake.body[0]!;
  const blockedDir = oppositeDir(snake.dir);
  const minSafe = snake.body.length + 1;
  const maxUsefulSpace = snake.body.length * 4;
  const dangers = profile.headAwareness ? threatenedCells(state, snake) : [];

  buildBlocked(scratch, state);
  const candidates: Candidate[] = [];

  for (const dir of DIRS) {
    if (dir === blockedDir) continue;
    const target = targetOf(head, dir);
    if (!isOpen(scratch, target)) continue;

    const area = floodFill(scratch, target, Number.MAX_SAFE_INTEGER);
    const safe = area >= minSafe;
    let score = 0;

    if (safe) score += Math.min(area, maxUsefulSpace);
    else score -= 10_000 - area;

    // Apples are evaluated against the distance field from this candidate.
    distanceField(scratch, target);
    for (const apple of state.apples) {
      const distance = distanceTo(scratch, apple);
      if (distance < 0) continue;
      if (apple.kind === "normal") {
        score += profile.appleWeight * Math.max(0, 80 - distance);
        if (distance === 0) score += 100 * profile.appleWeight;
      } else if (difficulty === "hard" || difficulty === "nightmare") {
        score += profile.appleWeight * 0.4 * Math.max(0, 80 - distance);
      } else if (difficulty === "normal") {
        score += profile.appleWeight * 0.2 * Math.max(0, 80 - distance);
      }
    }

    for (const danger of dangers) {
      if (!samePoint(danger.cell, target)) continue;
      score -= danger.longer ? 400 : 250;
    }

    // Avoid dead ends unless they are where the apples are.
    let openNeighbours = 0;
    for (const dir2 of DIRS) {
      if (isOpen(scratch, targetOf(target, dir2))) openNeighbours++;
    }
    if (openNeighbours <= 1) score -= 20;

    if (dir === snake.dir) score += 6;

    score += rng.next() * 0.1;
    candidates.push({ dir, target, area, safe, score });
  }

  if (candidates.length === 0) return snake.dir;

  const safeCandidates = candidates.filter((candidate) => candidate.safe);
  const roll = rng.next();
  let chosen: Candidate;

  if (roll < profile.ignoreSafety) {
    chosen = rng.pick(candidates)!;
  } else if (roll < profile.ignoreSafety + profile.randomSafe && safeCandidates.length > 0) {
    chosen = rng.pick(safeCandidates)!;
  } else {
    const pool = safeCandidates.length > 0 ? safeCandidates : candidates;
    chosen = pool.reduce((best, candidate) => (candidate.score > best.score ? candidate : best));
  }

  if (snake.effects.reverse > 0 && profile.reverseAware) {
    const inverted = oppositeDir(chosen.dir);
    if (inverted === oppositeDir(snake.dir)) return snake.dir;
    return inverted;
  }
  return chosen.dir;
}
