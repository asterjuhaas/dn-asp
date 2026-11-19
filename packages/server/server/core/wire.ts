import { ARENA, RULES, TIMING } from "@snake/shared";
import type {
  AppleView,
  PlayerView,
  RoomConfig,
  RoomView,
  ShedView,
  SnakeView,
  Snapshot,
  Vec2,
} from "@snake/shared";
import type { GameState } from "@snake/shared";
import type { Room, RoomPlayer } from "./room";

/** Current room configuration for the wire. */
export function roomConfig(playerCount: number): RoomConfig {
  const normalApples = Math.min(6, Math.max(3, playerCount + 1));
  return {
    maxPlayers: RULES.maxPlayers,
    arena: { w: ARENA.width, h: ARENA.height },
    tickMs: TIMING.tickMs,
    matchTicks: TIMING.matchTicks,
    countdownMs: TIMING.countdownMs,
    normalApples,
    mysteryApples: playerCount >= 5 ? 2 : 1,
    maxLength: RULES.maxLength,
  };
}

function playerView(player: RoomPlayer, hostId: string): PlayerView {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    isBot: player.isBot,
    ...(player.difficulty !== undefined ? { difficulty: player.difficulty } : {}),
    ready: player.ready,
    connected: player.connected,
    host: player.id === hostId,
  };
}

/** Build the room view for one viewer. */
export function roomView(room: Room, viewerId: string): RoomView {
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    you: viewerId,
    players: [...room.players.values()].map((player) => playerView(player, room.hostId)),
    config: roomConfig(room.players.size),
    ...(room.countdownEndsAtMs !== undefined ? { countdownEndsAtMs: room.countdownEndsAtMs } : {}),
    ...(room.matchId !== undefined ? { matchId: room.matchId } : {}),
    recentEvents: room.recentEvents,
  };
}

function toTuple(x: number, y: number): Vec2 {
  return [x, y];
}

function snakeView(snake: GameState["snakes"][number]): SnakeView {
  const length = snake.body.length + snake.growth;
  return {
    id: snake.id,
    name: snake.name,
    color: snake.color,
    isBot: snake.isBot,
    body: snake.body.map((cell) => toTuple(cell.x, cell.y)),
    dir: snake.dir,
    alive: snake.alive,
    length,
    score: snake.score,
    apples: snake.apples,
    kills: snake.kills,
    effects: {
      ghostMs: snake.effects.ghost * TIMING.tickMs,
      reverseMs: snake.effects.reverse * TIMING.tickMs,
      overdriveMs: snake.effects.overdrive * TIMING.tickMs,
    },
    ...(snake.deathCause !== undefined ? { deathCause: snake.deathCause } : {}),
    ...(snake.killerId !== undefined ? { killerId: snake.killerId } : {}),
  };
}

function appleView(apple: GameState["apples"][number]): AppleView {
  return {
    id: apple.id,
    kind: apple.kind,
    x: apple.x,
    y: apple.y,
    expiresInMs: apple.ttl * TIMING.tickMs,
  };
}

function shedView(shed: GameState["sheds"][number]): ShedView {
  return {
    x: shed.x,
    y: shed.y,
    ownerId: shed.ownerId,
    expiresInMs: shed.ttl * TIMING.tickMs,
  };
}

/** Build the per-tick snapshot. */
export function snapshotView(game: GameState, acks: Record<string, number>, now: number): Snapshot {
  return {
    tick: game.tick,
    serverTimeMs: now,
    phase: game.phase,
    remainingMs: Math.max(0, (TIMING.matchTicks - game.tick) * TIMING.tickMs),
    snakes: game.snakes.map(snakeView),
    apples: game.apples.map(appleView),
    sheds: game.sheds.map(shedView),
    acks,
  };
}
