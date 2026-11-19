import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    plugins: ["typescript"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ["packages/server/**"],
        env: { node: true },
        rules: {
          "no-console": "off",
        },
      },
      {
        files: ["packages/client/**"],
        env: { node: true },
      },
      {
        files: ["**/*.test.ts"],
        rules: {
          "typescript/no-explicit-any": "off",
        },
      },
    ],
  },
  fmt: {},
});
