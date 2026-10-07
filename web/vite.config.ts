import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the API runs on :3000; proxy so cookies stay same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
    },
  },
});
