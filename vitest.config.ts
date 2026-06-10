import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pin a positive-UTC-offset timezone so date helpers are exercised under the
// condition that surfaces toISOString()-based off-by-one bugs. Set before workers
// spawn so Node's Date subsystem picks it up.
process.env.TZ = "Asia/Kolkata";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: true,
  },
});
