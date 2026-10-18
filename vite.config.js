import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // In production Django serves the build under STATIC_URL ("/static/").
  // In dev, Vite serves from "/" and forwards API calls to Django.
  base: command === "build" ? "/static/" : "/",
  build: { outDir: "dist", assetsDir: "assets", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
}));
