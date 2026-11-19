import { defineHandler } from "nitro";
import { ARENA, LAYOUT, PROTOCOL_VERSION, RULES } from "@snake/shared";

export default defineHandler(() => ({
  ok: true,
  service: "snake-multi-server",
  protocol: PROTOCOL_VERSION,
  arena: ARENA,
  layout: LAYOUT,
  maxPlayers: RULES.maxPlayers,
  runtime: "scaffold",
}));
