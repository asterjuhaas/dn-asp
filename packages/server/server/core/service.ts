import { PROTOCOL_VERSION } from "@snake/shared";
import type {
  BotDifficulty,
  ClientMessage,
  Dir,
  ErrorCode,
  MatchResult,
  ServerMessage,
} from "@snake/shared";
import { RoomStore, type KVLike } from "./persist";
import { Room, RoomError, type RoomContext, type RoomPlayer } from "./room";
import { playerId, resumeToken, roomCode, sanitizeName } from "./sanitize";
import { roomView, snapshotView } from "./wire";

/** Transport implemented by the Nitro WebSocket adapter (or a test harness). */
export interface Transport {
  send(peerId: string, message: ServerMessage): void;
  close(peerId: string, code?: number, reason?: string): void;
}

export interface GameServiceOptions {
  transport: Transport;
  kv?: KVLike | null;
  now?: () => number;
  seed?: () => number;
  log?: (message: string) => void;
}

interface Session {
  peerId: string;
  playerId: string;
  name: string;
  clientId: string;
  resumeToken: string;
  roomCode?: string;
  lastSeq: number;
  windowStartMs: number;
  windowCount: number;
}

const MAX_MESSAGES_PER_SECOND = 60;
const MAX_FRAME_BYTES = 4096;
const EMPTY_ROOM_RETENTION_MS = 5 * 60 * 1000;

/**
 * In-process room registry and protocol dispatcher.
 *
 * The service has no timers. A host adapter (Node loop or Cloudflare Durable
 * Object alarm) calls {@link tickAll} on the authoritative cadence. That keeps
 * the same code path on both runtimes.
 */
export class GameService {
  readonly rooms = new Map<string, Room>();
  readonly sessions = new Map<string, Session>();

  private readonly store: RoomStore;
  private readonly now: () => number;
  private readonly seed: () => number;
  private readonly log: (message: string) => void;
  private readonly emptySince = new Map<string, number>();
  private nextSeed: number;

  constructor(private readonly options: GameServiceOptions) {
    this.store = new RoomStore(options.kv ?? null);
    this.now = options.now ?? (() => Date.now());
    this.nextSeed =
      (options.seed ?? (() => (Math.random() * 0xffffffff) >>> 0))() >>> 0 || 0x9e3779b9;
    this.seed = () => {
      this.nextSeed = (Math.imul(this.nextSeed, 1664525) + 1013904223) >>> 0;
      return this.nextSeed;
    };
    this.log = options.log ?? (() => {});
  }

  // -- connection lifecycle ------------------------------------------------

  onOpen(peerId: string): void {
    const id = playerId(this.seed());
    this.sessions.set(peerId, {
      peerId,
      playerId: id,
      name: "",
      clientId: "",
      resumeToken: resumeToken(this.seed()),
      lastSeq: 0,
      windowStartMs: this.now(),
      windowCount: 0,
    });
  }

  onClose(peerId: string): void {
    const session = this.sessions.get(peerId);
    if (!session) return;
    const room = this.roomOf(session);
    if (room) room.markDisconnected(session.playerId);
    this.sessions.delete(peerId);
  }

  onMessage(peerId: string, raw: string, bytes = raw.length): void {
    const session = this.sessions.get(peerId);
    if (!session) return;

    if (bytes > MAX_FRAME_BYTES) {
      this.error(session, "PROTOCOL", "frame too large", true);
      return;
    }
    if (!this.allow(session)) {
      this.error(session, "RATE_LIMIT", "too many messages", false);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.error(session, "PROTOCOL", "invalid JSON", false);
      return;
    }
    if (!isClientMessage(parsed)) {
      this.error(session, "PROTOCOL", "unknown message", false);
      return;
    }

    try {
      this.dispatch(session, parsed);
    } catch (error) {
      if (error instanceof RoomError) {
        this.error(session, toErrorCode(error.code), error.message, false);
        return;
      }
      this.log(`dispatch failed: ${String(error)}`);
      this.error(session, "PROTOCOL", "internal error", false);
    }
  }

