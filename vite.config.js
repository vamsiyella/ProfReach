import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync, existsSync } from "fs";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        popup:      resolve(__dirname, "src/popup/popup.html"),
        background: resolve(__dirname, "src/background/background.js"),
        content:    resolve(__dirname, "src/content/content.js"),
        offscreen:  resolve(__dirname, "src/offscreen/offscreen.js"),   // ← ADD THIS
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "[name].[ext]",
        format: "esm",
      },
    },
    chunkSizeWarningLimit: 10000,
    target: "esnext",
  },

  plugins: [
    {
      name: "copy-extension-assets",
      closeBundle() {
        // Manifest
        copyFileSync("public/manifest.json", "dist/manifest.json");
        copyFileSync("public/offscreen.html", "dist/offscreen.html");   // ← ADD THIS

        // Offscreen HTML (minimal host page for WebLLM)
        copyFileSync("public/offscreen.html", "dist/offscreen.html");

        // Popup HTML — copy compiled version from where Vite put it
        try {
          copyFileSync("dist/src/popup/popup.html", "dist/popup.html");
        } catch {
          // If Vite placed it correctly already, skip
        }

        // Icons
        try {
          mkdirSync("dist/icons", { recursive: true });
          ["16", "48", "128"].forEach((size) => {
            const src = `public/icons/icon${size}.png`;
            if (existsSync(src)) copyFileSync(src, `dist/icons/icon${size}.png`);
            else console.warn(`[warn] Missing ${src}`);
          });
        } catch {}
      },
    },
  ],

  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
