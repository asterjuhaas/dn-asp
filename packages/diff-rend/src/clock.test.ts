import { afterEach, describe, expect, it, vi } from "vitest";
import { Clock } from "./clock";

function stubClock(times: number[]) {
  let index = 0;
  vi.spyOn(performance, "now").mockImplementation(() => times[index++] ?? times.at(-1) ?? 0);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Clock", () => {
  it("returns zero on the first tick and records the start time", () => {
    stubClock([1000]);
    const clock = new Clock();
    expect(clock.tick()).toBe(0);
    expect(clock.frame).toBe(0);
    expect(clock.elapsed).toBe(0);
  });

  it("accumulates clamped deltas in seconds", () => {
    stubClock([1000, 1016, 1048, 5000]);
    const clock = new Clock(0.1);
    clock.tick();
    expect(clock.tick()).toBeCloseTo(0.016, 5);
    expect(clock.tick()).toBeCloseTo(0.032, 5);
    // A 3.9s stall is clamped to maxDt.
    expect(clock.tick()).toBeCloseTo(0.1, 5);
    expect(clock.frame).toBe(3);
    expect(clock.elapsed).toBeCloseTo(0.148, 5);
  });

  it("smooths fps from the raw interval", () => {
    stubClock([0, 10, 20, 30]);
    const clock = new Clock();
    clock.tick();
    clock.tick();
    expect(clock.fps).toBeCloseTo(100, 5);
    clock.tick();
    // Exponential smoothing towards 100 fps leaves the value at 100.
    expect(clock.fps).toBeCloseTo(100, 5);
  });

  it("never returns a negative delta when time does not advance", () => {
    stubClock([1000, 1000]);
    const clock = new Clock();
    clock.tick();
    expect(clock.tick()).toBe(0);
  });
});
