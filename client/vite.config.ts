import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import istanbul from "vite-plugin-istanbul";

// Dev server proxies /api to the backend (Hono on @hono/node-server) so the client uses relative URLs.
const SERVER_PORT = process.env.PORT ?? "3001";

// spec: docs/specs/test-coverage.md §Behaviour.2 (e2e client coverage via an istanbul-instrumented
// build → window.__coverage__), §Behaviour.8 (instrumentation is gated behind COVERAGE=1 ONLY, so
// plain `npm run build` / `npm run dev` / `npm run test:e2e` are byte-for-byte unchanged).
const plugins: PluginOption[] = [react()];
if (process.env.COVERAGE === "1") {
  plugins.push(
    istanbul({
      include: "src/**",
      exclude: ["**/*.test.ts", "**/*.test.tsx", "node_modules"],
      extension: [".ts", ".tsx"],
      // requireEnv:false + no cypress gate so the plugin instruments whenever it is present in the
      // array (it is only pushed under COVERAGE=1) — never force-disabled by an unset extra env.
      requireEnv: false,
      // Instrument production builds too (e.g. `vite build` under COVERAGE=1); dev serve is
      // instrumented by default. Harmless when the plugin is absent (plain runs).
      forceBuildInstrument: true,
    }),
  );
}

export default defineConfig({
  plugins,
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