  private allow(session: Session): boolean {
    const now = this.now();
    if (now - session.windowStartMs >= 1000) {
      session.windowStartMs = now;
      session.windowCount = 0;
    }
    session.windowCount++;
    return session.windowCount <= MAX_MESSAGES_PER_SECOND;
  }

  // -- dispatch ------------------------------------------------------------

  private dispatch(session: Session, message: ClientMessage): void {
    switch (message.t) {
      case "hello":
        this.hello(session, message);
        return;
      case "createRoom":
        this.createRoom(session, message.practice);
        return;
      case "joinRoom":
        this.joinRoom(session, message.code);
        return;
      case "ready":
        this.requireRoom(session).setReady(session.playerId, message.ready);
        return;
      case "start":
        this.requireRoom(session).start(session.playerId);
        return;
      case "addBot":
        this.requireHost(session).addBot(message.difficulty);
        return;
      case "removeBot":
        this.requireHost(session).removeBot(message.botId);
        return;
      case "rematch":
        this.requireRoom(session).rematch(session.playerId);
        return;
      case "input":
        this.input(session, message.seq, message.dir);
        return;
      case "resync": {
        const room = this.requireRoom(session);
        if (room.game) {
          const acks: Record<string, number> = {};
          this.send(session.peerId, {
            v: 1,
            t: "snapshot",
            snapshot: snapshotView(room.game, acks, this.now()),
          });
        }
        return;
      }
      case "leave":
        this.leave(session);
        return;
      case "ping":
        this.send(session.peerId, {
          v: 1,
          t: "pong",
          nonce: message.nonce,
          clientTimeMs: message.clientTimeMs,
          serverTimeMs: this.now(),
        });
        return;
    }
  }

  private hello(session: Session, message: Extract<ClientMessage, { t: "hello" }>): void {
    session.name = sanitizeName(message.name);
    session.clientId = String(message.clientId).slice(0, 64);

    if (message.resumeToken) {
      const found = this.findByResumeToken(message.resumeToken);
      if (found) {
        session.playerId = found.player.id;
        session.resumeToken = found.player.resumeToken;
        session.roomCode = found.room.code;
        found.room.reconnect(found.player.id, session.peerId);
        this.send(session.peerId, {
          v: 1,
          t: "welcome",
          playerId: session.playerId,
          resumeToken: session.resumeToken,
          serverTimeMs: this.now(),
          protocol: PROTOCOL_VERSION,
        });
        found.room.sendRoom(found.player.id);
        if (found.room.game) {
          this.send(session.peerId, {
            v: 1,
            t: "snapshot",
            snapshot: snapshotView(found.room.game, {}, this.now()),
          });
        }
        return;
      }
    }

    this.send(session.peerId, {
      v: 1,
      t: "welcome",
      playerId: session.playerId,
      resumeToken: session.resumeToken,
      serverTimeMs: this.now(),
      protocol: PROTOCOL_VERSION,
    });
  }

  private createRoom(
    session: Session,
    practice?: { bots: number; difficulty: BotDifficulty },
  ): void {
    if (session.roomCode) {
      const existing = this.rooms.get(session.roomCode);
      if (existing) {
        existing.sendRoom(session.playerId);
        return;
      }
    }
    const code = roomCode(this.seed(), new Set(this.rooms.keys()));
    const room = new Room(code, this.roomContext());
    this.rooms.set(code, room);
    room.addHuman({
      id: session.playerId,
      name: session.name || "PLAYER",
      clientId: session.clientId,
      resumeToken: session.resumeToken,
      peerId: session.peerId,
    });
    session.roomCode = code;
    room.sendRoom(session.playerId);

    if (practice) {
      const bots = Math.max(0, Math.min(5, practice.bots));
      for (let i = 0; i < bots; i++) room.addBot(practice.difficulty);
      room.setReady(session.playerId, true);
      room.start(session.playerId);
    }
  }

