from pathlib import Path
import re

path = Path("extension/background-v3.ts")
text = path.read_text()


def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    text = text.replace(old, new, 1)


def regex_once(pattern: str, replacement: str, label: str):
    global text
    text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 regex match, found {count}")

replace_once(
    'import { OcrDeadlineError, PriorityOcrQueue, cooldownSyncDelayMs, isStaleObservation, precisionProbePlan, transitionVerdict, type OcrWorkClass } from "../src/extension/reliability";',
    'import { OcrDeadlineError, PriorityOcrQueue, cooldownReadyEstimateMs, cooldownSamplesAgree, cooldownSyncDelayMs, isStaleObservation, precisionProbePlan, transitionVerdict, type OcrWorkClass } from "../src/extension/reliability";',
    "reliability import"
)

replace_once(
    'let fastBoostHits = 0;\nlet cooldownUncertaintySec = 2;',
    'let fastBoostHits = 0;\nlet fastRecognizerReady = false;\nlet provisionalCooldown: { seconds: number; captureAt: number } | undefined;\nlet cooldownRecoveryCandidate: { seconds: number; captureAt: number } | undefined;\nlet cooldownRecoveryPending = false;\nlet cooldownUncertaintySec = 2;',
    "cooldown state globals"
)

replace_once(
    '    lastRecognitionMethod = response.recognitionMethod;\n    log(`OCR ${mode} completed via ${response.recognitionMethod || "unknown"}.`, "debug", {',
    '    lastRecognitionMethod = response.recognitionMethod;\n    if (response.fastRecognizerReady !== undefined) fastRecognizerReady = response.fastRecognizerReady;\n    log(`OCR ${mode} completed via ${response.recognitionMethod || "unknown"}.`, "debug", {',
    "recognizer readiness capture"
)

replace_once(
    'async function readBoost(workClass: OcrWorkClass = "boost-sync", options: { fastOnly?: boolean } = {}): Promise<SkillStateSnapshot> {',
    'async function readBoost(workClass: OcrWorkClass = "boost-sync", options: { fastOnly?: boolean; noProfileFallback?: boolean } = {}): Promise<SkillStateSnapshot> {',
    "readBoost options"
)

replace_once(
    '    if (skill.state !== "unknown") return skill;\n    if (options.fastOnly) return skill;\n\n    boostMisses += 1;',
    '    if (skill.state !== "unknown") return skill;\n    if (options.fastOnly || options.noProfileFallback) return skill;\n\n    boostMisses += 1;',
    "bounded critical fallback"
)

