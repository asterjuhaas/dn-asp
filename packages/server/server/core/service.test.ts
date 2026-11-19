import { RULES, TIMING, createRng, rollMystery } from "@snake/shared";
import type { GameState, ServerMessage, SnakeState } from "@snake/shared";
import { describe, expect, it } from "vitest";
import { GameService, type Transport } from "./service";

interface Sent {
  peerId: string;
  message: ServerMessage;
}

function harness() {
  let clock = 1_000_000;
  const sent: Sent[] = [];
  const closed: Array<{ peerId: string; code?: number }> = [];
  const transport: Transport = {
    send(peerId, message) {
      sent.push({ peerId, message });
    },
    close(peerId, code) {
      closed.push({ peerId, ...(code !== undefined ? { code } : {}) });
    },
  };
  const service = new GameService({
    transport,
    now: () => clock,
    seed: () => 42,
    kv: null,
  });

  const advance = (ms: number) => {
    clock += ms;
  };

  const send = (peerId: string, message: unknown) => {
    service.onMessage(peerId, JSON.stringify(message));
  };

  const hello = (peerId: string, name: string, resumeToken?: string) => {
    service.onOpen(peerId);
    send(peerId, {
      v: 1,
      t: "hello",
      name,
      clientId: `client-${name}`,
      ...(resumeToken ? { resumeToken } : {}),
    });
  };

  const messages = (peerId: string, type: ServerMessage["t"]) =>
    sent.filter((entry) => entry.peerId === peerId && entry.message.t === type);

  const last = <T extends ServerMessage["t"]>(peerId: string, type: T) => {
    const list = messages(peerId, type);
    return list.at(-1)?.message as Extract<ServerMessage, { t: T }> | undefined;
  };

  const lastRoom = (peerId: string) => last(peerId, "room")?.room;

  /** Advance the clock past a countdown and run one authoritative tick. */
  const finishCountdown = () => {
    advance(TIMING.countdownMs + TIMING.tickMs);
    service.tickAll();
  };

  return {
    service,
    transport,
    sent,
    closed,
    advance,
    send,
    hello,
    messages,
    last,
    lastRoom,
    finishCountdown,
    tick: () => service.tickAll(),
  };
}

function welcomeOf(h: ReturnType<typeof harness>, peerId: string) {
  return h.last(peerId, "welcome");
}

describe("handshake", () => {
  it("welcomes a fresh peer with a player id, resume token and protocol", () => {
    const h = harness();
    h.service.onOpen("peer-a");
    h.send("peer-a", { v: 1, t: "hello", name: "aster", clientId: "c1" });
    const welcome = welcomeOf(h, "peer-a");
    expect(welcome).toBeDefined();
    expect(welcome?.playerId).toMatch(/^p_/);
    expect(welcome?.resumeToken).toHaveLength(24);
    expect(welcome?.protocol).toBe(1);
  });

  it("rejects malformed frames without crashing", () => {
    const h = harness();
    h.service.onOpen("peer-a");
    h.service.onMessage("peer-a", "{not json");
    expect(h.last("peer-a", "error")?.code).toBe("PROTOCOL");
  });

  it("rejects frames over the size limit", () => {
    const h = harness();
    h.service.onOpen("peer-a");
    h.service.onMessage("peer-a", "x".repeat(5000), 5000);
    expect(h.last("peer-a", "error")?.fatal).toBe(true);
  });

  it("rate limits a chatty peer", () => {
    const h = harness();
    h.service.onOpen("peer-a");
    for (let i = 0; i < 61; i++) {
      h.send("peer-a", { v: 1, t: "ping", nonce: i, clientTimeMs: 0 });
    }
    expect(
      h
        .messages("peer-a", "error")
        .some((m) => m.message.t === "error" && m.message.code === "RATE_LIMIT"),
    ).toBe(true);
  });
});

