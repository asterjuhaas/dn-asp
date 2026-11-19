import { defineConfig } from "vite-plus";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [nitro()],
  server: {
    port: 3000,
    strictPort: true,
  },
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
