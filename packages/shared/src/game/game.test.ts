import { describe, expect, it } from "vitest";
import { ARENA, RULES, TIMING } from "../constants";
import { createGame } from "./create";
import { applyMysteryEffect, chooseJumpscareVictim, invertDir, rollMystery } from "./effects";
import { createRng } from "./rng";
import { stepGame } from "./tick";
import type { AppleState, GameState, Point, SnakeState } from "./types";
import type { Dir, PlayerId } from "../protocol";

function makeSnake(
  id: string,
  body: Point[],
  dir: Dir,
  overrides: Partial<SnakeState> = {},
): SnakeState {
  return {
    id,
    name: id.toUpperCase(),
    color: 10,
    isBot: false,
    body,
    dir,
    alive: true,
    score: 0,
    apples: 0,
    kills: 0,
    growth: 0,
    effects: { ghost: 0, reverse: 0, overdrive: 0 },
    jumpscareCooldown: 0,
    overdriveCredits: 0,
    ejectionTicks: 0,
    ...overrides,
  };
}

function makeState(snakes: SnakeState[], apples: AppleState[] = []): GameState {
  return {
    tick: 0,
    phase: "PLAYING",
    seed: 1,
    rngState: 1,
    snakes,
    apples,
    sheds: [],
    nextAppleId: apples.length,
    nextEventId: 1,
    lastMysteryTick: {},
  };
}

function apple(x: number, y: number, kind: AppleState["kind"] = "normal"): AppleState {
  return { id: `a${x}_${y}`, kind, x, y, ttl: RULES.normalAppleTtlTicks };
}

function line(from: number, y: number, length: number, dx = 1): Point[] {
  return Array.from({ length }, (_, i) => ({ x: from + i * dx, y }));
}

function step(state: GameState, inputs: ReadonlyMap<PlayerId, Dir[]> = new Map()) {
  return stepGame(state, inputs);
}

describe("createGame", () => {
  it("places snakes on the approved spawn anchors", () => {
    const game = createGame(
      [
        { id: "p1", name: "ONE" },
        { id: "p2", name: "TWO" },
        { id: "p3", name: "THREE" },
      ],
      42,
    );
    expect(game.snakes.map((snake) => snake.body[0])).toEqual([
      { x: 6, y: 4 },
      { x: 51, y: 15 },
      { x: 6, y: 15 },
    ]);
    for (const snake of game.snakes) {
      expect(snake.body).toHaveLength(RULES.startLength);
      expect(snake.dir).toBe(snake.body[0]!.x < ARENA.width / 2 ? "right" : "left");
    }
  });

  it("spawns the right number of apples per player count", () => {
    for (const count of [2, 3, 4, 5, 6]) {
      const players = Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        name: `P${i}`,
      }));
      const game = createGame(players, 7);
      expect(game.apples.filter((a) => a.kind === "normal")).toHaveLength(
        Math.min(6, Math.max(3, count + 1)),
      );
      expect(game.apples.filter((a) => a.kind === "mystery")).toHaveLength(count >= 5 ? 2 : 1);
    }
  });

  it("keeps apples away from live heads when space allows", () => {
    const game = createGame(
      [
        { id: "p1", name: "ONE" },
        { id: "p2", name: "TWO" },
      ],
      99,
    );
    for (const a of game.apples) {
      for (const snake of game.snakes) {
        const head = snake.body[0]!;
        expect(Math.abs(a.x - head.x) + Math.abs(a.y - head.y)).toBeGreaterThanOrEqual(
          RULES.spawnRelaxedDistance,
        );
      }
    }
  });

  it("is deterministic for a seed", () => {
    const players = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ];
    const first = createGame(players, 1234);
    const second = createGame(players, 1234);
    for (let i = 0; i < 20; i++) {
      step(first);
      step(second);
    }
    expect(first).toEqual(second);
  });
});

