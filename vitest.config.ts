import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/{contract,scenarios}/**/*.test.ts"],
    passWithNoTests: false,
  },
});
