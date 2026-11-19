import { defineWebSocketHandler } from "nitro";
import type { ServerMessage } from "@snake/shared";

/**
 * Phase 0 WebSocket scaffold.
 *
 * The final room protocol is implemented in later phases. For now this route
 * proves that Nitro WebSockets work locally and on Workers, and gives clients a
 * typed handshake surface.
 */
function send(peer: { send(data: string): void }, message: ServerMessage): void {
  peer.send(JSON.stringify(message));
}

export default defineWebSocketHandler({
  open(peer) {
    send(peer, {
      v: 1,
      t: "notice",
      level: "info",
      text: "snake-multi server scaffold ready",
    });
  },

  message(peer, message) {
    const text = message.text();
    if (text === "ping") {
      send(peer, {
        v: 1,
        t: "pong",
        nonce: 0,
        clientTimeMs: 0,
        serverTimeMs: Date.now(),
      });
      return;
    }

    send(peer, {
      v: 1,
      t: "error",
      code: "BAD_PHASE",
      message: "room protocol is implemented in a later phase",
      fatal: false,
    });
  },

  close() {
    // Room cleanup is added with the room registry in a later phase.
  },

  error(_peer, error) {
    console.error("[ws] error", error);
  },
});
