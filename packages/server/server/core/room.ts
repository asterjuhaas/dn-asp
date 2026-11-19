import {
  BOT_PROFILES,
  PLAYER_COLORS,
  RULES,
  TIMING,
  createGame,
  createGridScratch,
  createRng,
  decideBotTurn,
  ranking,
  shouldDecide,
  stepGame,
} from "@snake/shared";
import type {
  BotDifficulty,
  Dir,
  EventEnvelope,
  GameEvent,
  GameState,
  MatchResult,
  MysteryEffect,
  Phase,
  PlayerId,
  ServerMessage,
  Standing,
} from "@snake/shared";
import { nextBotName, uniqueName } from "./sanitize";
import { roomView, snapshotView } from "./wire";

/** A player slot in a room, human or bot. */
export interface RoomPlayer {
  id: PlayerId;
  name: string;
  color: number;
  isBot: boolean;
  difficulty?: BotDifficulty;
  ready: boolean;
  connected: boolean;
  peerId?: string;
  clientId?: string;
  resumeToken: string;
  joinedAtMs: number;
  disconnectedAtMs?: number;
}

/** Services the room needs from its host process. */
export interface RoomContext {
  now(): number;
  seed(): number;
  send(peerId: string, message: ServerMessage): void;
  persistRoom(room: Room): void;
  persistSnapshot(room: Room): void;
  persistMatch(result: MatchResult): void;
  roomEmpty(room: Room): void;
}

/** A protocol error that should be returned to the client. */
export class RoomError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_EVENTS = 8;

/** One game room. Pure with respect to time: the host supplies `now()`. */
export class Room {
  readonly players = new Map<PlayerId, RoomPlayer>();
  phase: Phase = "LOBBY";
  hostId = "";
  countdownEndsAtMs?: number;
  gameOverEndsAtMs?: number;
  game: GameState | null = null;
  matchId?: string;
  matchStartedAtMs = 0;
  result: MatchResult | null = null;
  recentEvents: EventEnvelope[] = [];

  private readonly queues = new Map<PlayerId, Dir[]>();
  private readonly acks = new Map<PlayerId, number>();
  private readonly scratch = createGridScratch();
  readonly createdAtMs: number;
  private nextEventId = 1;
  private lastPersistedTick = -1;

  constructor(
    readonly code: string,
    private readonly ctx: RoomContext,
  ) {
    this.createdAtMs = ctx.now();
  }

  // -- membership ----------------------------------------------------------

  private takenNames(): Set<string> {
    return new Set([...this.players.values()].map((player) => player.name));
  }

  private nextColor(): number {
    const used = new Set([...this.players.values()].map((player) => player.color));
    return PLAYER_COLORS.find((color) => !used.has(color)) ?? PLAYER_COLORS[0]!;
  }

  private assertJoinable(): void {
    if (this.players.size >= RULES.maxPlayers) {
      throw new RoomError("ROOM_FULL", "room is full");
    }
    if (this.phase === "PLAYING") {
      throw new RoomError("ROOM_IN_PROGRESS", "match already in progress");
    }
  }

  addHuman(input: {
    id: PlayerId;
    name: string;
    clientId: string;
    resumeToken: string;
    peerId: string;
  }): RoomPlayer {
    this.assertJoinable();
    const name = uniqueName(input.name, this.takenNames());
    const player: RoomPlayer = {
      id: input.id,
      name,
      color: this.nextColor(),
      isBot: false,
      ready: false,
      connected: true,
      peerId: input.peerId,
      clientId: input.clientId,
      resumeToken: input.resumeToken,
      joinedAtMs: this.ctx.now(),
    };
    this.players.set(player.id, player);
    if (this.hostId === "") this.hostId = player.id;

    this.emit({ kind: "join", playerId: player.id, name: player.name, isBot: false });
    this.broadcastRoom();
    this.ctx.persistRoom(this);
    return player;
  }

  addBot(difficulty: BotDifficulty): RoomPlayer {
    this.assertJoinable();
    const name = nextBotName(this.takenNames());
    const player: RoomPlayer = {
      id: `b_${this.players.size}_${this.ctx.seed().toString(36)}`,
      name,
      color: this.nextColor(),
      isBot: true,
      difficulty,
      ready: true,
      connected: true,
      resumeToken: "",
      joinedAtMs: this.ctx.now(),
    };
    this.players.set(player.id, player);
    this.emit({ kind: "join", playerId: player.id, name: player.name, isBot: true });
    this.broadcastRoom();
    this.ctx.persistRoom(this);
    return player;
  }

