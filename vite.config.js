import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
  // Check if we are building specifically for GitHub Pages
  const isGithubPages = process.env.DEPLOY_TARGET === "gh-pages";

  return {
    // If GitHub Pages build, use your repo name. Otherwise, stick to Django rules.
    base: isGithubPages
      ? "/inquivesta-vite/"
      : command === "build"
        ? "/static/"
        : "/",

    build: {
      outDir: isGithubPages ? "dist-gh" : "dist", // Keep builds separated
      assetsDir: "assets",
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      proxy: { "/api": "http://127.0.0.1:8000" },
    },
  };
});
