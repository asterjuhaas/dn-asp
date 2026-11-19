import { BOT_NAMES, botName } from "@snake/shared";

/** Normalise a human callsign: uppercase A-Z 0-9 _ -, 2 to 12 chars. */
export function sanitizeName(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 12);
  return cleaned.length >= 2 ? cleaned : "PLAYER";
}

/** Make a name unique inside a room by appending #2, #3, ... */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${name.slice(0, 10)}#${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${name.slice(0, 8)}#99`;
}

/** Choose the next bot callsign and make it unique. */
export function nextBotName(taken: ReadonlySet<string>): string {
  for (let index = 0; index < BOT_NAMES.length * 20; index++) {
    const candidate = botName(index);
    if (!taken.has(candidate)) return candidate;
  }
  return botName(Math.floor(Math.random() * 1000));
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Generate a 5-character room code from a numeric seed. */
export function roomCode(seed: number, taken: ReadonlySet<string>): string {
  let state = seed >>> 0 || 1;
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = "";
    for (let i = 0; i < 5; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      code += CROCKFORD[state % CROCKFORD.length];
    }
    if (!taken.has(code)) return code;
  }
  return `X${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

/** Generate a resume token. Uses the platform crypto when available. */
export function resumeToken(seed: number): string {
  let state = seed >>> 0 || 1;
  let token = "";
  for (let i = 0; i < 24; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    token += CROCKFORD[state % CROCKFORD.length];
  }
  return token;
}

/** Generate a stable-looking player id. */
export function playerId(seed: number): string {
  let state = seed >>> 0 || 1;
  let id = "p_";
  for (let i = 0; i < 8; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    id += CROCKFORD[state % CROCKFORD.length];
  }
  return id;
}
