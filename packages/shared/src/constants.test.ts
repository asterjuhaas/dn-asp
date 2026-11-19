import { describe, expect, it } from "vitest";
import { ARENA, PROTOCOL_VERSION, RULES, TIMING } from "./constants";

describe("core constants", () => {
  it("keeps the arena centered inside the minimum terminal", () => {
    expect(ARENA.renderedWidth).toBeLessThanOrEqual(80);
    expect(ARENA.width % 2).toBe(0);
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("uses a 120ms authoritative tick", () => {
    expect(TIMING.tickMs).toBe(120);
    expect(TIMING.matchTicks * TIMING.tickMs).toBe(180_000);
  });

  it("supports up to six snakes with bounded growth", () => {
    expect(RULES.maxPlayers).toBe(6);
    expect(RULES.maxLength).toBeGreaterThanOrEqual(RULES.startLength * 4);
  });
});
