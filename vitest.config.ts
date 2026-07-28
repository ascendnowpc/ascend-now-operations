import { defineConfig } from "vitest/config";

// Unit tests target the pure logic modules (no DOM, no network, no Supabase).
// Kept deliberately lightweight so `npm test` runs in a plain Node env.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