describe("normal apples and weaponized growth", () => {
  it("in a 2-player match grows the rival by 2 and the eater by 0", () => {
    const game = createGame(
      [
        { id: "p1", name: "ONE" },
        { id: "p2", name: "TWO" },
      ],
      5,
    );
    game.apples = [apple(7, 4)];
    const result = step(game);
    const eater = game.snakes[0]!;
    const rival = game.snakes[1]!;
    expect(eater.score).toBe(RULES.normalAppleScore);
    expect(eater.apples).toBe(1);
    expect(eater.growth).toBe(0);
    expect(rival.growth).toBe(2);
    const event = result.events.find((e) => e.kind === "apple");
    expect(event).toMatchObject({ appleKind: "normal", score: RULES.normalAppleScore });
  });

  it("in a 3+ player match grows every rival by 1", () => {
    const game = createGame(
      [
        { id: "p1", name: "ONE" },
        { id: "p2", name: "TWO" },
        { id: "p3", name: "THREE" },
      ],
      5,
    );
    game.apples = [apple(7, 4)];
    step(game);
    expect(game.snakes[1]!.growth).toBe(1);
    expect(game.snakes[2]!.growth).toBe(1);
    expect(game.snakes[0]!.growth).toBe(0);
  });

  it("grows the last surviving snake by 1", () => {
    const game = createGame([{ id: "p1", name: "ONE" }], 5);
    game.apples = [apple(7, 4)];
    step(game);
    expect(game.snakes[0]!.growth).toBe(1);
  });

  it("keeps the tail when growth debt is consumed", () => {
    const snake = makeSnake("p1", line(10, 5, 4, -1), "right", { growth: 1 });
    const game = makeState([snake]);
    game.apples = [];
    step(game);
    expect(snake.body).toHaveLength(5);
    expect(snake.growth).toBe(0);
  });

  it("retracts the tail when there is no growth", () => {
    const snake = makeSnake("p1", line(10, 5, 4, -1), "right");
    const game = makeState([snake]);
    game.apples = [];
    step(game);
    expect(snake.body).toHaveLength(4);
    expect(snake.body[0]).toEqual({ x: 11, y: 5 });
  });
});

describe("collisions", () => {
  it("kills a snake that hits the arena border", () => {
    const snake = makeSnake("p1", line(0, 5, 4), "left");
    const game = makeState([snake]);
    step(game);
    expect(snake.alive).toBe(false);
    expect(snake.deathCause).toBe("wall");
  });

  it("kills a snake that hits its own body", () => {
    const snake = makeSnake(
      "p1",
      [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 4, y: 6 },
        { x: 5, y: 6 },
        { x: 6, y: 6 },
      ],
      "down",
    );
    const game = makeState([snake]);
    step(game);
    expect(snake.alive).toBe(false);
    expect(snake.deathCause).toBe("self");
  });

  it("kills a snake that hits another body and credits the kill", () => {
    const a = makeSnake("a", line(10, 5, 2, -1), "right");
    const b = makeSnake(
      "b",
      [
        { x: 11, y: 6 },
        { x: 11, y: 5 },
        { x: 11, y: 4 },
      ],
      "down",
    );
    const game = makeState([a, b]);
    step(game);
    expect(a.alive).toBe(false);
    expect(a.deathCause).toBe("body");
    expect(a.killerId).toBe("b");
    expect(b.score).toBe(RULES.killScore);
    expect(b.kills).toBe(1);
  });

  it("kills both snakes on a head-on collision with no kill credit", () => {
    const a = makeSnake("a", line(10, 5, 2, -1), "right");
    const b = makeSnake("b", line(12, 5, 2), "left");
    const game = makeState([a, b]);
    step(game);
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);
    expect(a.deathCause).toBe("head-on");
    expect(b.score).toBe(0);
    expect(b.kills).toBe(0);
  });

  it("kills both snakes on a swap", () => {
    const a = makeSnake("a", line(10, 5, 2, -1), "right");
    const b = makeSnake("b", line(11, 5, 2), "left");
    const game = makeState([a, b]);
    step(game);
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);
    expect(a.deathCause).toBe("head-on");
    expect(b.deathCause).toBe("head-on");
  });

  it("kills all three snakes in a three-way head collision", () => {
    const a = makeSnake("a", line(10, 5, 2, -1), "right");
    const b = makeSnake("b", line(12, 5, 2), "left");
    const c = makeSnake(
      "c",
      [
        { x: 11, y: 6 },
        { x: 11, y: 7 },
      ],
      "up",
    );
    const game = makeState([a, b, c]);
    step(game);
    expect(game.snakes.filter((snake) => snake.alive)).toHaveLength(0);
    expect(game.snakes.every((snake) => snake.deathCause === "head-on")).toBe(true);
  });

  it("allows following a tail that retracts this tick", () => {
    const b = makeSnake(
      "b",
      [
        { x: 11, y: 5 },
        { x: 10, y: 5 },
      ],
      "right",
    );
    const a = makeSnake(
      "a",
      [
        { x: 10, y: 4 },
        { x: 10, y: 3 },
      ],
      "down",
    );
    const game = makeState([a, b]);
    step(game);
    expect(a.alive).toBe(true);
    expect(a.body[0]).toEqual({ x: 10, y: 5 });
    expect(b.alive).toBe(true);
  });

  it("lets a ghost pass through bodies but not the border", () => {
    const a = makeSnake("a", line(10, 5, 2, -1), "right", {
      effects: { ghost: 5, reverse: 0, overdrive: 0 },
    });
    const b = makeSnake(
      "b",
      [
        { x: 11, y: 6 },
        { x: 11, y: 5 },
        { x: 11, y: 4 },
      ],
      "down",
    );
    const game = makeState([a, b]);
    step(game);
    expect(a.alive).toBe(true);
    expect(a.body[0]).toEqual({ x: 11, y: 5 });
  });

  it("does not let a ghost survive a head-on", () => {
    const a = makeSnake("a", line(10, 5, 2, -1), "right", {
      effects: { ghost: 5, reverse: 0, overdrive: 0 },
    });
    const b = makeSnake("b", line(12, 5, 2), "left");
    const game = makeState([a, b]);
    step(game);
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);
  });
});

