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
});
