import type { BotDifficulty } from "../protocol";

/** Tunable behaviour of one bot difficulty tier. */
export interface BotProfile {
  /** Decide only every N ticks; between decisions the bot keeps its heading. */
  decisionEvery: number;
  /** Probability of choosing uniformly among safe moves instead of the best one. */
  randomSafe: number;
  /** Probability of choosing a legal but unsafe move. */
  ignoreSafety: number;
  /** Multiplier applied to apple and mystery-apple attraction. */
  appleWeight: number;
  /** Whether the bot avoids cells near enemy heads. */
  headAwareness: boolean;
  /** Whether the bot compensates for the Reverse effect. */
  reverseAware: boolean;
  /** Extra weight for cutting off an enemy's escape space. */
  blocking: number;
}

/** Approved difficulty tiers. */
export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: {
    decisionEvery: 3,
    randomSafe: 0.4,
    ignoreSafety: 0.12,
    appleWeight: 0.8,
    headAwareness: false,
    reverseAware: false,
    blocking: 0,
  },
  normal: {
    decisionEvery: 2,
    randomSafe: 0.15,
    ignoreSafety: 0.03,
    appleWeight: 1,
    headAwareness: true,
    reverseAware: false,
    blocking: 0,
  },
  hard: {
    decisionEvery: 1,
    randomSafe: 0.04,
    ignoreSafety: 0,
    appleWeight: 1.3,
    headAwareness: true,
    reverseAware: true,
    blocking: 0.5,
  },
  nightmare: {
    decisionEvery: 1,
    randomSafe: 0,
    ignoreSafety: 0,
    appleWeight: 1.6,
    headAwareness: true,
    reverseAware: true,
    blocking: 1,
  },
};

/** True when a bot of this tier should re-decide on this tick. */
export function shouldDecide(tick: number, difficulty: BotDifficulty): boolean {
  return tick % BOT_PROFILES[difficulty].decisionEvery === 0;
}