describe("inputs", () => {
  it("ignores a 180-degree reversal", () => {
    const snake = makeSnake("p1", line(10, 5, 4, -1), "right");
    const game = makeState([snake]);
    step(game, new Map([["p1", ["left"]]]));
    expect(snake.dir).toBe("right");
  });

  it("applies at most two turns per tick", () => {
    const snake = makeSnake("p1", line(10, 5, 4, -1), "right");
    const game = makeState([snake]);
    step(game, new Map([["p1", ["down", "right", "up"]]]));
    expect(snake.dir).toBe("right");
  });

  it("inverts direction under Reverse", () => {
    const snake = makeSnake("p1", line(10, 5, 4, -1), "right", {
      effects: { ghost: 0, reverse: 5, overdrive: 0 },
    });
    const game = makeState([snake]);
    step(game, new Map([["p1", ["up"]]]));
    expect(snake.dir).toBe("down");
    expect(snake.body[0]).toEqual({ x: 10, y: 6 });
  });

  it("maps every direction through invertDir", () => {
    expect(invertDir("up")).toBe("down");
    expect(invertDir("down")).toBe("up");
    expect(invertDir("left")).toBe("right");
    expect(invertDir("right")).toBe("left");
  });
});

describe("effects", () => {
  it("molt removes three segments and leaves shedding walls", () => {
    const snake = makeSnake("p1", line(10, 10, 7), "right");
    const game = makeState([snake]);
    const events = applyMysteryEffect(game, snake, "molt", [snake], createRng(1));
    expect(snake.body).toHaveLength(4);
    expect(game.sheds).toHaveLength(3);
    expect(events.some((event) => event.kind === "shed")).toBe(true);
  });

  it("molt keeps the snake at the minimum length", () => {
    const snake = makeSnake("p1", line(10, 10, 7), "right");
    const game = makeState([snake]);
    applyMysteryEffect(game, snake, "molt", [snake], createRng(1));
    applyMysteryEffect(game, snake, "molt", [snake], createRng(1));
    expect(snake.body.length).toBeGreaterThanOrEqual(RULES.startLength);
  });

  it("ghost, reverse and overdrive set their exact durations", () => {
    const a = makeSnake("a", line(10, 5, 4, -1), "right");
    const b = makeSnake("b", line(20, 10, 4, -1), "right");
    const game = makeState([a, b]);
    applyMysteryEffect(game, a, "ghost", [a], createRng(1));
    expect(a.effects.ghost).toBe(RULES.ghostTicks);
    applyMysteryEffect(game, a, "overdrive", [a], createRng(1));
    expect(a.effects.overdrive).toBe(RULES.overdriveTicks);
    applyMysteryEffect(game, a, "reverse", [b], createRng(1));
    expect(b.effects.reverse).toBe(RULES.reverseTicks);
  });

  it("jumpscare puts the victim on cooldown", () => {
    const a = makeSnake("a", line(10, 5, 4, -1), "right");
    const b = makeSnake("b", line(20, 10, 4, -1), "right");
    const game = makeState([a, b]);
    const events = applyMysteryEffect(game, a, "jumpscare", [b], createRng(1));
    expect(b.jumpscareCooldown).toBe(RULES.jumpscareCooldownTicks);
    expect(events[0]).toMatchObject({ kind: "mystery", effect: "jumpscare", targets: ["b"] });
  });

  it("prefers a human jumpscare victim over a nearer bot", () => {
    const eater = makeSnake("a", line(10, 10, 4, -1), "right");
    const bot = makeSnake("bot", line(12, 10, 4, -1), "right", { isBot: true });
    const human = makeSnake("human", line(10, 15, 4, -1), "right");
    const game = makeState([eater, bot, human]);
    expect(chooseJumpscareVictim(game, eater)?.id).toBe("human");
  });

  it("skips a victim that is still on jumpscare cooldown", () => {
    const eater = makeSnake("a", line(10, 10, 4, -1), "right");
    const first = makeSnake("one", line(20, 10, 4, -1), "right");
    const second = makeSnake("two", line(10, 15, 4, -1), "right", { jumpscareCooldown: 50 });
    const game = makeState([eater, first, second]);
    expect(chooseJumpscareVictim(game, eater)?.id).toBe("one");
  });

  it("never rolls jumpscare or reverse without a rival", () => {
    const snake = makeSnake("p1", line(10, 10, 7), "right");
    const game = makeState([snake]);
    for (let seed = 0; seed < 20; seed++) {
      const roll = rollMystery(game, snake, createRng(seed));
      expect(["jumpscare", "reverse"]).not.toContain(roll.effect);
    }
  });

  it("does not roll molt below length 7", () => {
    const snake = makeSnake("p1", line(10, 10, 4), "right");
    const game = makeState([snake]);
    for (let seed = 0; seed < 20; seed++) {
      const roll = rollMystery(game, snake, createRng(seed));
      expect(roll.effect).not.toBe("molt");
    }
  });

  it("expires effects after their duration", () => {
    const snake = makeSnake("p1", line(10, 5, 4, -1), "right", {
      effects: { ghost: 0, reverse: 1, overdrive: 0 },
    });
    const game = makeState([snake]);
    game.apples = [];
    step(game);
    expect(snake.effects.reverse).toBe(0);
  });
});

