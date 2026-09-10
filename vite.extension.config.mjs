import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const file = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(file);
const extensionRoot = path.join(projectRoot, "extension");
const outDir = path.join(projectRoot, "dist-extension");

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyOcrAssets() {
  return {
    name: "copy-local-tesseract-assets",
    closeBundle() {
      const workerSource = path.join(projectRoot, "node_modules", "tesseract.js", "dist", "worker.min.js");
      if (!fs.existsSync(workerSource)) throw new Error(`Missing Tesseract worker: ${workerSource}`);
      copyFile(workerSource, path.join(outDir, "ocr", "worker.min.js"));

      const coreSource = path.join(projectRoot, "node_modules", "tesseract.js-core");
      if (!fs.existsSync(coreSource)) throw new Error(`Missing Tesseract core directory: ${coreSource}`);
      const coreFiles = fs.readdirSync(coreSource).filter(name => /^tesseract-core.*\.(?:js|wasm)$/.test(name));
      if (!coreFiles.length) throw new Error("No Tesseract core assets were found.");
      for (const name of coreFiles) copyFile(path.join(coreSource, name), path.join(outDir, "ocr", "core", name));

      const languageCandidates = [
        path.join(projectRoot, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"),
        path.join(projectRoot, "node_modules", "@tesseract.js-data", "eng", "4.0.0", "eng.traineddata.gz")
      ];
      const languageSource = languageCandidates.find(candidate => fs.existsSync(candidate));
      if (!languageSource) throw new Error("English Tesseract traineddata was not found.");
      copyFile(languageSource, path.join(outDir, "ocr", "lang", "eng.traineddata.gz"));
    }
  };
}

export default defineConfig({
  root: extensionRoot,
  base: "./",
  publicDir: path.join(extensionRoot, "public"),
  plugins: [react(), copyOcrAssets()],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: path.join(extensionRoot, "sidepanel.html"),
        offscreen: path.join(extensionRoot, "offscreen.html"),
        background: path.join(extensionRoot, "background.ts")
      },
      output: {
        entryFileNames: chunk => chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
