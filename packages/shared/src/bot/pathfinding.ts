import { ARENA } from "../constants";
import type { Point } from "../game/types";

const W = ARENA.width;
const H = ARENA.height;

/** A reusable scratch grid for bot pathfinding, indexed as `y * W + x`. */
export interface GridScratch {
  blocked: Uint8Array;
  visited: Uint8Array;
  distance: Int16Array;
  queue: Int16Array;
}

/** Allocate the per-room scratch buffers once. */
export function createGridScratch(): GridScratch {
  return {
    blocked: new Uint8Array(W * H),
    visited: new Uint8Array(W * H),
    distance: new Int16Array(W * H),
    queue: new Int16Array(W * H),
  };
}

/** Index of a cell, or -1 when it is outside the arena. */
export function indexOf(p: Point): number {
  if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) return -1;
  return p.y * W + p.x;
}

/** Coordinate of a cell index. */
export function pointOf(index: number): Point {
  return { x: index % W, y: Math.floor(index / W) };
}

/** The four orthogonal neighbours of a cell index. */
export const NEIGHBOURS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Flood fill from `start` over cells that are not blocked.
 *
 * Writes BFS distances into `scratch.distance` (`-1` for unreachable). Returns
 * the reachable area, capped at `cap` cells. The start cell must be free.
 */
export function floodFill(scratch: GridScratch, start: Point, cap = W * H): number {
  const startIndex = indexOf(start);
  if (startIndex < 0 || scratch.blocked[startIndex]) return 0;

  const { visited, distance, queue, blocked } = scratch;
  visited.fill(0);
  distance.fill(-1);

  let head = 0;
  let tail = 0;
  queue[tail++] = startIndex;
  visited[startIndex] = 1;
  distance[startIndex] = 0;
  let area = 0;

  while (head < tail && area < cap) {
    const index = queue[head++]!;
    area++;
    const x = index % W;
    const y = Math.floor(index / W);
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const next = ny * W + nx;
      if (visited[next] || blocked[next]) continue;
      visited[next] = 1;
      distance[next] = distance[index]! + 1;
      queue[tail++] = next;
    }
  }

  return area;
}

/**
 * BFS distances from `start` over free cells, written into `scratch.distance`.
 * Unlike {@link floodFill} this always explores the whole reachable region.
 */
export function distanceField(scratch: GridScratch, start: Point): void {
  floodFill(scratch, start, W * H);
}

/** Distance to a cell from the last {@link distanceField}, or -1 when unreachable. */
export function distanceTo(scratch: GridScratch, p: Point): number {
  const index = indexOf(p);
  return index < 0 ? -1 : scratch.distance[index]!;
}