describe("overdrive", () => {
  it("moves one extra step every two ticks", () => {
    const a = makeSnake("a", line(10, 5, 4, -1), "right", {
      effects: { ghost: 0, reverse: 0, overdrive: 10 },
    });
    const b = makeSnake("b", line(40, 15, 4, -1), "right");
    const game = makeState([a, b]);
    for (let i = 0; i < 2; i++) {
      game.apples = [];
      step(game);
    }
    // Two base steps plus one overdrive step.
    expect(a.body[0]).toEqual({ x: 13, y: 5 });
  });
});

describe("apples", () => {
  it("expires apples after their TTL and replaces them", () => {
    const snake = makeSnake("p1", line(10, 5, 4, -1), "right");
    const other = makeSnake("p2", line(40, 15, 4, -1), "right");
    const game = makeState([snake, other], [{ ...apple(30, 2), id: "expiring", ttl: 1 }]);
    step(game);
    expect(game.apples.some((a) => a.id === "expiring")).toBe(false);
  });

  it("awards mystery score without weaponized growth", () => {
    const snake = makeSnake("p1", line(10, 5, 4, -1), "right");
    const other = makeSnake("p2", line(40, 15, 4, -1), "right");
    const game = makeState([snake, other], [apple(11, 5, "mystery")]);
    const result = step(game);
    expect(snake.score).toBe(RULES.mysteryAppleScore);
    expect(other.growth).toBe(0);
    expect(result.events.some((event) => event.kind === "mystery")).toBe(true);
  });
});

describe("match end", () => {
  it("ends at the tick limit", () => {
    const a = makeSnake("a", line(10, 5, 4, -1), "right");
    const b = makeSnake("b", line(40, 15, 4, -1), "right");
    const game = makeState([a, b]);
    game.tick = TIMING.matchTicks - 1;
    const result = step(game);
    expect(result.ended).toBe(true);
    expect(result.reason).toBe("time");
  });

  it("ends when the last rival dies", () => {
    const a = makeSnake("a", line(10, 5, 2, -1), "right");
    const b = makeSnake("b", line(12, 5, 2), "left");
    const game = makeState([a, b]);
    const result = step(game);
    expect(result.ended).toBe(true);
    expect(result.reason).toBe("mutual-destruction");
  });
});
