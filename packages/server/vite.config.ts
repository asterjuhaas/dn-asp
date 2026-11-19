import { defineConfig } from "vite-plus";
import { nitro } from "nitro/vite";

export default defineConfig({
  // Vite+ runs from the workspace root even with `-C packages/server`, and the
  // Nitro plugin takes its `rootDir` from Vite's `root`. Pin it to this package
  // so Nitro scans `packages/server/server` for routes instead of the repo root.
  root: import.meta.dirname,
  plugins: [nitro()],
  server: {
    port: 3000,
    strictPort: true,
  },
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
