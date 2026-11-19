/**
 * Wire protocol for snake-multi.
 *
 * The protocol is JSON over WebSocket and is deliberately runtime-agnostic:
 * no Buffer, no Node streams, no platform-specific WebSocket types.
 */
import { PROTOCOL_VERSION } from "./constants";

export type ProtocolVersion = typeof PROTOCOL_VERSION;
export type PlayerId = string;
export type RoomCode = string;
export type Tick = number;
export type Dir = "up" | "down" | "left" | "right";
export type Phase = "LOBBY" | "COUNTDOWN" | "PLAYING" | "GAME_OVER";
export type BotDifficulty = "easy" | "normal" | "hard" | "nightmare";
export type MysteryEffect = "jumpscare" | "molt" | "ghost" | "reverse" | "overdrive";
export type DeathCause = "wall" | "self" | "body" | "head-on" | "shed" | "trap";

export type Vec2 = [x: number, y: number];

export interface RoomConfig {
  maxPlayers: number;
  arena: { w: number; h: number };
  tickMs: number;
  matchTicks: number;
  countdownMs: number;
  normalApples: number;
  mysteryApples: number;
  maxLength: number;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  color: number;
  isBot: boolean;
  difficulty?: BotDifficulty;
  ready: boolean;
  connected: boolean;
  host: boolean;
}

export interface RoomView {
  code: RoomCode;
  phase: Phase;
  hostId: PlayerId;
  you: PlayerId;
  players: PlayerView[];
  config: RoomConfig;
  countdownEndsAtMs?: number;
  matchId?: string;
  recentEvents: EventEnvelope[];
}

export interface SnakeView {
  id: PlayerId;
  name: string;
  color: number;
  isBot: boolean;
  body: Vec2[];
  dir: Dir;
  alive: boolean;
  length: number;
  score: number;
  apples: number;
  kills: number;
  effects: {
    ghostMs: number;
    reverseMs: number;
    overdriveMs: number;
  };
  deathCause?: DeathCause;
  killerId?: PlayerId;
}

export interface AppleView {
  id: string;
  kind: "normal" | "mystery";
  x: number;
  y: number;
  expiresInMs: number;
}

export interface ShedView {
  x: number;
  y: number;
  ownerId: PlayerId;
  expiresInMs: number;
}

export interface Snapshot {
  tick: Tick;
  serverTimeMs: number;
  phase: Phase;
  remainingMs: number;
  snakes: SnakeView[];
  apples: AppleView[];
  sheds: ShedView[];
  acks: Record<PlayerId, number>;
}

export interface Standing {
  playerId: PlayerId;
  name: string;
  isBot: boolean;
  placement: number;
  score: number;
  apples: number;
  kills: number;
  length: number;
  alive: boolean;
}

export interface MatchResult {
  matchId: string;
  roomCode: RoomCode;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  reason: "last-alive" | "time" | "mutual-destruction";
  winnerId: PlayerId;
  standings: Standing[];
}

export type GameEvent =
  | {
      kind: "apple";
      playerId: PlayerId;
      appleKind: "normal" | "mystery";
      score: number;
      growth: Array<{ playerId: PlayerId; amount: number }>;
    }
  | {
      kind: "mystery";
      playerId: PlayerId;
      effect: MysteryEffect;
      targets: PlayerId[];
      durationMs: number;
    }
  | {
      kind: "death";
      playerId: PlayerId;
      cause: DeathCause;
      killerId?: PlayerId;
    }
  | { kind: "eliminated"; playerId: PlayerId; placement: number }
  | { kind: "shed"; ownerId: PlayerId; cells: Vec2[]; expiresAtTick: Tick }
  | { kind: "join"; playerId: PlayerId; name: string; isBot: boolean }
  | { kind: "leave"; playerId: PlayerId; name: string }
  | { kind: "ready"; playerId: PlayerId; ready: boolean }
  | { kind: "host"; playerId: PlayerId }
  | { kind: "reclaim"; playerId: PlayerId; name: string };

export interface EventEnvelope {
  id: number;
  atTick: Tick;
  atMs: number;
  event: GameEvent;
}

export type ClientMessage =
  | {
      v: 1;
      t: "hello";
      clientId: string;
      name: string;
      clientVersion: string;
      resumeToken?: string;
    }
  | {
      v: 1;
      t: "createRoom";
      visibility: "public" | "private";
      practice?: { bots: number; difficulty: BotDifficulty };
    }
  | { v: 1; t: "joinRoom"; code: RoomCode }
  | { v: 1; t: "ready"; ready: boolean }
  | { v: 1; t: "start" }
  | { v: 1; t: "input"; seq: number; dir: Dir; clientTick: Tick }
  | { v: 1; t: "addBot"; difficulty: BotDifficulty }
  | { v: 1; t: "removeBot"; botId: PlayerId }
  | { v: 1; t: "rematch" }
  | { v: 1; t: "resync" }
  | { v: 1; t: "leave" }
  | { v: 1; t: "ping"; nonce: number; clientTimeMs: number };

export type ErrorCode =
  | "PROTOCOL"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_IN_PROGRESS"
  | "NAME_TAKEN"
  | "NOT_HOST"
  | "BAD_PHASE"
  | "RATE_LIMIT"
  | "SERVER_FULL"
  | "RESUME_EXPIRED";

export type KickReason = "HOST_LEFT" | "ROOM_CLOSED" | "IDLE" | "SERVER_RESTART";

export type ServerMessage =
  | {
      v: 1;
      t: "welcome";
      playerId: PlayerId;
      resumeToken: string;
      serverTimeMs: number;
      protocol: 1;
    }
  | { v: 1; t: "room"; room: RoomView }
  | { v: 1; t: "countdown"; endsAtMs: number; seconds: number }
  | { v: 1; t: "snapshot"; snapshot: Snapshot }
  | { v: 1; t: "event"; event: EventEnvelope }
  | {
      v: 1;
      t: "jumpscare";
      victimId: PlayerId;
      eaterId: PlayerId;
      eaterName: string;
      durationMs: 500;
      seed: number;
    }
  | { v: 1; t: "ack"; seq: number }
  | { v: 1; t: "gameOver"; result: MatchResult }
  | { v: 1; t: "notice"; level: "info" | "warn"; text: string }
  | {
      v: 1;
      t: "pong";
      nonce: number;
      clientTimeMs: number;
      serverTimeMs: number;
    }
  | { v: 1; t: "error"; code: ErrorCode; message: string; fatal: boolean }
  | { v: 1; t: "kicked"; reason: KickReason };
