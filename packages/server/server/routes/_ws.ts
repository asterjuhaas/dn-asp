import { PROTOCOL_VERSION } from "@snake/shared";
import type { ServerMessage } from "@snake/shared";
import { defineWebSocketHandler } from "nitro";
import { useKV } from "nitro/kv";
import { createTickLoop } from "../core/node-loop";
import type { KVLike } from "../core/persist";
import { GameService } from "../core/service";

/**
 * Nitro WebSocket adapter.
 *
 * All game logic lives in `../core`; this file only adapts the crossws peers
 * exposed by Nitro's `_ws.ts` route to the transport interface and drives the
 * authoritative tick.
 *
 * Runtime split:
 * - Node (local dev and Node hosting): `createTickLoop` schedules ticks from
 *   `setTimeout` with drift correction.
 * - Cloudflare Workers: no timer is installed here. The Workers adapter will
 *   drive `GameService.tickAll` from a Durable Object alarm instead, because a
 *   timer chain is not durable across hibernation. Until that adapter lands the
 *   server must run on Node.
 */

/** Minimal crossws peer surface this adapter needs. */
interface Peer {
  id: string;
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
}

interface Host {
  peers: Map<string, Peer>;
  service: GameService;
  loop: { start(): void; stop(): void } | null;
}

/** Detect the Cloudflare Workers runtime without importing any Node API. */
function isWorkers(): boolean {
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  return nav?.userAgent === "Cloudflare-Workers";
}

/**
 * The service and peer registry must outlive HMR reloads in dev, so they are
 * pinned to `globalThis` under a symbol instead of module scope. On Workers
 * this is per-isolate state; per-room Durable Objects replace it later.
 */
const HOST_KEY = Symbol.for("snake.host");

function host(): Host {
  const store = globalThis as unknown as Record<symbol, Host | undefined>;
  const existing = store[HOST_KEY];
  if (existing) return existing;

  const peers = new Map<string, Peer>();
  const service = new GameService({
    transport: {
      send(peerId, message) {
        const peer = peers.get(peerId);
        if (peer) peer.send(JSON.stringify(message));
      },
      close(peerId, code, reason) {
        const peer = peers.get(peerId);
        if (peer) peer.close(code, reason);
      },
    },
    kv: useKV() as unknown as KVLike,
    log: (message) => {
      if (service.rooms.size > 0) console.log(`[snake] ${message}`);
    },
  });

  // Node only. On Workers the authoritative clock is a Durable Object alarm.
  let loop: Host["loop"] = null;
  if (!isWorkers()) {
    const ticker = createTickLoop({
      onTick: () => service.tickAll(),
      onDrift: (lateMs) => console.warn(`[snake] tick loop resynchronised after ${lateMs}ms`),
    });
    ticker.start();
    loop = ticker;
  }

  const created: Host = { peers, service, loop };
  store[HOST_KEY] = created;
  return created;
}

function send(peer: Peer, message: ServerMessage): void {
  peer.send(JSON.stringify(message));
}

export default defineWebSocketHandler({
  open(peer) {
    const { peers, service } = host();
    peers.set(peer.id, peer);
    service.onOpen(peer.id);
    send(peer, {
      v: PROTOCOL_VERSION,
      t: "notice",
      level: "info",
      text: "snake-multi server ready",
    });
  },

  message(peer, message) {
    const { service } = host();
    const text = message.text();
    service.onMessage(peer.id, text, text.length);
  },

  close(peer) {
    const { peers, service } = host();
    service.onClose(peer.id);
    peers.delete(peer.id);
  },

  error(peer, error) {
    console.error(`[snake] ws error ${peer.id}`, error);
  },
});
