from pathlib import Path

path = Path("extension/background-v3.ts")
text = path.read_text()


def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    text = text.replace(old, new, 1)

replace_once(
'''    if (response.usedMicro && skill.state === "unknown") {
      if (options.fastOnly) return skill;
      boostMicroCrop = undefined;
      log("Chopping micro-crop was unclear; retrying the safe Chopping crop once.", "warn", { category: "ocr", event: "micro.fallback" });
      response = await captureOcr("boost", profile, {
        workClass,
        generation,
        boostEpoch: requestedBoostEpoch
      });
      skill = response.choppingSkill || { state: "unknown" as const };
      if (!response.usedMicro && response.microRect && skill.state !== "unknown") {
        boostMicroCrop = { key: response.calibrationKey, rect: response.microRect };
      }
    }''',
'''    if (response.usedMicro && skill.state === "unknown") {
      if (options.fastOnly) return skill;
      const critical = workClass === "boost-critical";
      // A single ordinary sync miss is not enough reason to throw away a
      // calibrated micro crop and launch a larger capture. v0.3.5 did that on
      // every miss and the live clip showed visible renderer stalls around
      // fallback activity. Keep the crop for one later sync; critical reads may
      // still use one same-profile base fallback immediately.
      if (!critical && boostMisses < 1) {
        log("Chopping micro-crop was unclear once; keeping calibration and deferring broad fallback.", "debug", {
          category: "ocr", event: "micro.miss_deferred"
        });
        return skill;
      }
      boostMicroCrop = undefined;
      boostMisses = 0;
      log("Chopping micro-crop remained unclear; retrying the safe same-profile Chopping crop once.", "warn", { category: "ocr", event: "micro.fallback" });
      response = await captureOcr("boost", profile, {
        workClass,
        generation,
        boostEpoch: requestedBoostEpoch
      });
      skill = response.choppingSkill || { state: "unknown" as const };
      if (!response.usedMicro && response.microRect && skill.state !== "unknown") {
        boostMicroCrop = { key: response.calibrationKey, rect: response.microRect };
      }
    }''',
"micro fallback staging"
)

replace_once(
'''    boostMisses += 1;
    invalidateViewportCache();
    const refreshedView = await viewport(true);''',
'''    if (boostMisses < 1) {
      boostMisses += 1;
      log("Chopping OCR missed the active crop once; deferring multi-profile recovery to avoid a transient renderer spike.", "debug", {
        category: "ocr", event: "boost.profile_recovery_deferred"
      });
      return skill;
    }
    boostMisses = 0;
    invalidateViewportCache();
    const refreshedView = await viewport(true);''',
"profile fallback staging"
)

replace_once(
'''    if (wasRapidTransitionConfirm && pendingTransitionConfirm) {
      const ageMs = Date.now() - pendingTransitionConfirm.captureAt;''',
'''    // The first unexpected Ready can be discovered inside this very sync.
    // Schedule its second observation immediately instead of falling back to
    // the normal cooldown schedule (which caused multi-second delays in 0.3.5).
    if (!wasRapidTransitionConfirm && quickTransitionConfirm && pendingTransitionConfirm) {
      scheduleRecheck(0.15);
      return;
    }
    if (wasRapidTransitionConfirm && pendingTransitionConfirm) {
      const ageMs = Date.now() - pendingTransitionConfirm.captureAt;''',
"same-sync early Ready confirmation"
)

replace_once(
'''  precisionWindowActive = true;
  setPowerState("precision");
  const remaining = predictedReadyAt ? Math.max(0, (predictedReadyAt - Date.now()) / 1000) : 0;''',
'''  precisionWindowActive = true;
  // Once precision owns the boundary, cancel the normal cooldown-sync wake so
  // two OCR reads cannot collide at the same transition.
  void cancelOffscreenWake("boost-sync");
  nextCooldownSyncAt = 0;
  setPowerState("precision");
  const remaining = predictedReadyAt ? Math.max(0, (predictedReadyAt - Date.now()) / 1000) : 0;''',
"precision duplicate sync cancellation"
)

for marker in [
    "micro.miss_deferred",
    "boost.profile_recovery_deferred",
    "!wasRapidTransitionConfirm && quickTransitionConfirm",
    'cancelOffscreenWake("boost-sync")'
]:
    if marker not in text:
        raise SystemExit(f"missing post-patch marker: {marker}")

path.write_text(text)
print("final v0.3.6 runtime tuning applied")