describe("lobby", () => {
  it("creates a room and makes the creator the host", () => {
    const h = harness();
    h.hello("peer-a", "ASTER");
    h.send("peer-a", { v: 1, t: "createRoom" });
    const room = h.lastRoom("peer-a");
    expect(room).toBeDefined();
    expect(room?.phase).toBe("LOBBY");
    expect(room?.hostId).toBe(room?.you);
    expect(room?.code).toMatch(/^[0-9A-Z]{5}$/);
    expect(room?.players).toHaveLength(1);
  });

  it("joins a room by code and shows both players", () => {
    const h = harness();
    h.hello("peer-a", "ASTER");
    h.send("peer-a", { v: 1, t: "createRoom" });
    const code = h.lastRoom("peer-a")!.code;

    h.hello("peer-b", "BORIS");
    h.send("peer-b", { v: 1, t: "joinRoom", code });

    const room = h.lastRoom("peer-b");
    expect(room?.players).toHaveLength(2);
    expect(room?.players.map((p) => p.name).sort()).toEqual(["ASTER", "BORIS"]);
    expect(room?.players.find((p) => p.id === room.you)?.host).toBe(false);
  });

  it("rejects a join to a missing room", () => {
    const h = harness();
    h.hello("peer-a", "ASTER");
    h.send("peer-a", { v: 1, t: "joinRoom", code: "ZZZZZ" });
    expect(h.last("peer-a", "error")?.code).toBe("ROOM_NOT_FOUND");
  });

  it("refuses to start below the minimum player count", () => {
    const h = harness();
    h.hello("peer-a", "ASTER");
    h.send("peer-a", { v: 1, t: "createRoom" });
    h.send("peer-a", { v: 1, t: "ready", ready: true });
    h.send("peer-a", { v: 1, t: "start" });
    expect(h.last("peer-a", "error")?.message).toMatch(/two players/);
  });

  it("refuses to start until every human is ready", () => {
    const h = harness();
    h.hello("peer-a", "ASTER");
    h.send("peer-a", { v: 1, t: "createRoom" });
    const code = h.lastRoom("peer-a")!.code;
    h.hello("peer-b", "BORIS");
    h.send("peer-b", { v: 1, t: "joinRoom", code });

    h.send("peer-a", { v: 1, t: "ready", ready: true });
    h.send("peer-a", { v: 1, t: "start" });
    expect(h.last("peer-a", "error")?.message).toMatch(/ready/);
  });

  it("only lets the host start", () => {
    const h = harness();
    const code = setupTwoPlayers(h);
    h.send("peer-b", { v: 1, t: "ready", ready: true });
    h.send("peer-a", { v: 1, t: "ready", ready: true });
    h.send("peer-b", { v: 1, t: "start" });
    expect(h.last("peer-b", "error")?.code).toBe("NOT_HOST");
    expect(h.lastRoom("peer-a")?.code).toBe(code);
  });

  it("adds and removes bots as host only", () => {
    const h = harness();
    h.hello("peer-a", "ASTER");
    h.send("peer-a", { v: 1, t: "createRoom" });
    h.send("peer-a", { v: 1, t: "addBot", difficulty: "hard" });
    const withBot = h.lastRoom("peer-a")!;
    const bot = withBot.players.find((p) => p.isBot);
    expect(bot).toBeDefined();
    expect(bot?.name.startsWith("BOT-")).toBe(true);
    expect(bot?.difficulty).toBe("hard");

    h.send("peer-a", { v: 1, t: "removeBot", botId: bot!.id });
    expect(h.lastRoom("peer-a")!.players.some((p) => p.isBot)).toBe(false);
  });

  it("denies bot management to a non-host", () => {
    const h = harness();
    setupTwoPlayers(h);
    h.send("peer-b", { v: 1, t: "addBot", difficulty: "easy" });
    expect(h.last("peer-b", "error")?.code).toBe("NOT_HOST");
  });
});

