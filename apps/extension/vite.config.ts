import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: { popup: resolve(__dirname, "popup.html"), offscreen: resolve(__dirname, "offscreen.html"), background: resolve(__dirname, "src/background.ts"), content: resolve(__dirname, "src/content.ts") },
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name].js", assetFileNames: "assets/[name][extname]" }
    }
  }
});
