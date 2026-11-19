import { defineConfig } from "nitro";
import type { NitroConfig } from "nitro/types";

/**
 * Nitro 3 RC resolves its conditional KV mount type (`KVMount`) to `never`
 * under tsgo even when `unstorage` is installed, because the built types
 * import the optional dependency with `@ts-ignore`.
 *
 * Keep the real mount object and cast at this single boundary so the rest of
 * the config stays checked and the runtime behaviour is unchanged.
 */
function kvMount(mount: Record<string, unknown>): NonNullable<NitroConfig["kv"]> {
  return mount as unknown as NonNullable<NitroConfig["kv"]>;
}

export default defineConfig({
  // Nitro 3 defaults `serverDir` to `false` (Nitro 2 used `server/`). Set it
  // explicitly so route scanning looks at `packages/server/server`.
  serverDir: "server",
  features: {
    websocket: true,
  },
  // Default: in-memory KV. Zero config, works on Node and Workers.
  // Local dev: persistent filesystem KV under `.data/kv`.
  // Cloudflare: replace with a KV / D1 / Durable Object binding mount.
  kv: kvMount({ default: { driver: "memory" } }),
  $development: {
    kv: kvMount({ default: { driver: "fs", base: "./.data/kv" } }),
  },
});
