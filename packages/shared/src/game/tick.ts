import { ARENA, DIR_DELTAS, RULES, TIMING } from "../constants";
import type { DeathCause, GameEvent, PlayerId } from "../protocol";
import { applyMysteryEffect, invertDir, oppositeDir, rollMystery } from "./effects";
import { cellKey, inBounds, samePoint } from "./grid";
import { rngFromState, type Rng } from "./rng";
import { maintainApples } from "./spawn";
import type { GameState, InputMap, Point, SnakeState, StepResult } from "./types";

function tuple(p: Point): [number, number] {
  return [p.x, p.y];
}

function headOf(snake: SnakeState): Point {
  return snake.body[0]!;
}

function nextPoint(snake: SnakeState, dir = snake.dir): Point {
  const delta = DIR_DELTAS[dir];
  const head = headOf(snake);
  return { x: head.x + delta.x, y: head.y + delta.y };
}

function shedAt(state: GameState, p: Point) {
  return state.sheds.find((shed) => samePoint(shed, p));
}

/** All current body occupancy, including tails that did not retract. */
function occupancy(state: GameState): Map<string, SnakeState> {
  const map = new Map<string, SnakeState>();
  for (const snake of state.snakes) {
    if (!snake.alive) continue;
    for (const cell of snake.body) map.set(cellKey(cell), snake);
  }
  return map;
}

/** A cell is solid if a body or a shed occupies it. */
function isSolid(state: GameState, p: Point, ignoreBodyOf?: string): boolean {
  if (!inBounds(p)) return true;
  for (const snake of state.snakes) {
    if (!snake.alive || snake.id === ignoreBodyOf) continue;
    if (snake.body.some((cell) => samePoint(cell, p))) return true;
  }
  return state.sheds.some((shed) => samePoint(shed, p));
}

/** Apply at most two queued turns per snake, honouring Reverse and 180-degree blocks. */
function applyInputs(state: GameState, inputs: InputMap): void {
  for (const snake of state.snakes) {
    if (!snake.alive) continue;
    const queued = inputs.get(snake.id);
    if (!queued || queued.length === 0) continue;
    for (const requested of queued.slice(0, RULES.maxTurnQueue)) {
      const dir = snake.effects.reverse > 0 ? invertDir(requested) : requested;
      if (dir === oppositeDir(snake.dir)) continue;
      snake.dir = dir;
    }
  }
}

/** Deaths discovered while resolving one movement phase. */
interface PendingDeath {
  snake: SnakeState;
  cause: DeathCause;
  killerId?: PlayerId;
}

/** Expire timers, sheds and apples. Applies the Ghost ejection rule. */
function expireTimers(state: GameState): PendingDeath[] {
  const deaths: PendingDeath[] = [];
  for (const snake of state.snakes) {
    if (!snake.alive) continue;
    if (snake.jumpscareCooldown > 0) snake.jumpscareCooldown--;

    const wasGhost = snake.effects.ghost > 0;
    if (snake.effects.ghost > 0) snake.effects.ghost--;
    if (snake.effects.reverse > 0) snake.effects.reverse--;
    if (snake.effects.overdrive > 0) snake.effects.overdrive--;

    if (wasGhost && snake.effects.ghost === 0) {
      const head = headOf(snake);
      if (isSolid(state, head, snake.id)) {
        snake.ejectionTicks += 2;
        if (snake.ejectionTicks >= 16) {
          killSnake(snake, "trap");
          deaths.push({ snake, cause: "trap" });
        } else {
          snake.effects.ghost = 2;
        }
      } else {
        snake.ejectionTicks = 0;
      }
    }
  }

  for (const shed of state.sheds) {
    shed.ttl--;
    if (shed.ownerGrace > 0) shed.ownerGrace--;
  }
  state.sheds = state.sheds.filter((shed) => shed.ttl > 0);
  state.apples = state.apples.filter((apple) => --apple.ttl > 0);
  return deaths;
}

/** Retract one tail cell unless a growth credit holds it in place. */
function retractTails(state: GameState): void {
  for (const snake of state.snakes) {
    if (!snake.alive) continue;
    if (snake.growth > 0) {
      snake.growth--;
      continue;
    }
    if (snake.body.length > 1) snake.body.pop();
  }
}

