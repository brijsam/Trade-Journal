import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  base: "./",
  // electron:dev waits on tcp:5173, so that stays the default when PORT is unset.
  server: {
    port: Number(process.env.PORT) || 5173,
  },
  // Single source of truth for the version shown in Settings > About. It used to
  // be typed into App.jsx by hand, which drifted from package.json (the About
  // panel still read 2.1 while the installer built 2.1.0); injecting it here
  // means the bump in package.json is the only edit a release needs.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Coverage is scoped to src/lib/** — the pure-logic layer, where coverage
  // is both meaningful and achievable. App.tsx/Charts.tsx are UI-heavy React
  // trees already covered by component/integration tests, not a place a
  // blanket line-coverage threshold says anything useful. storage.ts is
  // reported but excluded from the threshold itself: unlike trade.ts/auth.ts
  // (explicitly "no storage" per CLAUDE.md), it *is* the storage/IPC
  // boundary — thin pass-through to IndexedDB / window.electronStorage that
  // unit tests can't meaningfully exercise without reimplementing a fake
  // IndexedDB, and it's already covered end-to-end via the mocked backend in
  // App.integration.test.jsx.
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/lib/**"],
      exclude: ["src/lib/**/*.test.*", "src/lib/storage.ts"],
      thresholds: {
        lines: 90,
        functions: 85,
        branches: 85,
        statements: 90,
      },
    },
  },
});
