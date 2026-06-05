import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync } from "fs";

/**
 * ProfReach — Vite Build Config
 *
 * Builds a production Chrome extension with:
 * - WebLLM bundled locally (no CDN dependency)
 * - Content script, background, and popup compiled
 * - Manifest + assets copied to dist/
 *
 * Usage:
 *   npm run dev   → build + watch
 *   npm run build → production build
 *   npm run pack  → zip dist/ for Chrome Web Store
 */

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/popup.html"),
        background: resolve(__dirname, "src/background/background.js"),
        content: resolve(__dirname, "src/content/content.js"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "[name].[ext]",
        // Keep background as ESM module for MV3
        format: "esm",
      },
    },
    // Allow large chunks (WebLLM is large)
    chunkSizeWarningLimit: 10000,
    target: "esnext",
  },

  plugins: [
    {
      // Copy manifest and static assets after build
      name: "copy-extension-assets",
      closeBundle() {
        // Manifest
        copyFileSync("public/manifest.json", "dist/manifest.json");

        // Icons (you'll need to create these)
        try {
          mkdirSync("dist/icons", { recursive: true });
          ["16", "48", "128"].forEach((size) => {
            try {
              copyFileSync(`public/icons/icon${size}.png`, `dist/icons/icon${size}.png`);
            } catch {
              console.warn(`[warn] Missing icon${size}.png — add to public/icons/`);
            }
          });
        } catch {}
      },
    },
  ],

  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