regex_once(
    r'function applyBoostObservation\(skill: SkillStateSnapshot, captureAt: number\) \{.*?\n\}\n\nfunction updateCounter',
    '''function applyBoostObservation(skill: SkillStateSnapshot, captureAt: number) {
  const previousPrediction = predictedReadyAt;
  if (skill.state === "cooldown" && skill.cooldownSeconds !== undefined) {
    const sample = { seconds: skill.cooldownSeconds, captureAt };
    const observedReadyAt = cooldownReadyEstimateMs(sample);

    // v0.3.5 could permanently lock onto one bad first cooldown OCR (the live
    // clip showed 185s while Bloxd displayed ~149s). The first post-Active
    // numeric value is now provisional until a second time-consistent sample
    // predicts the same Ready boundary.
    if (previousPrediction === undefined || previousPrediction <= captureAt) {
      if (!provisionalCooldown) {
        provisionalCooldown = sample;
        cooldownRecoveryCandidate = undefined;
        cooldownRecoveryPending = false;
        cooldownUncertaintySec = Math.max(3, cooldownUncertaintySec);
        boostDriftSeconds = undefined;
        setChoppingSkill(skill);
        log(`Cooldown anchor provisional: ${skill.cooldownSeconds}s. Confirming with a second fresh read before trusting the timer.`, "debug", {
          category: "timer", event: "cooldown.provisional", details: { seconds: skill.cooldownSeconds, captureAt }
        });
        return;
      }

      if (!cooldownSamplesAgree(provisionalCooldown, sample)) {
        rejectedOcrCount += 1;
        log(`Cooldown anchor mismatch: ${provisionalCooldown.seconds}s then ${skill.cooldownSeconds}s. Replacing the untrusted first sample and confirming again.`, "warn", {
          category: "timer", event: "cooldown.provisional_rejected", details: {
            firstSeconds: provisionalCooldown.seconds,
            secondSeconds: skill.cooldownSeconds,
            firstReadyAt: cooldownReadyEstimateMs(provisionalCooldown),
            secondReadyAt: observedReadyAt
          }
        });
        provisionalCooldown = sample;
        cooldownUncertaintySec = Math.min(10, Math.max(4, cooldownUncertaintySec));
        setChoppingSkill(skill);
        return;
      }

      predictedReadyAt = observedReadyAt;
      boostCooldownReadyAt = observedReadyAt;
      provisionalCooldown = undefined;
      cooldownRecoveryCandidate = undefined;
      cooldownRecoveryPending = false;
      boostDriftSeconds = undefined;
      cooldownUncertaintySec = 1.5;
      setChoppingSkill(skill);
      log(`Cooldown anchor confirmed from two consistent samples; predicted Ready ${new Date(observedReadyAt).toLocaleTimeString()}.`, "info", {
        category: "timer", event: "cooldown.anchor_confirmed", details: { seconds: skill.cooldownSeconds, predictedReadyAt: observedReadyAt }
      });
      return;
    }

    const drift = (observedReadyAt - previousPrediction) / 1000;
    const predictedSeconds = Math.max(0, Math.ceil((previousPrediction - captureAt) / 1000));
    if (Math.abs(drift) > 6) {
      // One large disagreement is still rejected, but two fresh samples that
      // agree with each other are a recovery quorum. This prevents a bad old
      // prediction from causing every later correct OCR reading to be rejected.
      if (cooldownRecoveryCandidate
        && captureAt - cooldownRecoveryCandidate.captureAt <= 3_000
        && cooldownSamplesAgree(cooldownRecoveryCandidate, sample)) {
        const oldPrediction = previousPrediction;
        predictedReadyAt = observedReadyAt;
        boostCooldownReadyAt = observedReadyAt;
        cooldownRecoveryCandidate = undefined;
        cooldownRecoveryPending = false;
        boostDriftSeconds = drift;
        cooldownUncertaintySec = 1.5;
        setChoppingSkill(skill);
        log(`Cooldown prediction recovered after two mutually-consistent outliers: ${new Date(oldPrediction).toLocaleTimeString()} → ${new Date(observedReadyAt).toLocaleTimeString()}.`, "warn", {
          category: "timer", event: "cooldown.recovered", details: { driftSeconds: drift, seconds: skill.cooldownSeconds }
        });
        return;
      }

      rejectedOcrCount += 1;
      cooldownRecoveryCandidate = sample;
      cooldownRecoveryPending = true;
      boostDriftSeconds = drift;
      cooldownUncertaintySec = Math.min(10, Math.max(cooldownUncertaintySec, Math.abs(drift)));
      log(`Suspicious cooldown OCR: screen ${skill.cooldownSeconds}s vs predicted ${predictedSeconds}s (${drift >= 0 ? "+" : ""}${drift.toFixed(2)}s). Holding the old timer only until a rapid quorum check.`, "warn", {
        category: "timer", event: "cooldown.recovery_candidate", details: { observedSeconds: skill.cooldownSeconds, predictedSeconds, driftSeconds: drift }
      });
      setChoppingSkill({ state: "cooldown", cooldownSeconds: predictedSeconds, raw: skill.raw });
      return;
    }

    provisionalCooldown = undefined;
    cooldownRecoveryCandidate = undefined;
    cooldownRecoveryPending = false;
    boostDriftSeconds = drift;
    cooldownUncertaintySec = Math.max(0.5, Math.min(8, cooldownUncertaintySec * 0.6 + Math.abs(drift) * 0.8));
    if (Math.abs(drift) >= 0.5) log(`Cooldown sync: screen ${skill.cooldownSeconds}s · drift ${drift >= 0 ? "+" : ""}${drift.toFixed(2)}s → resynced.`);
    predictedReadyAt = observedReadyAt;
    boostCooldownReadyAt = observedReadyAt;
  } else if (skill.state === "ready") {
    if (previousPrediction !== undefined) {
      boostDriftSeconds = (captureAt - previousPrediction) / 1000;
      cooldownUncertaintySec = Math.max(0.5, Math.min(8, Math.abs(boostDriftSeconds)));
    }
    provisionalCooldown = undefined;
    cooldownRecoveryCandidate = undefined;
    cooldownRecoveryPending = false;
    predictedReadyAt = captureAt;
    boostCooldownReadyAt = captureAt;
  } else if (skill.state === "active") {
    provisionalCooldown = undefined;
    cooldownRecoveryCandidate = undefined;
    cooldownRecoveryPending = false;
    predictedReadyAt = undefined;
    boostCooldownReadyAt = undefined;
    boostDriftSeconds = undefined;
    cooldownUncertaintySec = 2;
    nextCooldownSyncAt = 0;
  }
  setChoppingSkill(skill);
}

function updateCounter''',
    "replace boost observation"
)

