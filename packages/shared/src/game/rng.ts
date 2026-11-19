/**
 * Deterministic, serialisable PRNG.
 *
 * Mulberry32: 32 bits of state, fast, good enough for spawns and effect rolls,
 * and identical on every runtime. State is a plain number, so it can be stored
 * in a snapshot and restored after a reconnect.
 *
 * Never use `Math.random()` in game logic.
 */

/** A seeded random source. The state is advanced in place. */
export interface Rng {
  /** Current 32-bit state. Persist this to resume a match exactly. */
  state: number;
  /** Next float in [0, 1). */
  next(): number;
  /** Next integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Pick one element; returns undefined for an empty list. */
  pick<T>(items: readonly T[]): T | undefined;
  /** Weighted pick over entries with positive integer weights. */
  weighted<T>(entries: ReadonlyArray<{ value: T; weight: number }>): T | undefined;
}

/** Create a PRNG from a numeric seed. */
export function createRng(seed: number): Rng {
  const rng: Rng = {
    state: seed >>> 0,
    next() {
      rng.state = (rng.state + 0x6d2b79f5) >>> 0;
      let t = rng.state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(maxExclusive: number) {
      if (maxExclusive <= 0) return 0;
      return Math.floor(rng.next() * maxExclusive);
    },
    pick<T>(items: readonly T[]): T | undefined {
      if (items.length === 0) return undefined;
      return items[rng.int(items.length)];
    },
    weighted<T>(entries: ReadonlyArray<{ value: T; weight: number }>): T | undefined {
      const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
      if (total <= 0) return undefined;
      let roll = rng.next() * total;
      for (const entry of entries) {
        roll -= Math.max(0, entry.weight);
        if (roll < 0) return entry.value;
      }
      return entries.at(-1)?.value;
    },
  };
  return rng;
}

/** Create an RNG that reads and writes `GameState.rngState`. */
export function rngFromState(holder: { rngState: number }): Rng {
  const rng = createRng(holder.rngState);
  return {
    get state() {
      return rng.state;
    },
    set state(value: number) {
      rng.state = value;
    },
    next() {
      const value = rng.next();
      holder.rngState = rng.state;
      return value;
    },
    int(maxExclusive: number) {
      const value = rng.int(maxExclusive);
      holder.rngState = rng.state;
      return value;
    },
    pick<T>(items: readonly T[]): T | undefined {
      const value = rng.pick(items);
      holder.rngState = rng.state;
      return value;
    },
    weighted<T>(entries: ReadonlyArray<{ value: T; weight: number }>): T | undefined {
      const value = rng.weighted(entries);
      holder.rngState = rng.state;
      return value;
    },
  };
}
