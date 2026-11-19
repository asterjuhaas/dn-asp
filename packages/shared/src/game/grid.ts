import { ARENA } from "../constants";
import type { Point, SnakeState } from "./types";

/** True when `p` is inside the inner arena. */
export function inBounds(p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < ARENA.width && p.y < ARENA.height;
}

/** True when both points address the same cell. */
export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Manhattan distance between two cells. */
export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Stable key for a cell, for Map/Set lookups. */
export function cellKey(p: Point): string {
  return `${p.x},${p.y}`;
}

/** Iterate the cells of a snake, head first. */
export function snakeCells(snake: SnakeState): readonly Point[] {
  return snake.body;
}

/**
 * Find the snake occupying `p`, optionally ignoring one snake and a cell it is
 * about to vacate.
 */
export function occupantAt(
  snakes: readonly SnakeState[],
  p: Point,
  ignoreId?: string,
): SnakeState | undefined {
  for (const snake of snakes) {
    if (!snake.alive || snake.id === ignoreId) continue;
    if (snake.body.some((cell) => samePoint(cell, p))) return snake;
  }
  return undefined;
}

/** All cells of every living snake, as a key set. */
export function occupancySet(snakes: readonly SnakeState[]): Set<string> {
  const set = new Set<string>();
  for (const snake of snakes) {
    if (!snake.alive) continue;
    for (const cell of snake.body) set.add(cellKey(cell));
  }
  return set;
}