regex_once(
    r'function scheduleRecheck\(seconds = settings\.readyRetrySec\) \{.*?\n\}',
    '''function scheduleRecheck(seconds = settings.readyRetrySec) {
  const actualSeconds = quickTransitionConfirm ? Math.min(seconds, 0.15) : seconds;
  // Do not clear quickTransitionConfirm here. The wake handler needs to know
  // that this is the second observation of an unexpectedly early Ready/Active.
  void scheduleOffscreenWake("boost-sync", Date.now() + actualSeconds * 1000);
}''',
    "rapid transition recheck"
)

regex_once(
    r'async function keyE\(\) \{.*?\n\}',
    '''async function keyE() {
  await debuggerCommand("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "e",
    code: "KeyE",
    autoRepeat: false,
    windowsVirtualKeyCode: 69,
    nativeVirtualKeyCode: 69
  });
  // v0.3.5 occasionally dispatched an E down/up pair too quickly for Bloxd to
  // observe. Hold the key across at least one typical render/input slice.
  await delay(25);
  await debuggerCommand("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "e",
    code: "KeyE",
    windowsVirtualKeyCode: 69,
    nativeVirtualKeyCode: 69
  });
}''',
    "E key hold"
)

regex_once(
    r'function scheduleCooldownMonitoring\(\) \{.*?\n\}',
    '''function scheduleCooldownMonitoring() {
  if (!settings.autoBoost || predictedReadyAt === undefined) return;
  const now = Date.now();
  const remainingMs = Math.max(0, predictedReadyAt - now);
  const syncDelayMs = cooldownSyncDelayMs({
    remainingMs,
    nominalIntervalSec: settings.cooldownSyncIntervalSec,
    uncertaintySec: cooldownUncertaintySec
  });
  nextCooldownSyncAt = now + syncDelayMs;
  setPowerState("deep-sleep");
  log(`Chopping sleeping for ${(syncDelayMs / 1000).toFixed(2)}s until the next tiny synchronization.`, "debug", {
    category: "timer", event: "sleep.enter", details: { sleepMs: syncDelayMs, remainingMs, uncertaintySec: cooldownUncertaintySec }
  });
  void scheduleOffscreenWake("boost-sync", nextCooldownSyncAt);
  // Bloxd displays whole seconds, so a visible `2s` is an interval rather than
  // an exact 2.000-second boundary. Start the cheap watcher 1.5s early so a
  // real Ready is observed promptly instead of waiting for the local timer to 0.
  const precisionLeadMs = settings.precisionWindowSec * 1000 + 1_500;
  const precisionAt = Math.max(now + 50, predictedReadyAt - precisionLeadMs);
  void scheduleOffscreenWake("boost-precision", precisionAt);
  void chrome.alarms.clear(BOOST_WAKE).then(() => {
    chrome.alarms.create(BOOST_WAKE, { when: Math.max(Date.now() + 1000, predictedReadyAt!) });
  });
}''',
    "precision lead"
)