describe("countdown and play", () => {
  it("enters countdown, then starts the match on the next tick", () => {
    const h = harness();
    setupTwoPlayers(h);
    h.send("peer-a", { v: 1, t: "ready", ready: true });
    h.send("peer-b", { v: 1, t: "ready", ready: true });
    h.send("peer-a", { v: 1, t: "start" });

    expect(h.lastRoom("peer-a")?.phase).toBe("COUNTDOWN");
    expect(h.last("peer-a", "countdown")?.seconds).toBe(3);

    h.finishCountdown();
    expect(h.lastRoom("peer-a")?.phase).toBe("PLAYING");
    expect(h.last("peer-a", "snapshot")?.snapshot.snakes).toHaveLength(2);
  });

  it("acks inputs and moves the snake", () => {
    const h = harness();
    h.hello("peer-a", "ASTER");
    h.send("peer-a", { v: 1, t: "createRoom", practice: { bots: 1, difficulty: "normal" } });
    h.finishCountdown();

    h.send("peer-a", { v: 1, t: "input", seq: 1, dir: "down" });
    expect(h.last("peer-a", "ack")?.seq).toBe(1);

    const before = h.last("peer-a", "snapshot")!.snapshot.snakes.find((s) => !s.isBot)!.body[0]!;
    h.advance(TIMING.tickMs);
    h.tick();
    const after = h.last("peer-a", "snapshot")!.snapshot.snakes.find((s) => !s.isBot)!.body[0]!;
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1] + 1);
  });

  it("ignores a replayed input sequence", () => {
    const h = harness();
    h.hello("peer-a", "ASTER");
    h.send("peer-a", { v: 1, t: "createRoom", practice: { bots: 1, difficulty: "normal" } });
    h.finishCountdown();
    h.send("peer-a", { v: 1, t: "input", seq: 3, dir: "up" });
    h.send("peer-a", { v: 1, t: "input", seq: 2, dir: "down" });
    const acks = h.messages("peer-a", "ack");
    expect(acks).toHaveLength(1);
    expect((acks[0]!.message as { seq: number }).seq).toBe(3);
  });

  it("times out a match that reaches the tick limit", () => {
    const h = harness();
    h.hello("peer-a", "ASTER");
    h.send("peer-a", { v: 1, t: "createRoom", practice: { bots: 1, difficulty: "normal" } });
    h.finishCountdown();

    const room = [...h.service.rooms.values()][0]!;
    room.game!.tick = TIMING.matchTicks - 1;
    h.advance(TIMING.tickMs);
    h.tick();

    const over = h.last("peer-a", "gameOver")?.result;
    expect(over?.reason).toBe("time");
    expect(h.lastRoom("peer-a")?.phase).toBe("GAME_OVER");
  });

  it("ends the match when every rival dies and announces standings", () => {
    const h = harness();
    setupTwoPlayers(h);
    h.send("peer-a", { v: 1, t: "ready", ready: true });
    h.send("peer-b", { v: 1, t: "ready", ready: true });
    h.send("peer-a", { v: 1, t: "start" });
    h.finishCountdown();

    // Kill one side outright; the next tick sees a single survivor.
    const room = [...h.service.rooms.values()][0]!;
    const snakes = room.game!.snakes;
    snakes[1]!.alive = false;

    h.advance(TIMING.tickMs);
    h.tick();

    const result = h.last("peer-a", "gameOver")?.result;
    expect(result).toBeDefined();
    expect(result?.standings).toHaveLength(2);
    expect(result?.winnerId).toBe(snakes[0]!.id);
  });
});

