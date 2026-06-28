import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Binds to all network interfaces, not just localhost -- a phone scanning a tracking
    // QR needs to reach this dev server over the local WiFi (see CLIENT_ORIGIN in
    // apps/server/.env and TESTING_GUIDE.md for the matching backend-side step).
    host: true,
    proxy: {
      "/api": "http://localhost:4000",
      "/uploads": "http://localhost:4000",
      "/socket.io": { target: "http://localhost:4000", ws: true },
    },
  },
});
