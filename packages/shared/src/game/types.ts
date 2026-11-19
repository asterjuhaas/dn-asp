import type { BotDifficulty, DeathCause, Dir, GameEvent, Phase, PlayerId } from "../protocol";

/** A cell in arena coordinates. Origin is the top-left inner cell. */
export interface Point {
  x: number;
  y: number;
}

/** Anything that can submit a direction this tick. */
export type InputMap = ReadonlyMap<PlayerId, readonly Dir[]>;

/** Per-player effect countdowns, in ticks. Zero means inactive. */
export interface EffectTimers {
  ghost: number;
  reverse: number;
  overdrive: number;
}

/** A living or dead snake. `body` is head first. */
export interface SnakeState {
  id: PlayerId;
  name: string;
  color: number;
  isBot: boolean;
  difficulty?: BotDifficulty;
  body: Point[];
  dir: Dir;
  alive: boolean;
  score: number;
  apples: number;
  kills: number;
  /** Queued growth segments that have not been applied yet. */
  growth: number;
  effects: EffectTimers;
  /** Remaining ticks of jumpscare immunity, so one victim cannot be chain-scared. */
  jumpscareCooldown: number;
  /** Overdrive movement credits. Two credits buy one extra step. */
  overdriveCredits: number;
  /** Ticks of Ghost extension after failing to eject from a solid cell. */
  ejectionTicks: number;
  deathCause?: DeathCause;
  killerId?: PlayerId;
}

/** A normal or mystery apple. Mystery identity is rolled only on consumption. */
export interface AppleState {
  id: string;
  kind: "normal" | "mystery";
  x: number;
  y: number;
  /** Ticks until the apple expires and respawns. */
  ttl: number;
}

/** A solid wall cell created by Molt. */
export interface ShedState {
  x: number;
  y: number;
  ownerId: PlayerId;
  /** Ticks until the shed expires. */
  ttl: number;
  /** Ticks during which the owner may pass through this shed cell. */
  ownerGrace: number;
}

/** The complete authoritative match state. Serialisable and runtime-agnostic. */
export interface GameState {
  tick: number;
  phase: Phase;
  seed: number;
  /** Mutable PRNG state; stepGame advances it deterministically. */
  rngState: number;
  snakes: SnakeState[];
  apples: AppleState[];
  sheds: ShedState[];
  nextAppleId: number;
  nextEventId: number;
  /** Last tick at which each snake consumed a mystery apple. */
  lastMysteryTick: Record<PlayerId, number>;
}

/** The outcome of one authoritative tick. */
export interface StepResult {
  state: GameState;
  events: GameEvent[];
  /** True when the match should leave PLAYING. */
  ended: boolean;
  reason?: "last-alive" | "time" | "mutual-destruction";
}

/** A read-only view exported for tests and the bot brain. */
export type ReadonlyGameState = Readonly<GameState>;
