import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync } from "fs";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,   
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
        copyFileSync("public/manifest.json", "dist/manifest.json");
        copyFileSync("src/popup/popup.html", "dist/popup.html");
        copyFileSync("src/popup/popup.css", "dist/popup.css");
        try {
          mkdirSync("dist/icons", { recursive: true });
          ["16", "48", "128"].forEach((size) => {
            try {
              copyFileSync(`public/icons/icon${size}.png`, `dist/icons/icon${size}.png`);
            } catch {}
          });
        } catch {}
        try {
          copyFileSync("dist/src/popup/popup.html", "dist/popup.html");
        } catch {}
      },
    },
  ],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});