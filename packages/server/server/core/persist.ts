import type { MatchResult } from "@snake/shared";
import type { Room } from "./room";

/** Minimal key-value surface, structurally compatible with Nitro's `useKV()`. */
export interface KVLike {
  getItem<T = unknown>(key: string): Promise<T | null>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const ROOM_TTL_SECONDS = 6 * 60 * 60;
const MATCH_TTL_SECONDS = 24 * 60 * 60;

/** Persistence adapter. A null KV makes every write a no-op (pure tests). */
export class RoomStore {
  constructor(private readonly kv: KVLike | null) {}

  private write(key: string, value: unknown): void {
    if (!this.kv) return;
    void Promise.resolve(this.kv.setItem(key, value)).catch(() => {
      // Persistence is best-effort; the live room remains authoritative.
    });
  }

  saveRoom(room: Room): void {
    this.write(`room:${room.code}`, room.toRecord());
  }

  saveSnapshot(room: Room): void {
    const snapshot = room.toSnapshot();
    if (snapshot) this.write(`room:${room.code}:snapshot`, snapshot);
  }

  saveMatch(result: MatchResult): void {
    this.write(`match:${result.matchId}`, result);
  }

  deleteRoom(code: string): void {
    if (!this.kv) return;
    void Promise.resolve(this.kv.removeItem(`room:${code}`)).catch(() => {});
    void Promise.resolve(this.kv.removeItem(`room:${code}:snapshot`)).catch(() => {});
  }

  /** Constants documented for operators and Cloudflare adapters. */
  static readonly TTL = { roomSeconds: ROOM_TTL_SECONDS, matchSeconds: MATCH_TTL_SECONDS };
}
