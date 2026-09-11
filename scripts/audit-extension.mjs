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
expect(pkg.version === "0.3.7", `package.json version is ${pkg.version}, expected 0.3.7`);
expect(manifestSource.version === "0.3.7", `manifest source version is ${manifestSource.version}, expected 0.3.7`);
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
expect(builtManifest.version === "0.3.7", `built manifest version is ${builtManifest.version}`);
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

// v0.3.7 live-regression safeguards. These directly cover failures observed in
// the v0.3.5 15-minute browser recording rather than only compile-time shape.
expect(background.includes("cooldownSamplesAgree"), "cooldown samples are not compared by predicted Ready boundary");
expect(background.includes("cooldown.provisional"), "first numeric cooldown is not treated as provisional");
expect(background.includes("cooldown.anchor_confirmed"), "provisional cooldown has no second-sample confirmation path");
expect(background.includes("cooldown.recovery_candidate"), "large-drift recovery candidate path is missing");
expect(background.includes("cooldown.recovered"), "two-sample recovery quorum cannot replace a stale prediction");
expect(background.includes("!wasRapidTransitionConfirm && quickTransitionConfirm"), "newly observed early Ready does not schedule immediate confirmation");
expect(background.includes("scheduleRecheck(0.15)"), "early Ready/Active confirmation is not sub-second");
expect(background.includes("boundary.lock_confirmed"), "strict two-read final timing lock is missing");
expect(background.includes("finalLockSamplesAgree"), "final boundary lock is not using the stricter agreement rule");
expect(background.includes('scheduleOffscreenWake("boost-boundary"'), "dedicated boundary input wake is missing");
expect(background.includes("BOUNDARY_E_OFFSETS_MS"), "scheduled boundary E coverage is missing");
expect(background.includes('cancelOffscreenWake("counter")'), "counter blackout is missing near the activation boundary");
expect(background.includes("boundaryBurstRunning || Boolean(boostCycle) || nearReady"), "counter can still start during the critical input/verification window");
expect(background.includes("noProfileFallback: true"), "final lock reads can still trigger multi-profile fallback hunting");
expect(background.includes("micro.miss_deferred"), "single micro-crop misses still immediately trigger larger fallback work");
expect(background.includes("boost.profile_recovery_deferred"), "multi-profile recovery is not staged after transient misses");
expect(background.includes("await delay(25);"), "E key down/up still has no deliberate hold interval");
expect(background.includes("metadata.retry"), "missing Phase metadata has no one-time connection retry");

const boundaryStart = background.indexOf("async function runBoundaryActivation()");
const boundaryEnd = background.indexOf("async function beginBoostCycle()", boundaryStart);
expect(boundaryStart >= 0 && boundaryEnd > boundaryStart, "boundary activation function could not be isolated");
const boundaryBlock = background.slice(boundaryStart, boundaryEnd);
expect(!boundaryBlock.includes("readBoost("), "boundary input window performs Chopping OCR");
expect(!boundaryBlock.includes("readCounter("), "boundary input window performs counter OCR");
expect(!boundaryBlock.includes("captureOcr("), "boundary input window performs screenshot/OCR capture");
expect(!boundaryBlock.includes('event: "input.boundary_e"'), "boundary loop still logs/broadcasts every E dispatch");
expect(boundaryBlock.includes("dispatchOffsets"), "boundary loop does not retain dispatch timing for one post-window summary");
expect(background.includes('event: "boundary.rapid_ready_confirm"'), "unexpected early Ready does not get the 100ms final-lock confirmation path");
expect(background.includes("if (!critical && boostMisses < 2)") && background.includes("if (boostMisses < 2)"), "ordinary Chopping misses are not staged before both same-profile and multi-profile recovery");
expect(background.includes("setPowerState(\"deep-sleep\")"), "explicit deep-sleep state is missing");
expect(background.includes("boundaryBurstRunning || Boolean(boostCycle) || nearReady"), "counter is not pre-deferred across the final lock/input/verification window");
expect(background.includes("rejectedOcrCount"), "rejected-reading diagnostics are missing");
expect(background.includes("readyToE1Latencies"), "Ready-to-E dispatch instrumentation is missing");
expect(background.includes("diagnostics].slice(0, 500)"), "structured diagnostic ring buffer is not capped at 500 events");

const reliability = read("src/extension/reliability.ts");
expect(reliability.includes("cooldownReadyEstimateMs"), "absolute cooldown Ready estimator is missing");
expect(reliability.includes("cooldownSamplesAgree"), "cooldown agreement helper is missing");
expect(reliability.includes("FINAL_LOCK_AGREEMENT_MS = 1_000"), "final lock agreement is not capped at 1 second");
expect(reliability.includes("BOUNDARY_E_OFFSETS_MS"), "boundary E coverage constants are missing");
expect(reliability.includes("BOUNDARY_WAKE_LEAD_MS = 2_000"), "boundary wake does not reserve 1s of pre-focus headroom before the first E slot");

const calibration = read("src/extension/ocrCalibration.ts");
expect(calibration.includes("normalizedSkillValueRect"), "Skill:-anchored Chopping value crop helper is missing");
expect(calibration.includes("resemblesSkillAnchor"), "Chopping crop is not anchored to the stable Skill: label");
expect(calibration.includes("skillAnchor.x1"), "Chopping value crop does not start from the fixed Skill: anchor");

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
  "scripts/guard-v036-rapid-confirm.py",
  ".github/workflows/apply-v036-fixes.yml",
  ".github/workflows/tune-v036-runtime.yml",
  "scripts/apply-v037-final.py",
  ".github/workflows/apply-v037-final.yml"
]) {
  expect(!exists(temp), `temporary development file still present: ${temp}`);
}

const readme = read("README.md");
for (const stale of ["default every 5 seconds", "side-panel status polling also drives recovery", "wait 3 seconds\n        ↓\nread Chopping status"]) {
  expect(!readme.includes(stale), `README still contains stale behavior: ${stale}`);
}
expect(readme.includes("never opened automatically"), "README does not document manual-only monitor behavior");
expect(/Chopping cooldown:\s*sleep between scheduled tiny reads/i.test(readme), "README does not document cooldown sleep behavior");
expect(readme.includes("v0.3.7"), "README does not identify the v0.3.7 fix release");
expect(!readme.includes("only a fresh Chopping `Ready` observation can start the E sequence"), "README still describes the pre-v0.3.7 OCR-trigger-only architecture");
expect(readme.includes("six E presses span ±1 second"), "README does not document the trusted scheduled boundary path accurately");
expect(live.includes("two strict final-lock countdown reads"), "Live UI does not describe the final timer lock accurately");
expect(!live.includes("E is never triggered by the local timer alone"), "Live UI still contains the pre-v0.3.7 timer claim");

console.log("Extension audit passed: v0.3.7 strict boundary lock, OCR blackout, Skill-anchor crop, live-regression safeguards, passive monitor, build output and OCR assets are internally consistent.");
