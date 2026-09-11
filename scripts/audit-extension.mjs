import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const fail = message => { throw new Error(`Extension audit failed: ${message}`); };
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const exists = relative => fs.existsSync(path.join(root, relative));
const expect = (condition, message) => { if (!condition) fail(message); };
const count = (text, needle) => text.split(needle).length - 1;

const pkg = JSON.parse(read("package.json"));
const manifestSource = JSON.parse(read("extension/public/manifest.json"));
expect(pkg.version === "0.3.6", `package.json version is ${pkg.version}, expected 0.3.6`);
expect(manifestSource.version === "0.3.6", `manifest source version is ${manifestSource.version}, expected 0.3.6`);
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
expect(builtManifest.version === "0.3.6", `built manifest version is ${builtManifest.version}`);
expect(builtManifest.permissions.includes("windows"), "built manifest is missing windows permission for manual monitor popup");

const trackedGenerated = execFileSync("git", ["ls-files", "dist-extension", "package-lock.json"], { cwd: root, encoding: "utf8" }).trim();
expect(trackedGenerated === "", `generated build output is tracked in source: ${trackedGenerated}`);

const background = read("extension/background-v3.ts");
expect(background.includes('case "OPEN_MONITOR"'), "background has no manual monitor command");
const offscreenWakeStart = background.indexOf('case "OFFSCREEN_WAKE":');
const emergencyStopStart = background.indexOf('case "EMERGENCY_STOP":', offscreenWakeStart);
expect(offscreenWakeStart >= 0 && emergencyStopStart > offscreenWakeStart, "OFFSCREEN_WAKE command block could not be isolated");
const offscreenWakeBlock = background.slice(offscreenWakeStart, emergencyStopStart);
expect(offscreenWakeBlock.includes('command.id === "counter"'), "counter wake is not handled in OFFSCREEN_WAKE");
expect(offscreenWakeBlock.indexOf('command.id === "counter"') < offscreenWakeBlock.indexOf('if (!settings.autoBoost || connectedTabId === undefined || boostFault)'), "counter wake is incorrectly gated by Auto Boost inside OFFSCREEN_WAKE");
expect(background.includes('scheduleOffscreenWake("counter"'), "counter scheduling is not offscreen-driven");
expect(/case "GET_STATUS":\s*return \{ ok: true, status: status\(\) \};/.test(background), "GET_STATUS is not a pure cached-state read");
expect(!/case "GET_STATUS":[\s\S]{0,220}(reconcileConnection|readBoost|readCounter|readFullSnapshot|refreshLiveStateOnPoll)/.test(background), "GET_STATUS can still drive connection/OCR work");
expect(!background.includes("refreshLiveStateOnPoll"), "obsolete UI-driven live OCR loop remains in background");

// v0.3.6 live-regression safeguards. These directly cover failures observed in
// the v0.3.5 15-minute browser recording rather than only compile-time shape.
expect(background.includes("cooldownSamplesAgree"), "cooldown samples are not compared by predicted Ready boundary");
expect(background.includes("cooldown.provisional"), "first numeric cooldown is not treated as provisional");
expect(background.includes("cooldown.anchor_confirmed"), "provisional cooldown has no second-sample confirmation path");
expect(background.includes("cooldown.recovery_candidate"), "large-drift recovery candidate path is missing");
expect(background.includes("cooldown.recovered"), "two-sample recovery quorum cannot replace a stale prediction");
expect(background.includes("!wasRapidTransitionConfirm && quickTransitionConfirm"), "newly observed early Ready does not schedule immediate confirmation");
expect(background.includes("scheduleRecheck(0.15)"), "early Ready/Active confirmation is not sub-second");
expect(background.includes("precisionLeadMs"), "precision watcher does not start ahead of integer countdown zero");
expect(background.includes('cancelOffscreenWake("boost-sync")'), "normal cooldown sync is not cancelled when precision owns the boundary");
expect(background.includes("fastRecognizerReady"), "background does not track whether fast Ready/Active matching is actually trained");
expect(background.includes("noProfileFallback: true"), "precision reads can still trigger multi-profile fallback hunting");
expect(background.includes("micro.miss_deferred"), "single micro-crop misses still immediately trigger larger fallback work");
expect(background.includes("boost.profile_recovery_deferred"), "multi-profile recovery is not staged after transient misses");
expect(background.includes("await delay(25);"), "E key down/up still has no deliberate hold interval");
expect(background.includes("metadata.retry"), "missing Phase metadata has no one-time connection retry");