regex_once(
    r'function scheduleCooldown\(seconds: number\) \{.*?\n\}',
    '''function scheduleCooldown(seconds: number) {
  const captureAt = lastBoostCaptureAt || Date.now();
  precisionWindowActive = false;
  boostCycle = undefined;
  boostStateEpoch += 1;

  // applyBoostObservation owns cooldown authority. If there is still no trusted
  // prediction, this was only the first/provisional numeric sample (or a
  // replacement after mismatch). Confirm again quickly while the game is in a
  // harmless cooldown rather than letting one OCR error anchor the whole cycle.
  if (predictedReadyAt === undefined) {
    setPowerState("sync");
    log(`Cooldown ${seconds}s is not trusted yet; confirming the anchor again in 0.45s.`, "debug", {
      category: "timer", event: "cooldown.anchor_wait", details: { seconds, captureAt }
    });
    void scheduleOffscreenWake("boost-active", Date.now() + 450);
    return;
  }

  boostTotals.cooldownsRead = [...boostTotals.cooldownsRead, seconds].slice(-100);
  boostCooldownReadyAt = predictedReadyAt;
  boostWakeAt = predictedReadyAt + settings.cooldownSafetySec * 1000;
  lastCooldownSyncAt = captureAt;
  log(`Cooldown anchor trusted at ${seconds}s. Adaptive sync stays at or below ${settings.cooldownSyncIntervalSec}s; predicted Ready ${new Date(predictedReadyAt).toLocaleTimeString()}.`);
  scheduleCooldownMonitoring();
}''',
    "trusted schedule cooldown"
)

regex_once(
    r'async function syncCooldown\(\) \{.*?\n\}',
    '''async function syncCooldown() {
  if (!settings.autoBoost || connectedTabId === undefined || boostFault) return;
  // A provisional first cooldown sample has no predictedReadyAt yet; active
  // checks own that confirmation path.
  if (!predictedReadyAt && !quickTransitionConfirm) return;
  setPowerState("sync");
  lastCooldownSyncAt = Date.now();
  const before = predictedReadyAt;
  const wasRapidTransitionConfirm = quickTransitionConfirm;
  try {
    const observed = await readBoost(
      wasRapidTransitionConfirm ? "boost-critical" : "boost-sync",
      { noProfileFallback: wasRapidTransitionConfirm }
    );
    if (observed.state === "ready") {
      log(wasRapidTransitionConfirm
        ? "Unexpected Ready was confirmed by a second fresh read; overriding the stale timer and activating immediately."
        : "Cooldown sync saw actual Ready. Activating immediately.");
      await beginBoostCycle();
      return;
    }
    if (observed.state === "active") {
      log("Cooldown sync saw Active. Waiting for the first numeric cooldown.");
      scheduleActiveCheck();
      return;
    }
    if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) {
      if (cooldownRecoveryPending) {
        log("Large cooldown disagreement needs one rapid quorum read before either timer is trusted.", "debug", {
          category: "timer", event: "cooldown.recovery_check"
        });
        void scheduleOffscreenWake("boost-sync", Date.now() + 350);
        return;
      }
      const adjustment = before === undefined || predictedReadyAt === undefined ? 0 : (predictedReadyAt - before) / 1000;
      log(`Chopping sync: screen ${observed.cooldownSeconds}s${Math.abs(adjustment) >= 0.05 ? ` · adjusted ${adjustment >= 0 ? "+" : ""}${adjustment.toFixed(2)}s` : " · matched prediction"}.`);
      scheduleCooldownMonitoring();
      return;
    }
    if (wasRapidTransitionConfirm && pendingTransitionConfirm) {
      const ageMs = Date.now() - pendingTransitionConfirm.captureAt;
      if (ageMs < 750) {
        scheduleRecheck(0.15);
        return;
      }
      pendingTransitionConfirm = undefined;
      quickTransitionConfirm = false;
      log("Rapid transition confirmation expired without a second matching read; retaining the prior safe state.", "debug", {
        category: "chopping", event: "transition.confirm_expired"
      });
    }
    if (predictedReadyAt !== undefined) scheduleCooldownMonitoring();
  } catch (error) {
    log(`Chopping sync failed: ${errorText(error)}. Keeping the last good prediction.`, "warn");
    if (predictedReadyAt !== undefined) scheduleCooldownMonitoring();
  }
}''',
    "sync cooldown recovery"
)