  private joinRoom(session: Session, code: string): void {
    if (session.roomCode !== undefined) {
      const current = this.rooms.get(session.roomCode);
      if (current) throw new RoomError("BAD_PHASE", "leave the current room first");
    }
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new RoomError("ROOM_NOT_FOUND", "no such room");
    const player = room.addHuman({
      id: session.playerId,
      name: session.name || "PLAYER",
      clientId: session.clientId,
      resumeToken: session.resumeToken,
      peerId: session.peerId,
    });
    session.roomCode = room.code;
    room.sendRoom(player.id);
  }

  private leave(session: Session): void {
    const room = this.roomOf(session);
    if (!room) return;
    room.removePlayer(session.playerId);
    delete session.roomCode;
    this.send(session.peerId, {
      v: 1,
      t: "notice",
      level: "info",
      text: "You left the room.",
    });
  }

  private input(session: Session, seq: number, dir: Dir): void {
    const room = this.requireRoom(session);
    if (!Number.isInteger(seq) || seq <= session.lastSeq) return;
    session.lastSeq = seq;
    room.acceptInput(session.playerId, seq, dir);
  }

  // -- tick ----------------------------------------------------------------

  /** Advance every room. Call every tick interval from the host adapter. */
  tickAll(now = this.now()): void {
    for (const room of [...this.rooms.values()]) {
      room.tick(now);
      this.collectEmpty(room, now);
    }
  }

  private collectEmpty(room: Room, now: number): void {
    if (room.players.size === 0) {
      this.deleteRoom(room);
      return;
    }
    if (room.humanCount() > 0) {
      this.emptySince.delete(room.code);
      return;
    }
    const since = this.emptySince.get(room.code);
    if (since === undefined) {
      this.emptySince.set(room.code, now);
      return;
    }
    if (now - since >= EMPTY_ROOM_RETENTION_MS) this.deleteRoom(room);
  }

  private deleteRoom(room: Room): void {
    this.rooms.delete(room.code);
    this.emptySince.delete(room.code);
    this.store.deleteRoom(room.code);
  }

  // -- helpers -------------------------------------------------------------

  private roomContext(): RoomContext {
    return {
      now: () => this.now(),
      seed: () => this.seed(),
      send: (peerId, message) => this.send(peerId, message),
      persistRoom: (room) => this.store.saveRoom(room),
      persistSnapshot: (room) => this.store.saveSnapshot(room),
      persistMatch: (result: MatchResult) => this.store.saveMatch(result),
      roomEmpty: (room) => this.emptySince.set(room.code, this.now()),
    };
  }

  private roomOf(session: Session): Room | undefined {
    if (!session.roomCode) return undefined;
    return this.rooms.get(session.roomCode);
  }

  private requireRoom(session: Session): Room {
    const room = this.roomOf(session);
    if (!room) throw new RoomError("BAD_PHASE", "not in a room");
    return room;
  }

  private requireHost(session: Session): Room {
    const room = this.requireRoom(session);
    if (room.hostId !== session.playerId) {
      throw new RoomError("NOT_HOST", "only the host can do that");
    }
    return room;
  }

  private findByResumeToken(token: string): { room: Room; player: RoomPlayer } | undefined {
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (player.resumeToken === token) return { room, player };
      }
    }
    return undefined;
  }

  private send(peerId: string, message: ServerMessage): void {
    this.options.transport.send(peerId, message);
  }

  private error(session: Session, code: ErrorCode, message: string, fatal: boolean): void {
    this.send(session.peerId, { v: 1, t: "error", code, message, fatal });
  }
}

function toErrorCode(code: string): ErrorCode {
  const allowed: ErrorCode[] = [
    "PROTOCOL",
    "ROOM_NOT_FOUND",
    "ROOM_FULL",
    "ROOM_IN_PROGRESS",
    "NAME_TAKEN",
    "NOT_HOST",
    "BAD_PHASE",
    "RATE_LIMIT",
    "SERVER_FULL",
    "RESUME_EXPIRED",
  ];
  return allowed.includes(code as ErrorCode) ? (code as ErrorCode) : "PROTOCOL";
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.v !== PROTOCOL_VERSION) return false;
  return typeof record.t === "string";
}

/** Re-export the room view helper for adapters and tests. */
export { roomView };
