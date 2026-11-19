/** Bot callsign bases. Names are prefixed so a bot can never impersonate a human. */
export const BOT_NAMES = ["ASH", "KRAIT", "MOON", "NULL", "OTTER", "VIPER"] as const;

/** Build a bot callsign, e.g. `BOT-VIPER-07`. */
export function botName(index: number): string {
  const base = BOT_NAMES[index % BOT_NAMES.length]!;
  const suffix = String((index * 7) % 100).padStart(2, "0");
  return `BOT-${base}-${suffix}`;
}

/** True when a callsign is a bot name. */
export function isBotName(name: string): boolean {
  return name.startsWith("BOT-");
}