function killSnake(snake: SnakeState, cause: DeathCause, killerId?: PlayerId): void {
  snake.alive = false;
  snake.deathCause = cause;
  if (killerId !== undefined) snake.killerId = killerId;
}

/**
 * Resolve one movement phase (base or overdrive) for every snake that has a
 * target. Returns moves that survived; mutates nothing except pending deaths.
 */
function resolvePhase(
  state: GameState,
  targets: Map<SnakeState, Point>,
  deaths: PendingDeath[],
): void {
  const board = occupancy(state);
  const deathIds = new Set<string>();

  const addDeath = (snake: SnakeState, cause: DeathCause, killerId?: PlayerId) => {
    if (deathIds.has(snake.id)) return;
    deathIds.add(snake.id);
    deaths.push({ snake, cause, ...(killerId !== undefined ? { killerId } : {}) });
  };

  // 1. Arena border.
  for (const [snake, target] of targets) {
    if (!inBounds(target)) addDeath(snake, "wall");
  }

  // 2. Head-on: two or more heads targeting the same cell all die. Resolved
  // before body checks so a swap is never misread as a ram.
  const byTarget = new Map<string, SnakeState[]>();
  for (const [snake, target] of targets) {
    if (deathIds.has(snake.id)) continue;
    const key = cellKey(target);
    const group = byTarget.get(key) ?? [];
    group.push(snake);
    byTarget.set(key, group);
  }
  for (const group of byTarget.values()) {
    if (group.length > 1) for (const snake of group) addDeath(snake, "head-on");
  }

  // 3. Swap: A enters B's old head while B enters A's old head.
  const entries = [...targets.entries()].filter(([snake]) => !deathIds.has(snake.id));
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [a, targetA] = entries[i]!;
      const [b, targetB] = entries[j]!;
      if (samePoint(targetA, headOf(b)) && samePoint(targetB, headOf(a))) {
        addDeath(a, "head-on");
        addDeath(b, "head-on");
      }
    }
  }

  // 4. Shed walls and bodies. Ghosts ignore both, but not the border.
  for (const [snake, target] of targets) {
    if (deathIds.has(snake.id) || !inBounds(target)) continue;

    const shed = shedAt(state, target);
    const ownedBySelf = shed !== undefined && shed.ownerId === snake.id && shed.ownerGrace > 0;
    if (shed && !ownedBySelf && snake.effects.ghost === 0) {
      addDeath(snake, "shed");
      continue;
    }

    if (snake.effects.ghost === 0) {
      const other = board.get(cellKey(target));
      if (other) {
        if (other.id === snake.id) addDeath(snake, "self");
        else {
          other.score += RULES.killScore;
          other.kills++;
          addDeath(snake, "body", other.id);
        }
      }
    }
  }

  const dead = new Set(deaths.map((entry) => entry.snake.id));
  for (const [snake, target] of targets) {
    if (dead.has(snake.id)) continue;
    snake.body.unshift({ x: target.x, y: target.y });
  }
}

/** Eat any apple under a snake's head and apply its effect. */
function consumeApples(state: GameState, rng: Rng, events: GameEvent[]): void {
  for (const snake of state.snakes) {
    if (!snake.alive) continue;
    const head = headOf(snake);
    const index = state.apples.findIndex((apple) => samePoint(apple, head));
    if (index < 0) continue;
    const [apple] = state.apples.splice(index, 1);
    if (!apple) continue;

    if (apple.kind === "normal") {
      snake.score += RULES.normalAppleScore;
      snake.apples++;
      const others = state.snakes.filter((other) => other.alive && other !== snake);
      const growth: Array<{ playerId: PlayerId; amount: number }> = [];
      if (others.length === 0) {
        snake.growth += 1;
        growth.push({ playerId: snake.id, amount: 1 });
      } else {
        const amount = others.length === 1 ? 2 : 1;
        for (const other of others) {
          other.growth += amount;
          growth.push({ playerId: other.id, amount });
        }
      }
      events.push({
        kind: "apple",
        playerId: snake.id,
        appleKind: "normal",
        score: RULES.normalAppleScore,
        growth,
      });
    } else {
      snake.score += RULES.mysteryAppleScore;
      snake.apples++;
      state.lastMysteryTick[snake.id] = state.tick;
      const roll = rollMystery(state, snake, rng);
      events.push({
        kind: "apple",
        playerId: snake.id,
        appleKind: "mystery",
        score: RULES.mysteryAppleScore,
        growth: [],
      });
      events.push(...applyMysteryEffect(state, snake, roll.effect, roll.targets, rng));
    }
  }
}

