import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/{contract,scenarios,runtime}/**/*.test.ts"],
    passWithNoTests: false,
  },
});
