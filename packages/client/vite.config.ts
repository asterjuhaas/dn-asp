import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: false,
    sourcemap: true,
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
