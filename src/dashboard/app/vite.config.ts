import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  root: ".",
  build: {
    outDir: "../../../dist/dashboard",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:18791",
      "/ws": {
        target: "ws://localhost:18791",
        ws: true,
      },
    },
  },
});
