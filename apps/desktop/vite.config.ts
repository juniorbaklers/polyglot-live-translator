// Configuration de compilation de l'interface principale et de la fenêtre de sous-titres.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: resolve(__dirname, "index.html"), subtitle: resolve(__dirname, "subtitle.html") } } },
  clearScreen: false,
  server: {
  port: 1420,
  strictPort: true,
  watch: {
    // Le dossier target contient les fichiers Rust compilés et verrouillés par Windows.
    // Vite ne doit donc pas essayer de surveiller leurs modifications.
    ignored: ["**/src-tauri/target/**"]
  }
},
  envPrefix: ["VITE_", "TAURI_"]
});
