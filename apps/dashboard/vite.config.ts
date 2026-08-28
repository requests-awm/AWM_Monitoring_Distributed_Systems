import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The workspace-root .env is read here for the dev proxy target ONLY. Values
// loaded this way stay in the config process — Vite exposes nothing to the
// browser bundle unless it is prefixed VITE_, and secrets must never be.
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, resolve(__dirname, "../.."), "AWM_");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": process.env.AWM_API_TARGET ?? rootEnv.AWM_API_TARGET ?? "http://localhost:3000",
      },
    },
  };
});