function dropDeathApples(state: GameState, deaths: readonly PendingDeath[]): void {
  for (const { snake } of deaths) {
    const head = headOf(snake);
    const free =
      head.x >= 1 &&
      head.y >= 1 &&
      head.x < ARENA.width - 1 &&
      head.y < ARENA.height - 1 &&
      !state.snakes.some(
        (other) => other.alive && other.body.some((cell) => samePoint(cell, head)),
      ) &&
      !state.sheds.some((shed) => samePoint(shed, head)) &&
      !state.apples.some((apple) => samePoint(apple, head));
    if (!free) continue;
    state.apples.push({
      id: `a${state.nextAppleId++}`,
      kind: "normal",
      x: head.x,
      y: head.y,
      ttl: RULES.normalAppleTtlTicks,
    });
  }
}

/**
 * Advance the match by exactly one authoritative tick.
 *
 * The function mutates `state` in place and returns the events produced by this
 * tick. It never reads the wall clock, so it is deterministic for a given state
 * and input map.
 */
export function stepGame(state: GameState, inputs: InputMap): StepResult {
  const events: GameEvent[] = [];
  if (state.phase !== "PLAYING") {
    return { state, events, ended: true };
  }

  state.tick++;
  const rng = rngFromState(state);

  applyInputs(state, inputs);
  const deaths: PendingDeath[] = expireTimers(state);
  retractTails(state);

  // Phase A: one step for every living snake.
  const targets = new Map<SnakeState, Point>();
  for (const snake of state.snakes) {
    if (snake.alive) targets.set(snake, nextPoint(snake));
  }
  resolvePhase(state, targets, deaths);

  for (const death of deaths) {
    killSnake(death.snake, death.cause, death.killerId);
    events.push({
      kind: "death",
      playerId: death.snake.id,
      cause: death.cause,
      ...(death.killerId !== undefined ? { killerId: death.killerId } : {}),
    });
  }

  consumeApples(state, rng, events);

  // Phase B: Overdrive. Credited after Phase A, spent two at a time.
  const extraTargets = new Map<SnakeState, Point>();
  for (const snake of state.snakes) {
    if (!snake.alive || snake.effects.overdrive === 0) continue;
    snake.overdriveCredits++;
    if (snake.overdriveCredits >= 2) {
      snake.overdriveCredits -= 2;
      extraTargets.set(snake, nextPoint(snake));
    }
  }
  if (extraTargets.size > 0) {
    const extraDeaths: PendingDeath[] = [];
    resolvePhase(state, extraTargets, extraDeaths);
    for (const death of extraDeaths) {
      killSnake(death.snake, death.cause, death.killerId);
      deaths.push(death);
      events.push({
        kind: "death",
        playerId: death.snake.id,
        cause: death.cause,
        ...(death.killerId !== undefined ? { killerId: death.killerId } : {}),
      });
    }
    consumeApples(state, rng, events);
  }

  dropDeathApples(state, deaths);
  maintainApples(state, rng);

  const alive = state.snakes.filter((snake) => snake.alive);
  let ended = false;
  let reason: StepResult["reason"];
  if (alive.length <= 1) {
    ended = true;
    reason = alive.length === 0 ? "mutual-destruction" : "last-alive";
  } else if (state.tick >= TIMING.matchTicks) {
    ended = true;
    reason = "time";
  }

  return { state, events, ended, ...(reason !== undefined ? { reason } : {}) };
}

/** Convert the internal player list to the placement-independent score order. */
export function ranking(state: GameState): SnakeState[] {
  const slot = new Map(state.snakes.map((snake, index) => [snake.id, index]));
  return [...state.snakes].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    if (a.body.length !== b.body.length) return b.body.length - a.body.length;
    if (a.apples !== b.apples) return b.apples - a.apples;
    return (slot.get(a.id) ?? 0) - (slot.get(b.id) ?? 0);
  });
}

export { tuple };
