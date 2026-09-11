import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fail = message => { throw new Error(`Extension audit failed: ${message}`); };
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const exists = relative => fs.existsSync(path.join(root, relative));
const expect = (condition, message) => { if (!condition) fail(message); };
const count = (text, needle) => text.split(needle).length - 1;

const pkg = JSON.parse(read("package.json"));
const manifestSource = JSON.parse(read("extension/public/manifest.json"));
expect(pkg.version === "0.3.5", `package.json version is ${pkg.version}, expected 0.3.5`);
expect(manifestSource.version === "0.3.5", `manifest source version is ${manifestSource.version}, expected 0.3.5`);
expect(manifestSource.manifest_version === 3, "manifest must remain MV3");
for (const permission of ["debugger", "offscreen", "sidePanel", "storage", "tabs", "windows"]) {
  expect(manifestSource.permissions.includes(permission), `manifest missing ${permission} permission`);
}
expect(manifestSource.host_permissions?.length === 1 && manifestSource.host_permissions[0] === "https://bloxd.io/*", "host permissions expanded beyond Bloxd.io");

const requiredBuildFiles = [
  "dist-extension/manifest.json",
  "dist-extension/background.js",
  "dist-extension/sidepanel.html",
  "dist-extension/monitor.html",
  "dist-extension/offscreen.html",
  "dist-extension/ocr/worker.min.js",
  "dist-extension/ocr/lang/eng.traineddata.gz",
  "dist-extension/ocr/core/tesseract-core.wasm.js",
  "dist-extension/ocr/core/tesseract-core-simd.wasm.js",
  "dist-extension/ocr/core/tesseract-core-lstm.wasm.js",
  "dist-extension/ocr/core/tesseract-core-simd-lstm.wasm.js"
];
for (const file of requiredBuildFiles) expect(exists(file), `missing build file ${file}`);
const builtManifest = JSON.parse(read("dist-extension/manifest.json"));
expect(builtManifest.version === "0.3.5", `built manifest version is ${builtManifest.version}`);

const background = read("extension/background-v3.ts");
expect(background.includes('case "OPEN_MONITOR"'), "background has no manual monitor command");
expect(background.includes('command.id === "counter"'), "counter wake is not handled independently of Auto Boost");
expect(background.includes('scheduleOffscreenWake("counter"'), "counter scheduling is not offscreen-driven");
expect(!/case "GET_STATUS":[\s\S]{0,180}refreshLiveStateOnPoll/.test(background), "GET_STATUS still drives live OCR work");
expect(background.includes("fastOnly"), "precision fast-only path is missing");
expect(background.includes("setPowerState(\"deep-sleep\")"), "explicit deep-sleep state is missing");
expect(background.includes("rejectedOcrCount"), "rejected-reading diagnostics are missing");
expect(background.includes("readyToE1Latencies"), "Ready-to-E latency instrumentation is missing");

const offscreen = read("src/extension/offscreen.ts");
expect(offscreen.includes("request.fastOnly"), "offscreen fast-only recognizer path is missing");
expect(offscreen.includes('raw: "fast template miss"'), "fast-only miss does not fail closed");
expect(offscreen.includes("readyTemplates.length === 0 || activeTemplates.length === 0"), "fast classifier can run without both learned state classes");

const monitor = read("src/views/LiveMonitor.tsx");
expect(monitor.includes('type: "GET_STATUS"'), "monitor cannot read cached status");
expect(!monitor.includes('type: "REFRESH_FULL"'), "monitor can trigger full OCR");
expect(!monitor.includes('type: "RECALIBRATE_OCR"'), "monitor can trigger recalibration OCR");
expect(!monitor.includes('type: "TEST_E"'), "monitor exposes test input unexpectedly");
expect(monitor.includes('type: "EMERGENCY_STOP"'), "monitor lacks emergency stop");
expect(monitor.includes("15_000"), "monitor lacks low-frequency recovery status poll");

const live = read("src/views/LiveExtension.tsx");
expect(live.includes('type: "OPEN_MONITOR"'), "side panel lacks manual Open Live Monitor action");
expect(count(live, "Cooldown sync interval (s)") === 1, "duplicate Cooldown sync interval field remains");
expect(count(live, "Precision Ready window (s)") === 1, "duplicate Precision Ready window field remains");

for (const temp of ["scripts/refine-v035-background.py", "scripts/finalize-v035.py", ".github/workflows/finalize-v035.yml"]) {
  expect(!exists(temp), `temporary development file still present: ${temp}`);
}

const readme = read("README.md");
for (const stale of ["default every 5 seconds", "side-panel status polling also drives recovery", "wait 3 seconds\n        ↓\nread Chopping status"]) {
  expect(!readme.includes(stale), `README still contains stale behavior: ${stale}`);
}

console.log("Extension audit passed: v0.3.5 source, runtime safeguards, passive monitor, build output and OCR assets are internally consistent.");