regex_once(
    r'async function precisionBoostTick\(\) \{.*?\n\}',
    '''async function precisionBoostTick() {
  if (!precisionWindowActive || !settings.autoBoost || connectedTabId === undefined || boostFault || boostCycle) return;
  const remainingMs = predictedReadyAt === undefined ? 0 : predictedReadyAt - Date.now();
  const plan = precisionProbePlan({
    remainingMs,
    hasMicroCrop: Boolean(boostMicroCrop),
    fastRecognizerReady
  });
  try {
    const observed = await readBoost("boost-critical", {
      fastOnly: plan.fastOnly,
      // Precision is allowed one safe same-profile fallback, but never a
      // multi-profile hunt that can visibly stall the game near Ready.
      noProfileFallback: true
    });
    if (observed.state === "ready") {
      precisionWindowActive = false;
      const finishedAt = Date.now();
      log(`Actual Ready confirmed. Recognition finished ${Math.max(0, finishedAt - (lastBoostCaptureAt || finishedAt))}ms after screenshot capture.`, "info", {
        category: "chopping", event: "ready.confirmed", details: { captureToRecognitionMs: Math.max(0, finishedAt - (lastBoostCaptureAt || finishedAt)), fastOnly: plan.fastOnly }
      });
      await beginBoostCycle();
      return;
    }
    if (observed.state === "active") {
      precisionWindowActive = false;
      scheduleActiveCheck();
      return;
    }
    if (observed.state === "cooldown" && predictedReadyAt !== undefined) {
      const left = predictedReadyAt - Date.now();
      if (left > (settings.precisionWindowSec + 2) * 1000) {
        precisionWindowActive = false;
        log("Precision window moved back after cooldown re-sync; returning to low-overhead monitoring.", "info", { category: "timer", event: "precision.exit" });
        scheduleCooldownMonitoring();
        return;
      }
    }
  } catch (error) {
    log(`Precision Chopping read: ${errorText(error)}`, "warn", { category: "chopping", event: "precision.error" });
  }
  if (precisionWindowActive) {
    const nextDelayMs = quickTransitionConfirm ? Math.min(150, plan.nextDelayMs) : plan.nextDelayMs;
    void scheduleOffscreenWake("boost-precision", Date.now() + nextDelayMs);
  }
}''',
    "precision probe behavior"
)

replace_once(
    '  const nearReady = settings.autoBoost && predictedReadyAt !== undefined\n    && predictedReadyAt - Date.now() <= settings.precisionWindowSec * 1000 + 1_000;',
    '  const nearReady = settings.autoBoost && predictedReadyAt !== undefined\n    && predictedReadyAt - Date.now() <= settings.precisionWindowSec * 1000 + 2_000;',
    "counter pre-boundary deferral"
)

replace_once(
    '  fastBoostHits = 0;\n  cooldownUncertaintySec = 2;',
    '  fastBoostHits = 0;\n  fastRecognizerReady = false;\n  provisionalCooldown = undefined;\n  cooldownRecoveryCandidate = undefined;\n  cooldownRecoveryPending = false;\n  cooldownUncertaintySec = 2;',
    "disconnect cooldown reset"
)

replace_once(
    '    fastBoostHits,\n    boostMicroCalibrated: Boolean(boostMicroCrop),',
    '    fastBoostHits,\n    fastRecognizerReady,\n    boostMicroCalibrated: Boolean(boostMicroCrop),',
    "status recognizer readiness"
)

# A single metadata retry at connection fixes the live case where Blocks/Chopping
# were usable but Phase stayed blank for the entire run. It happens only during
# connection, never periodically while mining.
replace_once(
    '''    const snapshot = await readFullSnapshot(true);
    if (snapshot.blocksMined === undefined) {
      log("Connected, but the initial OCR did not find Blocks mined. Use Recalibrate OCR if the sidebar is visible.", "warn");
    }''',
    '''    let snapshot = await readFullSnapshot(true);
    if (snapshot.blocksMined === undefined) {
      log("Connected, but the initial OCR did not find Blocks mined. Use Recalibrate OCR if the sidebar is visible.", "warn");
    }
    if (!snapshot.phase) {
      log("Initial sidebar snapshot missed Phase; retrying full metadata once before normal low-overhead operation.", "debug", {
        category: "ocr", event: "metadata.retry"
      });
      snapshot = await readFullSnapshot(true);
      if (!snapshot.phase) log("Phase remained unreadable after the one connection-time retry; continuing without inventing it.", "warn");
    }''',
    "phase metadata retry"
)

# Guard against accidental partial edits.
required = [
    "cooldown.anchor_confirmed",
    "cooldown.recovered",
    "fastRecognizerReady",
    "await delay(25)",
    "precisionLeadMs",
    "noProfileFallback",
    "metadata.retry"
]
for marker in required:
    if marker not in text:
        raise SystemExit(f"post-patch marker missing: {marker}")

path.write_text(text)
print("v0.3.6 background fixes applied successfully")