describe("reconnect and host migration", () => {
  it("reclaims a seat with the resume token", () => {
    const h = harness();
    h.hello("peer-a", "ASTER");
    h.send("peer-a", { v: 1, t: "createRoom" });
    const original = welcomeOf(h, "peer-a");
    const code = h.lastRoom("peer-a")!.code;

    h.service.onClose("peer-a");

    h.service.onOpen("peer-a2");
    h.send("peer-a2", {
      v: 1,
      t: "hello",
      name: "ASTER",
      clientId: "c1",
      resumeToken: original!.resumeToken,
    });

    const welcome = welcomeOf(h, "peer-a2");
    expect(welcome?.playerId).toBe(original?.playerId);
    expect(h.lastRoom("peer-a2")?.code).toBe(code);
    expect(h.lastRoom("peer-a2")?.players.find((p) => p.id === original!.playerId)?.connected).toBe(
      true,
    );
  });

  it("migrates host to the next human when the host leaves", () => {
    const h = harness();
    const code = setupTwoPlayers(h);
    h.send("peer-a", { v: 1, t: "leave" });

    const room = h.lastRoom("peer-b");
    expect(room?.code).toBe(code);
    expect(room?.players).toHaveLength(1);
    expect(room?.players[0]?.id).toBe(room?.you);
    expect(room?.players[0]?.host).toBe(true);
  });

  it("hands a disconnected human to a bot after the takeover delay", () => {
    const h = harness();
    h.hello("peer-a", "ASTER");
    h.send("peer-a", { v: 1, t: "createRoom", practice: { bots: 1, difficulty: "easy" } });
    h.finishCountdown();

    h.service.onClose("peer-a");
    h.advance(TIMING.botTakeoverMs + TIMING.tickMs);
    h.tick();

    const room = [...h.service.rooms.values()][0]!;
    const human = [...room.players.values()].find((p) => p.name === "ASTER");
    expect(human?.isBot).toBe(true);
  });
});

describe("jumpscare routing", () => {
  it("sends the jumpscare message only to the targeted victim", () => {
    const h = harness();
    setupTwoPlayers(h);
    h.send("peer-a", { v: 1, t: "ready", ready: true });
    h.send("peer-b", { v: 1, t: "ready", ready: true });
    h.send("peer-a", { v: 1, t: "start" });
    h.finishCountdown();

    const room = [...h.service.rooms.values()][0]!;
    const players = [...room.players.values()];
    const eaterId = players[0]!.id;
    const victimId = players[1]!.id;

    // Build a tiny board: the eater is about to step onto a mystery apple,
    // the victim is close and eligible.
    const eater = room.game!.snakes.find((s) => s.id === eaterId)!;
    const victim = room.game!.snakes.find((s) => s.id === victimId)!;
    placeSnake(eater, 10, 10, "right");
    placeSnake(victim, 20, 10, "left");
    victim.jumpscareCooldown = 0;
    room.game!.apples = [
      { id: "mystery", kind: "mystery", x: 11, y: 10, ttl: RULES.mysteryAppleTtlTicks },
    ];
    room.game!.sheds = [];

    const seed = findJumpscareSeed(room.game!, eater);
    room.game!.rngState = seed;

    h.advance(TIMING.tickMs);
    h.tick();

    const victimScares = h.messages(players[1]!.peerId!, "jumpscare");
    const eaterScares = h.messages(players[0]!.peerId!, "jumpscare");
    expect(victimScares).toHaveLength(1);
    expect(eaterScares).toHaveLength(0);
    expect((victimScares[0]!.message as { victimId: string }).victimId).toBe(victimId);
  });
});

// -- helpers ---------------------------------------------------------------

function setupTwoPlayers(h: ReturnType<typeof harness>): string {
  h.hello("peer-a", "ASTER");
  h.send("peer-a", { v: 1, t: "createRoom" });
  const code = h.lastRoom("peer-a")!.code;
  h.hello("peer-b", "BORIS");
  h.send("peer-b", { v: 1, t: "joinRoom", code });
  return code;
}

function placeSnake(snake: SnakeState, x: number, y: number, dir: SnakeState["dir"]): void {
  const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  snake.dir = dir;
  snake.alive = true;
  snake.body = Array.from({ length: 4 }, (_, i) => ({
    x: x - delta[0]! * i,
    y: y - delta[1]! * i,
  }));
}

function findJumpscareSeed(state: GameState, eater: SnakeState): number {
  for (let seed = 1; seed < 5000; seed++) {
    if (rollMystery(state, eater, createRng(seed)).effect === "jumpscare") return seed;
  }
  throw new Error("no jumpscare seed found");
}
