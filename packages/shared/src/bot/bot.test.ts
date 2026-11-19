import { describe, expect, it } from "vitest";
import { createGame } from "../game/create";
import { oppositeDir } from "../game/effects";
import { createRng } from "../game/rng";
import { stepGame } from "../game/tick";
import type { Dir, PlayerId } from "../protocol";
import { BOT_PROFILES, shouldDecide } from "./difficulty";
import { decideBotTurn } from "./brain";
import { createGridScratch, distanceTo, floodFill, indexOf } from "./pathfinding";
import { BOT_NAMES, botName, isBotName } from "./names";

function bots(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `bot${index}`,
    name: botName(index),
    isBot: true,
    difficulty: "normal" as const,
  }));
}

describe("bot names", () => {
  it("always carries the BOT prefix mandatory for trust", () => {
    for (let i = 0; i < 12; i++) {
      const name = botName(i);
      expect(name.startsWith("BOT-")).toBe(true);
      expect(isBotName(name)).toBe(true);
      expect(name.length).toBeLessThanOrEqual(12);
    }
    expect(BOT_NAMES.length).toBeGreaterThanOrEqual(6);
  });
});

describe("difficulty tiers", () => {
  it("re-decides on the documented cadence", () => {
    expect(shouldDecide(0, "easy")).toBe(true);
    expect(shouldDecide(1, "easy")).toBe(false);
    expect(shouldDecide(3, "easy")).toBe(true);
    expect(shouldDecide(1, "normal")).toBe(false);
    expect(shouldDecide(2, "normal")).toBe(true);
    expect(shouldDecide(1, "hard")).toBe(true);
    expect(shouldDecide(1, "nightmare")).toBe(true);
  });

  it("orders difficulty from forgiving to ruthless", () => {
    expect(BOT_PROFILES.easy.randomSafe).toBeGreaterThan(BOT_PROFILES.hard.randomSafe);
    expect(BOT_PROFILES.easy.ignoreSafety).toBeGreaterThan(BOT_PROFILES.nightmare.ignoreSafety);
    expect(BOT_PROFILES.nightmare.appleWeight).toBeGreaterThan(BOT_PROFILES.easy.appleWeight);
  });
});

describe("pathfinding", () => {
  it("finds distances through open space", () => {
    const scratch = createGridScratch();
    scratch.blocked.fill(0);
    const area = floodFill(scratch, { x: 10, y: 10 });
    expect(area).toBe(58 * 20);
    expect(distanceTo(scratch, { x: 10, y: 10 })).toBe(0);
    expect(distanceTo(scratch, { x: 13, y: 10 })).toBe(3);
    expect(indexOf({ x: -1, y: 0 })).toBe(-1);
  });

  it("respects blocked cells", () => {
    const scratch = createGridScratch();
    scratch.blocked.fill(0);
    for (let y = 0; y < 20; y++) scratch.blocked[indexOf({ x: 11, y })] = 1;
    const area = floodFill(scratch, { x: 10, y: 10 });
    expect(area).toBe(11 * 20);
    expect(distanceTo(scratch, { x: 12, y: 10 })).toBe(-1);
  });
});

describe("decideBotTurn", () => {
  it("returns null for a missing or dead bot", () => {
    const game = createGame(bots(2), 5);
    const scratch = createGridScratch();
    expect(decideBotTurn(game, "ghost", "normal", createRng(1), scratch)).toBeNull();
    game.snakes[0]!.alive = false;
    expect(decideBotTurn(game, "bot0", "normal", createRng(1), scratch)).toBeNull();
  });

  it("is deterministic for the same state and seed", () => {
    const game = createGame(bots(3), 17);
    const first = decideBotTurn(game, "bot0", "hard", createRng(42), createGridScratch());
    const second = decideBotTurn(game, "bot0", "hard", createRng(42), createGridScratch());
    expect(first).toBe(second);
  });

  it("heads for an apple placed directly ahead", () => {
    const game = createGame(bots(2), 9);
    const bot = game.snakes[0]!;
    const head = bot.body[0]!;
    game.apples = [{ id: "target", kind: "normal", x: head.x + 4, y: head.y, ttl: 100 }];
    const dir = decideBotTurn(game, bot.id, "hard", createRng(3), createGridScratch());
    expect(dir).toBe("right");
  });

  it("never proposes a 180-degree reversal", () => {
    const game = createGame(bots(4), 21);
    for (const difficulty of ["easy", "normal", "hard", "nightmare"] as const) {
      const scratch = createGridScratch();
      for (const bot of game.snakes) {
        const dir = decideBotTurn(game, bot.id, difficulty, createRng(8), scratch);
        if (dir) expect(dir).not.toBe(oppositeDir(bot.dir));
      }
    }
  });
});

describe("bot-only matches", () => {
  it("play 50 seeded ticks without illegal directions or crashes", () => {
    for (let seed = 0; seed < 20; seed++) {
      const game = createGame(bots(4), seed);
      const scratch = createGridScratch();
      const last = new Map<PlayerId, Dir>();
      for (let tick = 0; tick < 50 && game.phase === "PLAYING"; tick++) {
        const inputs = new Map<PlayerId, Dir[]>();
        for (const bot of game.snakes) {
          if (!bot.alive) continue;
          let dir = last.get(bot.id) ?? bot.dir;
          if (shouldDecide(game.tick, bot.difficulty ?? "normal")) {
            const decided = decideBotTurn(
              game,
              bot.id,
              bot.difficulty ?? "normal",
              createRng(seed + tick),
              scratch,
            );
            if (decided) dir = decided;
          }
          expect(["up", "down", "left", "right"]).toContain(dir);
          inputs.set(bot.id, [dir]);
          last.set(bot.id, dir);
        }
        const result = stepGame(game, inputs);
        if (result.ended) break;
      }
      expect(game.tick).toBeGreaterThan(0);
    }
  });
});