  removeBot(playerId: PlayerId): void {
    const player = this.players.get(playerId);
    if (!player || !player.isBot) return;
    this.players.delete(playerId);
    this.emit({ kind: "leave", playerId, name: player.name });
    this.broadcastRoom();
    this.ctx.persistRoom(this);
  }

  removePlayer(playerId: PlayerId): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.players.delete(playerId);
    this.queues.delete(playerId);
    if (this.game) {
      const snake = this.game.snakes.find((candidate) => candidate.id === playerId);
      if (snake) snake.alive = false;
    }
    this.emit({ kind: "leave", playerId, name: player.name });
    if (this.hostId === playerId) this.migrateHost();
    this.broadcastRoom();
    this.ctx.persistRoom(this);
    if (this.humanCount() === 0) this.ctx.roomEmpty(this);
  }

  private migrateHost(): void {
    const humans = [...this.players.values()]
      .filter((player) => !player.isBot && player.connected)
      .sort((a, b) => a.joinedAtMs - b.joinedAtMs);
    const next = humans[0];
    this.hostId = next?.id ?? "";
    if (next) this.emit({ kind: "host", playerId: next.id });
  }

  humanCount(): number {
    return [...this.players.values()].filter((player) => !player.isBot).length;
  }

  reconnect(playerId: PlayerId, peerId: string): RoomPlayer | undefined {
    const player = this.players.get(playerId);
    if (!player) return undefined;
    player.connected = true;
    player.peerId = peerId;
    if (player.isBot) {
      player.isBot = false;
      delete player.difficulty;
      const snake = this.game?.snakes.find((candidate) => candidate.id === playerId);
      if (snake) {
        snake.isBot = false;
        delete snake.difficulty;
      }
    }
    delete player.disconnectedAtMs;
    this.emit({ kind: "reclaim", playerId, name: player.name });
    this.broadcastRoom();
    this.ctx.persistRoom(this);
    return player;
  }

  markDisconnected(playerId: PlayerId): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = false;
    player.disconnectedAtMs = this.ctx.now();
    this.broadcastRoom();
  }

  // -- lobby actions -------------------------------------------------------

  setReady(playerId: PlayerId, ready: boolean): void {
    if (this.phase !== "LOBBY") throw new RoomError("BAD_PHASE", "not in lobby");
    const player = this.players.get(playerId);
    if (!player) throw new RoomError("PROTOCOL", "not in a room");
    player.ready = ready;
    this.emit({ kind: "ready", playerId, ready });
    this.broadcastRoom();
    this.ctx.persistRoom(this);
  }

  start(playerId: PlayerId): void {
    if (this.phase !== "LOBBY") throw new RoomError("BAD_PHASE", "not in lobby");
    if (playerId !== this.hostId) throw new RoomError("NOT_HOST", "only the host can start");
    if (this.players.size < RULES.minPlayers) {
      throw new RoomError("BAD_PHASE", "need at least two players");
    }
    const unready = [...this.players.values()].filter((player) => !player.isBot && !player.ready);
    if (unready.length > 0) throw new RoomError("BAD_PHASE", "not everyone is ready");
    this.beginCountdown();
  }

  rematch(playerId: PlayerId): void {
    if (this.phase !== "GAME_OVER") throw new RoomError("BAD_PHASE", "match is not over");
    if (playerId !== this.hostId) throw new RoomError("NOT_HOST", "only the host can rematch");
    if (this.players.size < RULES.minPlayers) {
      this.resetToLobby();
      return;
    }
    this.beginCountdown();
  }

  private beginCountdown(): void {
    this.phase = "COUNTDOWN";
    this.countdownEndsAtMs = this.ctx.now() + TIMING.countdownMs;
    for (const player of this.players.values()) player.ready = true;
    this.broadcast({
      v: 1,
      t: "countdown",
      endsAtMs: this.countdownEndsAtMs,
      seconds: Math.ceil(TIMING.countdownMs / 1000),
    });
    this.broadcastRoom();
    this.ctx.persistRoom(this);
  }

  private resetToLobby(): void {
    this.phase = "LOBBY";
    this.game = null;
    this.result = null;
    delete this.matchId;
    delete this.gameOverEndsAtMs;
    delete this.countdownEndsAtMs;
    this.queues.clear();
    this.recentEvents = [];
    this.lastPersistedTick = -1;
    for (const player of this.players.values()) {
      player.ready = player.isBot;
      if (player.isBot) player.difficulty = player.difficulty ?? "normal";
    }
    this.broadcastRoom();
    this.ctx.persistRoom(this);
  }

  // -- tick ----------------------------------------------------------------

  tick(now: number): void {
    switch (this.phase) {
      case "LOBBY": {
        for (const player of [...this.players.values()]) {
          if (player.isBot || player.connected || player.disconnectedAtMs === undefined) continue;
          if (now - player.disconnectedAtMs >= 10_000) this.removePlayer(player.id);
        }
        break;
      }
      case "COUNTDOWN": {
        if (this.players.size < RULES.minPlayers) {
          this.resetToLobby();
          break;
        }
        if (this.countdownEndsAtMs !== undefined && now >= this.countdownEndsAtMs) {
          this.beginMatch(now);
        }
        break;
      }
      case "PLAYING": {
        this.tickMatch(now);
        break;
      }
      case "GAME_OVER": {
        if (this.gameOverEndsAtMs !== undefined && now >= this.gameOverEndsAtMs) {
          this.resetToLobby();
        }
        break;
      }
    }
  }

  private beginMatch(now: number): void {
    const players = [...this.players.values()];
    this.game = createGame(
      players.map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        isBot: player.isBot,
        ...(player.difficulty !== undefined ? { difficulty: player.difficulty } : {}),
      })),
      this.ctx.seed(),
    );
    this.phase = "PLAYING";
    this.matchId = `m_${now.toString(36)}_${this.code}`;
    this.matchStartedAtMs = now;
    delete this.countdownEndsAtMs;
    this.lastPersistedTick = -1;
    this.queues.clear();
    this.acks.clear();
    this.broadcastRoom();
    this.broadcastSnapshot(now);
    this.ctx.persistRoom(this);
  }

  private takeOverDisconnectedHumans(now: number): void {
    for (const player of this.players.values()) {
      if (player.isBot || player.connected || player.disconnectedAtMs === undefined) continue;
      if (now - player.disconnectedAtMs < TIMING.botTakeoverMs) continue;
      player.isBot = true;
      player.difficulty = "normal";
      const snake = this.game?.snakes.find((candidate) => candidate.id === player.id);
      if (snake) {
        snake.isBot = true;
        snake.difficulty = "normal";
      }
      this.broadcast({
        v: 1,
        t: "notice",
        level: "info",
        text: `BOT takes over ${player.name} (NORMAL).`,
      });
    }
  }

  private queueBotDecisions(): void {
    const game = this.game;
    if (!game) return;
    for (const player of this.players.values()) {
      const snake = game.snakes.find((candidate) => candidate.id === player.id);
      if (!player.isBot || !snake?.alive) continue;
      const difficulty = player.difficulty ?? "normal";
      if (!shouldDecide(game.tick, difficulty)) continue;
      const seed = (this.ctx.seed() ^ Math.imul(game.tick + 1, 2654435761)) >>> 0;
      const dir = decideBotTurn(game, player.id, difficulty, createRng(seed), this.scratch);
      if (dir) this.pushInput(player.id, dir);
    }
  }

  private tickMatch(now: number): void {
    const game = this.game;
    if (!game) return;

    this.takeOverDisconnectedHumans(now);
    this.queueBotDecisions();

    const result = stepGame(game, this.queues);
    this.queues.clear();

    this.broadcastSnapshot(now);
    for (const event of result.events) this.emit(event, game.tick, now);

    for (const event of result.events) {
      if (event.kind !== "mystery" || event.effect !== "jumpscare") continue;
      const victimId = event.targets[0];
      if (!victimId) continue;
      const victim = this.players.get(victimId);
      if (!victim?.peerId) continue;
      this.send(victim.peerId, {
        v: 1,
        t: "jumpscare",
        victimId,
        eaterId: event.playerId,
        eaterName: this.players.get(event.playerId)?.name ?? "UNKNOWN",
        durationMs: 500,
        seed: this.ctx.seed(),
      });
    }

    if (game.tick - this.lastPersistedTick >= 12) {
      this.lastPersistedTick = game.tick;
      this.ctx.persistSnapshot(this);
    }

    if (result.ended) this.finishMatch(now, result.reason ?? "last-alive");
  }

  private finishMatch(now: number, reason: MatchResult["reason"]): void {
    const game = this.game;
    if (!game) return;
    this.phase = "GAME_OVER";
    game.phase = "GAME_OVER";
    this.gameOverEndsAtMs = now + TIMING.gameOverMs;

    const ordered = ranking(game);
    const standings: Standing[] = ordered.map((snake, index) => ({
      playerId: snake.id,
      name: snake.name,
      isBot: this.players.get(snake.id)?.isBot ?? snake.isBot,
      placement: index + 1,
      score: snake.score,
      apples: snake.apples,
      kills: snake.kills,
      length: snake.body.length + snake.growth,
      alive: snake.alive,
    }));
    const winner = standings[0];
    const result: MatchResult = {
      matchId: this.matchId ?? "unknown",
      roomCode: this.code,
      startedAtMs: this.matchStartedAtMs,
      endedAtMs: now,
      durationMs: Math.max(0, now - this.matchStartedAtMs),
      reason,
      winnerId: winner?.playerId ?? "",
      standings,
    };
    this.result = result;

    this.broadcast({ v: 1, t: "gameOver", result });
    this.broadcastRoom();
    this.ctx.persistRoom(this);
    this.ctx.persistMatch(result);
  }

  private broadcastSnapshot(now: number): void {
    if (!this.game) return;
    const acks: Record<string, number> = {};
    for (const [playerId, seq] of this.acks) acks[playerId] = seq;
    const snapshot = snapshotView(this.game, acks, now);
    this.broadcast({ v: 1, t: "snapshot", snapshot });
  }

  // -- input ---------------------------------------------------------------

  pushInput(playerId: PlayerId, dir: Dir): void {
    const queue = this.queues.get(playerId) ?? [];
    queue.push(dir);
    if (queue.length > RULES.maxTurnQueue) queue.shift();
    this.queues.set(playerId, queue);
  }

  acceptInput(playerId: PlayerId, seq: number, dir: Dir): void {
    if (this.phase !== "PLAYING") throw new RoomError("BAD_PHASE", "match is not running");
    const snake = this.game?.snakes.find((candidate) => candidate.id === playerId);
    if (!snake?.alive) throw new RoomError("BAD_PHASE", "your snake is not alive");
    const last = this.acks.get(playerId) ?? 0;
    if (seq <= last) return;
    this.acks.set(playerId, seq);
    this.pushInput(playerId, dir);
    const peerId = this.players.get(playerId)?.peerId;
    if (peerId) this.send(peerId, { v: 1, t: "ack", seq });
  }

  // -- messaging -----------------------------------------------------------

  send(peerId: string, message: ServerMessage): void {
    this.ctx.send(peerId, message);
  }

  broadcast(message: ServerMessage): void {
    for (const player of this.players.values()) {
      if (player.peerId) this.ctx.send(player.peerId, message);
    }
  }

  sendRoom(playerId: PlayerId): void {
    const player = this.players.get(playerId);
    if (!player?.peerId) return;
    this.send(player.peerId, { v: 1, t: "room", room: roomView(this, playerId) });
  }

  broadcastRoom(): void {
    for (const player of this.players.values()) {
      if (!player.peerId) continue;
      this.send(player.peerId, { v: 1, t: "room", room: roomView(this, player.id) });
    }
  }

  private emit(event: GameEvent, atTick = this.game?.tick ?? 0, atMs = this.ctx.now()): void {
    const envelope: EventEnvelope = {
      id: this.nextEventId++,
      atTick,
      atMs,
      event,
    };
    this.recentEvents.push(envelope);
    if (this.recentEvents.length > MAX_EVENTS) this.recentEvents.shift();
    this.broadcast({ v: 1, t: "event", event: envelope });
  }

  // -- persistence ---------------------------------------------------------

  toRecord() {
    return {
      code: this.code,
      phase: this.phase,
      visibility: "public" as const,
      createdAt: this.createdAtMs,
      updatedAt: this.ctx.now(),
      hostId: this.hostId,
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        isBot: player.isBot,
        ...(player.difficulty !== undefined ? { difficulty: player.difficulty } : {}),
        ready: player.ready,
        connected: player.connected,
      })),
      ...(this.matchId !== undefined ? { matchId: this.matchId } : {}),
    };
  }

  toSnapshot() {
    if (!this.game) return undefined;
    return {
      roomCode: this.code,
      matchId: this.matchId ?? "unknown",
      tick: this.game.tick,
      rngState: this.game.rngState,
      phase: this.game.phase,
      savedAt: this.ctx.now(),
      snakes: this.game.snakes,
      apples: this.game.apples,
      sheds: this.game.sheds,
      remainingMs: Math.max(0, (TIMING.matchTicks - this.game.tick) * TIMING.tickMs),
    };
  }

  /** Bots count toward the player cap but never host. */
  canHost(): boolean {
    return [...this.players.values()].some((player) => !player.isBot);
  }

  /** Read-only effect counters for stats, used by match persistence. */
  effectCounts(): Record<MysteryEffect, number> {
    const counts: Record<MysteryEffect, number> = {
      jumpscare: 0,
      molt: 0,
      ghost: 0,
      reverse: 0,
      overdrive: 0,
    };
    for (const envelope of this.recentEvents) {
      if (envelope.event.kind === "mystery") counts[envelope.event.effect]++;
    }
    return counts;
  }

  /** Difficulty profiles are exported for tests and the lobby HUD. */
  static profiles = BOT_PROFILES;
}
