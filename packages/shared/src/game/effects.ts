import { ARENA, EFFECT_MS, EFFECT_TICKS, MYSTERY_WEIGHTS, RULES } from "../constants";
import type { Dir, GameEvent, MysteryEffect } from "../protocol";
import type { Rng } from "./rng";
import { samePoint } from "./grid";
import { relocateApple } from "./spawn";
import type { GameState, Point, SnakeState } from "./types";

/** Invert a direction, used by the Reverse effect. */
export function invertDir(dir: Dir): Dir {
  switch (dir) {
    case "up":
      return "down";
    case "down":
      return "up";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}

/** The opposite of a direction; requesting it is a 180-degree reversal. */
export function oppositeDir(dir: Dir): Dir {
  return invertDir(dir);
}

/** Result of a mystery roll. */
export interface MysteryRoll {
  effect: MysteryEffect;
  targets: SnakeState[];
}

/** Living rivals of `snake`, humans first. */
export function rivalsOf(state: GameState, snake: SnakeState): SnakeState[] {
  const rivals = state.snakes.filter((other) => other.alive && other.id !== snake.id);
  return [...rivals.filter((other) => !other.isBot), ...rivals.filter((other) => other.isBot)];
}

/**
 * Choose a jumpscare victim: nearest human, else nearest bot, skipping anyone
 * still on cooldown. Ties resolve to the longest snake, then slot order.
 */
export function chooseJumpscareVictim(state: GameState, eater: SnakeState): SnakeState | undefined {
  const rivals = rivalsOf(state, eater);
  const human = rivals.filter((other) => !other.isBot);
  const pool = (human.length > 0 ? human : rivals).filter((other) => other.jumpscareCooldown <= 0);
  if (pool.length === 0) return undefined;

  const head = eater.body[0]!;
  let best: SnakeState | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const snake of pool) {
    const target = snake.body[0]!;
    const distance = Math.abs(target.x - head.x) + Math.abs(target.y - head.y);
    if (
      distance < bestDistance ||
      (distance === bestDistance && best !== undefined && snake.body.length > best.body.length)
    ) {
      best = snake;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Roll a mystery effect at consumption time.
 *
 * Invalid effects are excluded from the weighted roll rather than consuming a
 * second RNG draw: jumpscare needs an eligible rival, molt needs length 7+,
 * reverse needs at least one rival. This keeps the roll deterministic and
 * bounded.
 */
export function rollMystery(state: GameState, eater: SnakeState, rng: Rng): MysteryRoll {
  const rivals = state.snakes.filter((other) => other.alive && other.id !== eater.id);
  const jumpscareVictim = chooseJumpscareVictim(state, eater);

  const entries: Array<{ value: MysteryEffect; weight: number }> = [];

  if (jumpscareVictim) {
    entries.push({ value: "jumpscare", weight: MYSTERY_WEIGHTS.jumpscare });
  }
  if (eater.body.length >= 7) {
    entries.push({ value: "molt", weight: MYSTERY_WEIGHTS.molt });
  }
  entries.push({ value: "ghost", weight: MYSTERY_WEIGHTS.ghost });
  if (rivals.length > 0) {
    entries.push({ value: "reverse", weight: MYSTERY_WEIGHTS.reverse });
  }
  entries.push({ value: "overdrive", weight: MYSTERY_WEIGHTS.overdrive });

  const effect = rng.weighted(entries) ?? "overdrive";
  const targets =
    effect === "jumpscare"
      ? jumpscareVictim
        ? [jumpscareVictim]
        : []
      : effect === "reverse"
        ? rivals
        : [eater];

  return { effect, targets };
}

function toTuple(p: Point): [number, number] {
  return [p.x, p.y];
}

/**
 * Apply a rolled mystery effect and return the events it produces.
 *
 * Mystery effects never trigger weaponized growth.
 */
export function applyMysteryEffect(
  state: GameState,
  eater: SnakeState,
  effect: MysteryEffect,
  targets: readonly SnakeState[],
  rng: Rng,
): GameEvent[] {
  const events: GameEvent[] = [];
  const durationMs = EFFECT_MS[effect];
  const targetIds = targets.map((snake) => snake.id);

  switch (effect) {
    case "jumpscare": {
      for (const victim of targets) victim.jumpscareCooldown = RULES.jumpscareCooldownTicks;
      break;
    }
    case "molt": {
      const segments = Math.min(
        RULES.moltSegments,
        Math.max(0, eater.body.length - RULES.startLength),
      );
      const removed = segments > 0 ? eater.body.splice(eater.body.length - segments, segments) : [];
      const cells: Point[] = [];
      for (const cell of removed) {
        if (cell.x <= 0 || cell.y <= 0 || cell.x >= ARENA.width - 1 || cell.y >= ARENA.height - 1) {
          continue;
        }
        const shed = {
          x: cell.x,
          y: cell.y,
          ownerId: eater.id,
          ttl: RULES.moltShedTicks,
          ownerGrace: RULES.moltGraceTicks,
        };
        state.sheds.push(shed);
        cells.push(cell);
        for (const apple of state.apples) {
          if (samePoint(apple, cell)) relocateApple(state, apple, rng);
        }
      }
      while (state.sheds.length > RULES.maxShedCells) state.sheds.shift();
      if (cells.length > 0) {
        events.push({
          kind: "shed",
          ownerId: eater.id,
          cells: cells.map(toTuple),
          expiresAtTick: state.tick + RULES.moltShedTicks,
        });
      }
      break;
    }
    case "ghost": {
      eater.effects.ghost = EFFECT_TICKS.ghost;
      eater.ejectionTicks = 0;
      break;
    }
    case "reverse": {
      for (const rival of targets) rival.effects.reverse = EFFECT_TICKS.reverse;
      break;
    }
    case "overdrive": {
      eater.effects.overdrive = EFFECT_TICKS.overdrive;
      eater.overdriveCredits = 0;
      break;
    }
  }

  events.push({
    kind: "mystery",
    playerId: eater.id,
    effect,
    targets: targetIds,
    durationMs,
  });
  return events;
}