expect(background.includes("fastOnly"), "precision fast-only path is missing");
expect(background.includes("precisionProbePlan"), "bounded precision probe scheduler is missing");
expect(background.includes("setPowerState(\"deep-sleep\")"), "explicit deep-sleep state is missing");
expect(background.includes("precisionWindowActive || nearReady"), "counter is not pre-deferred just before the precision window");
expect(background.includes("rejectedOcrCount"), "rejected-reading diagnostics are missing");
expect(background.includes("readyToE1Latencies"), "Ready-to-E dispatch instrumentation is missing");
expect(background.includes("diagnostics].slice(0, 500)"), "structured diagnostic ring buffer is not capped at 500 events");

const reliability = read("src/extension/reliability.ts");
expect(reliability.includes("cooldownReadyEstimateMs"), "absolute cooldown Ready estimator is missing");
expect(reliability.includes("cooldownSamplesAgree"), "cooldown agreement helper is missing");
expect(reliability.includes("fastRecognizerReady"), "precision planner is not gated on fast recognizer readiness");
expect(/fastOnly\s*=\s*options\.hasMicroCrop\s*&&\s*options\.fastRecognizerReady/.test(reliability), "fast-only probing can run before the matcher is trained");

const calibration = read("src/extension/ocrCalibration.ts");
expect(calibration.includes("normalizedStateCellRect"), "stable Chopping Skill-cell crop helper is missing");
expect(calibration.includes("imageWidth * 0.42"), "Chopping state-cell width is not fixed across Ready/Active/cooldown token widths");
expect(!calibration.includes("wordWidth * 2.2"), "Chopping state crop still depends on current token width");

const offscreen = read("src/extension/offscreen.ts");
expect(offscreen.includes("request.fastOnly"), "offscreen fast-only recognizer path is missing");
expect(offscreen.includes('raw: "fast template miss"'), "fast-only miss does not fail closed");
expect(offscreen.includes("function fastRecognizerReady()"), "offscreen does not expose matcher readiness");
expect(offscreen.includes("readyTemplates.length > 0 && activeTemplates.length > 0"), "fast classifier can run without both learned state classes");
expect(offscreen.includes("if (!fastRecognizerReady()) return undefined"), "fast classifier does not fail closed before both template classes exist");
expect(offscreen.includes('tessedit_char_whitelist: ""'), "full OCR does not clear the restrictive micro whitelist");

const monitor = read("src/views/LiveMonitor.tsx");
expect(monitor.includes('type: "GET_STATUS"'), "monitor cannot read cached status");
expect(!monitor.includes('type: "REFRESH_FULL"'), "monitor can trigger full OCR");
expect(!monitor.includes('type: "RECALIBRATE_OCR"'), "monitor can trigger recalibration OCR");
expect(!monitor.includes('type: "TEST_E"'), "monitor exposes test input unexpectedly");
expect(monitor.includes('type: "EMERGENCY_STOP"'), "monitor lacks emergency stop");
expect(monitor.includes("15_000"), "monitor lacks low-frequency recovery status poll");
expect(monitor.includes('"mini"'), "monitor does not default/support Mini density");

const live = read("src/views/LiveExtension.tsx");
expect(live.includes('type: "OPEN_MONITOR"'), "side panel lacks manual Open Live Monitor action");
expect(live.includes("15_000"), "side panel did not move to low-frequency recovery polling");
expect(count(live, "Cooldown sync interval (s)") === 1, "duplicate Cooldown sync interval field remains");
expect(count(live, "Precision Ready window (s)") === 1, "duplicate Precision Ready window field remains");

for (const temp of [
  "scripts/refine-v035-background.py",
  "scripts/finalize-v035.py",
  "scripts/run-finalize-v035.py",
  "scripts/harden-v035.py",
  ".github/workflows/finalize-v035.yml",
  ".github/workflows/finalize-v035-v2.yml",
  ".github/workflows/harden-v035.yml",
  "scripts/apply-v036-background-fixes.py",
  "scripts/repair-v036-patch-script.py",
  "scripts/fix-v036-crop-stability.py",
  "scripts/tune-v036-runtime.py",
  ".github/workflows/apply-v036-fixes.yml",
  ".github/workflows/tune-v036-runtime.yml"
]) {
  expect(!exists(temp), `temporary development file still present: ${temp}`);
}

const readme = read("README.md");
for (const stale of ["default every 5 seconds", "side-panel status polling also drives recovery", "wait 3 seconds\n        ↓\nread Chopping status"]) {
  expect(!readme.includes(stale), `README still contains stale behavior: ${stale}`);
}
expect(readme.includes("never opened automatically"), "README does not document manual-only monitor behavior");
expect(readme.includes("sleep state"), "README does not document cooldown sleep behavior");
expect(readme.includes("v0.3.6"), "README does not identify the v0.3.6 fix release");

console.log("Extension audit passed: v0.3.6 source, live-regression safeguards, passive monitor, low-overhead scheduling, build output and OCR assets are internally consistent.");
