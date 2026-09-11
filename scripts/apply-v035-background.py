from pathlib import Path

path = Path("extension/background-v3.ts")
text = path.read_text()


def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)


def replace_between(start: str, end: str, replacement: str, label: str):
    global text
    start_index = text.find(start)
    if start_index < 0:
        raise SystemExit(f"{label}: start marker not found: {start!r}")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise SystemExit(f"{label}: end marker not found: {end!r}")
    text = text[:start_index] + replacement.rstrip() + "\n\n" + text[end_index:]


replace_once(
    'import { isOneBlockUrl, lobbyFromUrl } from "../src/extension/parser";\n',
    'import { isOneBlockUrl, lobbyFromUrl } from "../src/extension/parser";\n'
    'import type { RelativeOcrRect } from "../src/extension/ocrCalibration";\n'
    'import { OcrDeadlineError, PriorityOcrQueue, cooldownSyncDelayMs, isStaleObservation, transitionVerdict, type OcrWorkClass } from "../src/extension/reliability";\n',
    "imports"
)

replace_once(
    '  OcrRequest,\n  OcrResponse\n} from "../src/extension/types";',
    '  OcrRequest,\n  OcrResponse,\n  OffscreenControlRequest,\n  OffscreenWakeId\n} from "../src/extension/types";',
    "type imports"
)

replace_once(
    'let verifyTimer: number | undefined;\nlet activeTimer: number | undefined;\nlet recheckTimer: number | undefined;\nlet counterTimer: number | undefined;\nlet connectFlight: Promise<void> | null = null;\nlet connectingTabId: number | undefined;\nlet fullReadFlight: Promise<SidebarSnapshot> | null = null;\nlet ocrQueue: Promise<void> = Promise.resolve();\nlet activeOcrProfile: OcrCropProfile | undefined;\nlet lastViewport: OcrViewport | undefined;\n',
    'let connectFlight: Promise<void> | null = null;\nlet connectingTabId: number | undefined;\nlet fullReadFlight: Promise<SidebarSnapshot> | null = null;\nconst ocrQueue = new PriorityOcrQueue();\nlet activeOcrProfile: OcrCropProfile | undefined;\nlet lastViewport: OcrViewport | undefined;\nlet viewportCheckedAt = 0;\nlet connectionEpoch = 0;\nlet fullGeneration = 0;\nlet counterGeneration = 0;\nlet boostGeneration = 0;\nlet boostStateEpoch = 0;\nlet lastAcceptedCounterGeneration = 0;\nlet lastAcceptedBoostGeneration = 0;\nlet lastAcceptedCounterCaptureAt = 0;\nlet lastAcceptedBoostCaptureAt = 0;\nlet boostMicroCrop: { key: string; rect: RelativeOcrRect } | undefined;\nlet counterMicroCrop: { key: string; rect: RelativeOcrRect } | undefined;\nlet fastBoostHits = 0;\nlet cooldownUncertaintySec = 2;\nlet nextCooldownSyncAt = 0;\nlet pendingTransitionConfirm: { state: "ready" | "active"; captureAt: number } | undefined;\nlet quickTransitionConfirm = false;\n',
    "runtime state"
)

replace_once(
    'let precisionTimer: number | undefined;\nlet precisionWindowActive = false;',
    'let precisionWindowActive = false;',
    "remove precision timer"
)

replace_between(
    'function enqueueOcr<T>',
    'async function ensureOffscreen()',
    '''function microCalibrationKey(profile: OcrCropProfile, view: OcrViewport) {
  return `${profile}:${Math.round(view.width)}x${Math.round(view.height)}`;
}

function applyRelativeRect(
  base: { x: number; y: number; width: number; height: number; scale: number },
  rect: RelativeOcrRect
) {
  return {
    x: base.x + base.width * rect.x,
    y: base.y + base.height * rect.y,
    width: Math.max(1, base.width * rect.width),
    height: Math.max(1, base.height * rect.height),
    scale: 1
  };
}

function invalidateViewportCache() {
  lastViewport = undefined;
  viewportCheckedAt = 0;
}

function invalidateMicroCrops() {
  boostMicroCrop = undefined;
  counterMicroCrop = undefined;
}

async function sendOffscreenControl(message: OffscreenControlRequest) {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage(message) as { ok?: boolean; error?: string } | undefined;
  if (!response?.ok) throw new Error(response?.error || `Offscreen ${message.type} failed.`);
}

async function scheduleOffscreenWake(id: OffscreenWakeId, when: number) {
  try {
    await sendOffscreenControl({ target: "offscreen", type: "SCHEDULE_WAKE", id, when });
  } catch (error) {
    log(`Could not schedule ${id}: ${errorText(error)}`, "warn");
  }
}

async function cancelOffscreenWake(id: OffscreenWakeId) {
  if (!(await chrome.offscreen.hasDocument())) return;
  try {
    const response = await chrome.runtime.sendMessage({ target: "offscreen", type: "CANCEL_WAKE", id } satisfies OffscreenControlRequest) as { ok?: boolean } | undefined;
    if (!response?.ok) log(`Offscreen ${id} cancellation was not acknowledged.`, "warn");
  } catch {
    // Closing/restarting the offscreen document implicitly cancels its timers.
  }
}

function cancelAllBoostWakes() {
  for (const id of ["boost-sync", "boost-precision", "boost-verify", "boost-active"] as OffscreenWakeId[]) {
    void cancelOffscreenWake(id);
  }
}

function ocrResponseWithTimeout(request: OcrRequest, timeoutMs = 12_000): Promise<OcrResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`OCR ${request.mode} timed out after ${timeoutMs}ms.`)), timeoutMs);
    chrome.runtime.sendMessage(request)
      .then(response => resolve(response as OcrResponse))
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}
''',
    "OCR helpers"
)

replace_between(
    'async function viewport()',
    'function orderedProfiles',
    '''async function viewport(force = false): Promise<OcrViewport> {
  const now = Date.now();
  if (!force && lastViewport && now - viewportCheckedAt < 5_000) return lastViewport;
  const metrics = await debuggerCommand<any>("Page.getLayoutMetrics");
  const visual = metrics.cssVisualViewport || metrics.visualViewport || metrics.cssContentSize || metrics.contentSize;
  const width = Number(visual?.clientWidth ?? visual?.width);
  const height = Number(visual?.clientHeight ?? visual?.height);
  const pageX = Number(visual?.pageX || 0);
  const pageY = Number(visual?.pageY || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Could not determine the Bloxd game viewport size.");
  }
  const changed = lastViewport
    && (Math.abs(lastViewport.width - width) > 1 || Math.abs(lastViewport.height - height) > 1
      || Math.abs(lastViewport.pageX - pageX) > 1 || Math.abs(lastViewport.pageY - pageY) > 1);
  lastViewport = { width, height, pageX, pageY };
  viewportCheckedAt = now;
  if (changed) {
    invalidateMicroCrops();
    log(`Bloxd viewport changed to ${Math.round(width)}×${Math.round(height)}; micro OCR will recalibrate.`);
  }
  return lastViewport;
}
''',
    "viewport cache"
)

replace_between(
    'async function captureOcr(',
    'function skillText',
    '''type CapturedOcrResponse = OcrResponse & {
  captureAt: number;
  connectionEpoch: number;
  generation: number;
  boostEpoch: number;
  calibrationKey: string;
  usedMicro: boolean;
};

async function captureOcr(
  mode: OcrMode,
  profile: OcrCropProfile,
  options: {
    workClass: OcrWorkClass;
    generation: number;
    boostEpoch?: number;
    microRect?: RelativeOcrRect;
    preferFast?: boolean;
    forceViewport?: boolean;
  }
): Promise<CapturedOcrResponse> {
  const requestedConnectionEpoch = connectionEpoch;
  const requestedBoostEpoch = options.boostEpoch ?? boostStateEpoch;
  return ocrQueue.enqueue(options.workClass, async () => {
    if (requestedConnectionEpoch !== connectionEpoch) throw new Error("Discarded OCR work from an older connection epoch.");
    await ensureOffscreen();
    const view = await viewport(Boolean(options.forceViewport));
    const baseClip = cropRegion(profile, mode, view);
    const clip = options.microRect ? applyRelativeRect(baseClip, options.microRect) : baseClip;
    const key = microCalibrationKey(profile, view);
    const captureAt = Date.now();
    const capture = await debuggerCommand<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      optimizeForSpeed: true,
      clip
    });
    if (!capture?.data) throw new Error(`Screenshot capture returned no data (${mode}/${profile}).`);

    const request: OcrRequest = {
      target: "offscreen",
      type: "OCR",
      mode,
      imageDataUrl: `data:image/png;base64,${capture.data}`,
      calibrationKey: key,
      inputScope: options.microRect ? "micro" : "base",
      preferFast: Boolean(options.preferFast && options.microRect)
    };

    let response: OcrResponse;
    try {
      response = await ocrResponseWithTimeout(request);
    } catch (error) {
      if (/timed out/i.test(errorText(error))) {
        log(`OCR watchdog restarting the offscreen worker after timeout (${mode}/${profile}).`, "warn");
        await closeOffscreen();
      }
      throw error;
    }
    if (!response) throw new Error(`OCR worker returned no response (${mode}/${profile}).`);
    if (!response.ok) throw new Error(`${response.error || "OCR failed"} [${mode}/${profile}]`);
    recordOcr(response);
    return {
      ...response,
      captureAt,
      connectionEpoch: requestedConnectionEpoch,
      generation: options.generation,
      boostEpoch: requestedBoostEpoch,
      calibrationKey: key,
      usedMicro: Boolean(options.microRect)
    };
  });
}
''',
    "capture OCR"
)

replace_between(
    'function applySnapshot(',
    'async function performFullRead',
    '''function applySnapshot(snapshot: SidebarSnapshot, sampleAt = Date.now()) {
  currentSnapshot = snapshot;
  lastFullReadAt = Date.now();
  if (snapshot.blocksMined !== undefined) {
    const accepted = updateCounter(snapshot.blocksMined, sampleAt);
    if (!accepted && lastCounter) snapshot.blocksMined = lastCounter.value;
  }
  if (snapshot.chopping?.skill) {
    lastBoostCaptureAt = sampleAt;
    applyBoostObservation(snapshot.chopping.skill, sampleAt);
  }
}
''',
    "snapshot application"
)

replace_once(
    '      const response = await captureOcr("full", profile);',
    '      const response = await captureOcr("full", profile, { workClass: "full", generation: ++fullGeneration });',
    "full capture"
)
replace_once(
    '      const snapshot = response.snapshot;\n      const score = snapshotScore(snapshot);',
    '      const snapshot = response.snapshot;\n      if (snapshot) snapshot.capturedAt = new Date(response.captureAt).toISOString();\n      const score = snapshotScore(snapshot);',
    "full timestamp"
)
replace_once(
    '        if (changed) {\n          log(`OCR calibrated to ${profile} for ${Math.round(view.width)}×${Math.round(view.height)} viewport.`);\n        }',
    '        if (changed) {\n          invalidateMicroCrops();\n          log(`OCR calibrated to ${profile} for ${Math.round(view.width)}×${Math.round(view.height)} viewport.`);\n        }',
    "profile micro reset"
)

replace_between(
    'async function readCounter()',
    'async function readBoost()',
    '''async function readCounter(): Promise<number | undefined> {
  const generation = ++counterGeneration;

  const attempt = async (profile: OcrCropProfile, forceBase = false): Promise<number | undefined> => {
    const view = await viewport();
    const key = microCalibrationKey(profile, view);
    const stored = !forceBase && counterMicroCrop?.key === key ? counterMicroCrop : undefined;
    let response = await captureOcr("counter", profile, {
      workClass: "counter",
      generation,
      microRect: stored?.rect
    });

    if (isStaleObservation(
      { connectionEpoch: response.connectionEpoch, generation: response.generation, captureAt: response.captureAt },
      connectionEpoch,
      lastAcceptedCounterGeneration,
      lastAcceptedCounterCaptureAt
    )) return undefined;

    if (!response.usedMicro && response.microRect && response.blocksMined !== undefined) {
      counterMicroCrop = { key: response.calibrationKey, rect: response.microRect };
      log("Counter micro-crop calibrated from Tesseract word geometry.");
    }

    if (response.usedMicro && response.blocksMined === undefined) {
      counterMicroCrop = undefined;
      log("Counter micro-crop was unclear; retrying the safe base crop once.", "warn");
      response = await captureOcr("counter", profile, {
        workClass: "counter",
        generation
      });
      if (!response.usedMicro && response.microRect && response.blocksMined !== undefined) {
        counterMicroCrop = { key: response.calibrationKey, rect: response.microRect };
      }
    }

    const value = response.blocksMined;
    if (value === undefined) return undefined;
    if (lastCounter && value < lastCounter.value) {
      log(`Rejected counter OCR ${value.toLocaleString()} because Blocks mined cannot decrease from ${lastCounter.value.toLocaleString()} on the same connected island.`, "warn");
      return undefined;
    }

    lastAcceptedCounterGeneration = generation;
    lastAcceptedCounterCaptureAt = response.captureAt;
    if (activeOcrProfile !== profile) {
      activeOcrProfile = profile;
      boostMicroCrop = undefined;
    }
    counterMisses = 0;
    updateCounter(value, response.captureAt);
    return value;
  };

  try {
    const initialView = await viewport();
    let profiles = orderedProfiles(initialView);
    let value = await attempt(profiles[0]);
    if (value !== undefined) return value;

    counterMisses += 1;
    if (counterMisses < 2) return undefined;

    invalidateViewportCache();
    const refreshedView = await viewport(true);
    profiles = orderedProfiles(refreshedView);
    for (const profile of profiles.slice(0, 3)) {
      value = await attempt(profile, true);
      if (value !== undefined) {
        log(`Counter crop automatically recalibrated to ${profile}.`);
        return value;
      }
    }

    counterMisses = 0;
    log("Counter OCR missed all safe crops; no full-panel OCR was forced while mining.", "warn");
    return undefined;
  } catch (error) {
    if (error instanceof OcrDeadlineError) return undefined;
    throw error;
  }
}
''',
    "counter reader"
)

replace_between(
    'async function readBoost()',
    'function applyBoostObservation',
    '''async function readBoost(workClass: OcrWorkClass = "boost-sync"): Promise<SkillStateSnapshot> {
  const generation = ++boostGeneration;
  const requestedBoostEpoch = boostStateEpoch;

  const attempt = async (profile: OcrCropProfile, forceBase = false): Promise<SkillStateSnapshot> => {
    const view = await viewport();
    const key = microCalibrationKey(profile, view);
    const stored = !forceBase && boostMicroCrop?.key === key ? boostMicroCrop : undefined;
    let response = await captureOcr("boost", profile, {
      workClass,
      generation,
      boostEpoch: requestedBoostEpoch,
      microRect: stored?.rect,
      preferFast: workClass === "boost-critical"
    });

    if (response.recognitionMethod === "fast-template") fastBoostHits += 1;
    if (response.boostEpoch !== boostStateEpoch || isStaleObservation(
      { connectionEpoch: response.connectionEpoch, generation: response.generation, captureAt: response.captureAt },
      connectionEpoch,
      lastAcceptedBoostGeneration,
      lastAcceptedBoostCaptureAt
    )) {
      log("Discarded a stale Chopping OCR result instead of letting it overwrite newer state.");
      return { state: "unknown", raw: "stale observation discarded" };
    }

    let skill = response.choppingSkill || { state: "unknown" as const };
    if (!response.usedMicro && response.microRect && skill.state !== "unknown") {
      boostMicroCrop = { key: response.calibrationKey, rect: response.microRect };
      log("Chopping micro-crop calibrated from Tesseract word geometry.");
    }

    if (response.usedMicro && skill.state === "unknown") {
      boostMicroCrop = undefined;
      log("Chopping micro-crop was unclear; retrying the safe Chopping crop once.", "warn");
      response = await captureOcr("boost", profile, {
        workClass,
        generation,
        boostEpoch: requestedBoostEpoch
      });
      skill = response.choppingSkill || { state: "unknown" as const };
      if (!response.usedMicro && response.microRect && skill.state !== "unknown") {
        boostMicroCrop = { key: response.calibrationKey, rect: response.microRect };
      }
    }

    if (skill.state === "unknown") return skill;

    const verdict = transitionVerdict({
      previous: choppingSkill,
      observed: skill,
      captureAt: response.captureAt,
      predictedReadyAt,
      boostCycleActive: Boolean(boostCycle)
    });

    lastAcceptedBoostGeneration = generation;
    lastAcceptedBoostCaptureAt = response.captureAt;
    lastBoostCaptureAt = response.captureAt;

    if (verdict === "confirm" && (skill.state === "ready" || skill.state === "active")) {
      if (pendingTransitionConfirm?.state === skill.state && response.captureAt - pendingTransitionConfirm.captureAt <= 2_000) {
        log(`Unexpected ${skill.state} transition confirmed by a second fresh read; accepting it.`);
        pendingTransitionConfirm = undefined;
        quickTransitionConfirm = false;
      } else {
        pendingTransitionConfirm = { state: skill.state, captureAt: response.captureAt };
        quickTransitionConfirm = true;
        log(`Unexpected early ${skill.state} reading; requiring one rapid confirmation before any action.`, "warn");
        return { state: "unknown", raw: `pending ${skill.state} confirmation` };
      }
    } else {
      pendingTransitionConfirm = undefined;
      quickTransitionConfirm = false;
    }

    if (activeOcrProfile !== profile) {
      activeOcrProfile = profile;
      counterMicroCrop = undefined;
    }
    boostMisses = 0;
    applyBoostObservation(skill, response.captureAt);
    return skill;
  };

  try {
    const initialView = await viewport();
    let profiles = orderedProfiles(initialView);
    let skill = await attempt(profiles[0]);
    if (skill.state !== "unknown") return skill;

    boostMisses += 1;
    invalidateViewportCache();
    const refreshedView = await viewport(true);
    profiles = orderedProfiles(refreshedView);
    for (const profile of profiles.slice(0, 3)) {
      skill = await attempt(profile, true);
      if (skill.state !== "unknown") {
        log(`Boost crop automatically recalibrated to ${profile}.`);
        return skill;
      }
    }

    boostMisses = 0;
    log("Chopping OCR unclear across safe crops; no E sent and no full-panel OCR forced.", "warn");
    return { state: "unknown" };
  } catch (error) {
    if (error instanceof OcrDeadlineError) return { state: "unknown", raw: "expired OCR work dropped" };
    throw error;
  }
}
''',
    "boost reader"
)

replace_between(
    'function applyBoostObservation',
    'function updateCounter',
    '''function applyBoostObservation(skill: SkillStateSnapshot, captureAt: number) {
  const previousPrediction = predictedReadyAt;
  if (skill.state === "cooldown" && skill.cooldownSeconds !== undefined) {
    const observedReadyAt = captureAt + skill.cooldownSeconds * 1000;
    if (previousPrediction !== undefined && previousPrediction > captureAt) {
      const drift = (observedReadyAt - previousPrediction) / 1000;
      const predictedSeconds = Math.max(0, Math.ceil((previousPrediction - captureAt) / 1000));
      if (Math.abs(drift) > 6) {
        boostDriftSeconds = drift;
        cooldownUncertaintySec = Math.min(10, Math.max(cooldownUncertaintySec, Math.abs(drift)));
        log(`Suspicious cooldown OCR: screen ${skill.cooldownSeconds}s vs predicted ${predictedSeconds}s (${drift >= 0 ? "+" : ""}${drift.toFixed(2)}s). Keeping the prior prediction.`, "warn");
        setChoppingSkill({ state: "cooldown", cooldownSeconds: predictedSeconds, raw: skill.raw });
        return;
      }
      boostDriftSeconds = drift;
      cooldownUncertaintySec = Math.max(0.5, Math.min(8, cooldownUncertaintySec * 0.6 + Math.abs(drift) * 0.8));
      if (Math.abs(drift) >= 0.5) log(`Cooldown sync: screen ${skill.cooldownSeconds}s · drift ${drift >= 0 ? "+" : ""}${drift.toFixed(2)}s → resynced.`);
    } else {
      boostDriftSeconds = undefined;
      cooldownUncertaintySec = 2;
    }
    predictedReadyAt = observedReadyAt;
    boostCooldownReadyAt = observedReadyAt;
  } else if (skill.state === "ready") {
    if (previousPrediction !== undefined) {
      boostDriftSeconds = (captureAt - previousPrediction) / 1000;
      cooldownUncertaintySec = Math.max(0.5, Math.min(8, Math.abs(boostDriftSeconds)));
    }
    predictedReadyAt = captureAt;
    boostCooldownReadyAt = captureAt;
  } else if (skill.state === "active") {
    predictedReadyAt = undefined;
    boostCooldownReadyAt = undefined;
    boostDriftSeconds = undefined;
    cooldownUncertaintySec = 2;
    nextCooldownSyncAt = 0;
  }
  setChoppingSkill(skill);
}
''',
    "boost observation"
)

replace_between(
    'function updateCounter',
    'function clearTimer',
    '''function updateCounter(value: number, sampleAt = Date.now()): boolean {
  const now = sampleAt;
  const previous = lastCounter;
  if (previous && value < previous.value) {
    log(`Rejected decreasing Blocks mined value ${value.toLocaleString()} < ${previous.value.toLocaleString()}.`, "warn");
    return false;
  }
  if (previous && now > previous.at) {
    const delta = value - previous.value;
    rollingBps = delta / ((now - previous.at) / 1000);
  }
  lastCounter = { value, at: now };
  lastCounterReadAt = now;
  if (currentSnapshot) currentSnapshot.blocksMined = value;
  if (previous && value !== previous.value) {
    const delta = value - previous.value;
    log(`Blocks mined updated: ${previous.value.toLocaleString()} → ${value.toLocaleString()} (${delta >= 0 ? "+" : ""}${delta}).`);
  }
  return true;
}
''',
    "counter validation"
)

replace_between(
    'function clearTimer',
    'async function keyE()',
    '''function clearShortTimers() {
  precisionWindowActive = false;
  quickTransitionConfirm = false;
  pendingTransitionConfirm = undefined;
  cancelAllBoostWakes();
}

function scheduleVerify(seconds = settings.verifyAfterPressSec) {
  void scheduleOffscreenWake("boost-verify", Date.now() + seconds * 1000);
}

function scheduleActiveCheck() {
  void scheduleOffscreenWake("boost-active", Date.now() + settings.activeCheckSec * 1000);
}

function scheduleRecheck(seconds = settings.readyRetrySec) {
  const actualSeconds = quickTransitionConfirm ? Math.min(seconds, 0.3) : seconds;
  quickTransitionConfirm = false;
  void scheduleOffscreenWake("boost-sync", Date.now() + actualSeconds * 1000);
}

function scheduleCounter() {
  // Live counter work remains demand-driven by the side-panel/status path.
  // There is intentionally no independent background counter OCR loop.
}
''',
    "offscreen timers"
)

replace_between(
    'function scheduleCooldown(',
    'async function syncCooldown()',
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
  void scheduleOffscreenWake("boost-sync", nextCooldownSyncAt);
  const precisionAt = Math.max(now + 50, predictedReadyAt - settings.precisionWindowSec * 1000);
  void scheduleOffscreenWake("boost-precision", precisionAt);
  void chrome.alarms.clear(BOOST_WAKE).then(() => {
    chrome.alarms.create(BOOST_WAKE, { when: Math.max(Date.now() + 1000, predictedReadyAt!) });
  });
}

function scheduleCooldown(seconds: number) {
  boostTotals.cooldownsRead = [...boostTotals.cooldownsRead, seconds].slice(-100);
  const captureAt = lastBoostCaptureAt || Date.now();
  predictedReadyAt = captureAt + seconds * 1000;
  boostCooldownReadyAt = predictedReadyAt;
  boostWakeAt = predictedReadyAt + settings.cooldownSafetySec * 1000;
  lastCooldownSyncAt = captureAt;
  precisionWindowActive = false;
  setChoppingSkill({ state: "cooldown", cooldownSeconds: seconds, raw: choppingSkill.raw });
  log(`Cooldown read: ${seconds}s at screenshot time. Adaptive sync stays at or below ${settings.cooldownSyncIntervalSec}s and tightens near Ready; predicted Ready ${new Date(predictedReadyAt).toLocaleTimeString()}.`);
  boostCycle = undefined;
  boostStateEpoch += 1;
  scheduleCooldownMonitoring();
}
''',
    "cooldown scheduling"
)

replace_between(
    'async function syncCooldown()',
    'function enterPrecisionWindow()',
    '''async function syncCooldown() {
  if (!settings.autoBoost || connectedTabId === undefined || boostFault || !predictedReadyAt) return;
  lastCooldownSyncAt = Date.now();
  const before = predictedReadyAt;
  try {
    const observed = await readBoost("boost-sync");
    if (observed.state === "ready") {
      log("Cooldown sync saw actual Ready. Activating immediately.");
      await beginBoostCycle();
      return;
    }
    if (observed.state === "active") {
      log("Cooldown sync saw Active. Waiting for the first numeric cooldown.");
      scheduleActiveCheck();
      return;
    }
    if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) {
      const adjustment = predictedReadyAt === undefined ? 0 : (predictedReadyAt - before) / 1000;
      log(`Chopping sync: screen ${observed.cooldownSeconds}s${Math.abs(adjustment) >= 0.05 ? ` · adjusted ${adjustment >= 0 ? "+" : ""}${adjustment.toFixed(2)}s` : " · matched prediction"}.`);
      scheduleCooldownMonitoring();
      return;
    }
    if (quickTransitionConfirm) {
      scheduleRecheck(0.3);
      return;
    }
    scheduleCooldownMonitoring();
  } catch (error) {
    log(`Chopping sync failed: ${errorText(error)}. Keeping the last good prediction.`, "warn");
    scheduleCooldownMonitoring();
  }
}
''',
    "cooldown sync"
)

replace_between(
    'function enterPrecisionWindow()',
    'async function beginBoostCycle()',
    '''function enterPrecisionWindow() {
  if (precisionWindowActive || !settings.autoBoost || connectedTabId === undefined || boostFault) return;
  precisionWindowActive = true;
  const remaining = predictedReadyAt ? Math.max(0, (predictedReadyAt - Date.now()) / 1000) : 0;
  log(`Precision window started at ${remaining.toFixed(2)}s predicted remaining. Blocks counter OCR is paused.`);
  void scheduleOffscreenWake("boost-precision", Date.now() + 50);
}

async function precisionBoostTick() {
  if (!precisionWindowActive || !settings.autoBoost || connectedTabId === undefined || boostFault || boostCycle) return;
  try {
    const observed = await readBoost("boost-critical");
    if (observed.state === "ready") {
      precisionWindowActive = false;
      const finishedAt = Date.now();
      log(`Actual Ready confirmed. Recognition finished ${Math.max(0, finishedAt - (lastBoostCaptureAt || finishedAt))}ms after screenshot capture.`);
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
      if (left > settings.precisionWindowSec * 1000 + 1000) {
        precisionWindowActive = false;
        log("Precision window moved back after cooldown re-sync; returning to low-overhead monitoring.");
        scheduleCooldownMonitoring();
        return;
      }
    }
  } catch (error) {
    log(`Precision Chopping OCR: ${errorText(error)}`, "warn");
  }
  if (precisionWindowActive) void scheduleOffscreenWake("boost-precision", Date.now() + 300);
}
''',
    "precision watcher"
)

replace_once(
    '    const readyAt = Date.now();\n    log(`Chopping Ready confirmed.',
    '    boostStateEpoch += 1;\n    pendingTransitionConfirm = undefined;\n    quickTransitionConfirm = false;\n    precisionWindowActive = false;\n    void cancelOffscreenWake("boost-sync");\n    void cancelOffscreenWake("boost-precision");\n    const readyAt = Date.now();\n    log(`Chopping Ready confirmed.',
    "boost action epoch"
)

replace_once(
    '    const observed = await readBoost();\n    if (observed.state === "active") {',
    '    const observed = await readBoost("boost-critical");\n    if (observed.state === "active") {',
    "verify critical read"
)

replace_once(
    '    clearTimer(verifyTimer);\n    verifyTimer = self.setTimeout(() => void verifyBoostCycle(), wait * 1000);',
    '    scheduleVerify(quickTransitionConfirm ? Math.min(wait, 0.3) : wait);',
    "verify ambiguous schedule"
)

replace_once(
    '    const observed = await readBoost();\n    if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) {',
    '    const observed = await readBoost("boost-sync");\n    if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) {',
    "active sync read"
)

# The next plain readBoost() occurrence belongs to wakeBoost.
replace_once(
    '    const observed = await readBoost();\n    if (observed.state === "ready") {\n      await beginBoostCycle();',
    '    const observed = await readBoost("boost-critical");\n    if (observed.state === "ready") {\n      await beginBoostCycle();',
    "wake critical read"
)

replace_between(
    'async function maybeArmBoostFromSnapshot()',
    'async function refreshLiveStateOnPoll()',
    '''async function maybeArmBoostFromSnapshot() {
  if (!settings.autoBoost || boostFault || boostCycle || connectedTabId === undefined) return;
  const observed = choppingSkill;
  if (observed.state === "ready") {
    const fresh = await readBoost("boost-critical");
    if (fresh.state === "ready") await beginBoostCycle();
    else if (fresh.state === "cooldown" && fresh.cooldownSeconds !== undefined) scheduleCooldown(fresh.cooldownSeconds);
    else if (fresh.state === "active") scheduleActiveCheck();
    else scheduleRecheck();
  } else if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) scheduleCooldown(observed.cooldownSeconds);
  else if (observed.state === "active") scheduleActiveCheck();
  else {
    log(`Auto Boost waiting for a clear Chopping state; rechecking in ${settings.readyRetrySec}s.`, "warn");
    scheduleRecheck();
  }
}
''',
    "fresh arm"
)

replace_between(
    'async function refreshLiveStateOnPoll()',
    'async function closeOffscreen()',
    '''async function refreshLiveStateOnPoll() {
  if (connectedTabId === undefined) return;
  if (liveRefreshFlight) return liveRefreshFlight;
  const flight = (async () => {
    const now = Date.now();

    if (settings.mode === "dumb" && !activeSession && dumbModeArmed && now - lastCounterReadAt >= 2000) {
      try { await dumbModeCounterTick(); } catch (error) { log(`Dumb mode mining detector: ${errorText(error)}`, "warn"); }
      return;
    }

    const synchronizedCooldown = settings.autoBoost && choppingSkill.state === "cooldown" && predictedReadyAt !== undefined;
    if (synchronizedCooldown && predictedReadyAt !== undefined) {
      const remainingMs = predictedReadyAt - now;
      if (remainingMs <= settings.precisionWindowSec * 1000) {
        enterPrecisionWindow();
        return;
      }
      if (nextCooldownSyncAt > 0 && now >= nextCooldownSyncAt) {
        await syncCooldown();
        return;
      }
    }

    let boostReadRan = false;
    if (settings.autoBoost && !boostFault && !boostCycle && !synchronizedCooldown && now - lastBoostReadAt >= 2500) {
      boostReadRan = true;
      try {
        const observed = await readBoost("boost-sync");
        if (observed.state === "ready") await beginBoostCycle();
        else if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) scheduleCooldown(observed.cooldownSeconds);
        else if (observed.state === "active") scheduleActiveCheck();
        else scheduleRecheck();
      } catch (error) {
        log(`Live Chopping refresh: ${errorText(error)}`, "warn");
      }
    }

    const afterBoost = Date.now();
    if (!precisionWindowActive && !boostReadRan && settings.liveCounter && afterBoost - lastCounterReadAt >= settings.counterIntervalSec * 1000) {
      try {
        const value = await readCounter();
        if (value === undefined) log("Live counter refresh did not get a number; it will retry automatically.", "warn");
      } catch (error) {
        log(`Live counter refresh: ${errorText(error)}`, "warn");
      }
    } else if (precisionWindowActive && settings.liveCounter && afterBoost - lastCounterReadAt >= settings.counterIntervalSec * 1000) {
      log("Blocks counter OCR deferred because Chopping is in the precision Ready window.");
    }
  })();
  liveRefreshFlight = flight;
  try {
    await flight;
  } finally {
    if (liveRefreshFlight === flight) liveRefreshFlight = null;
  }
}
''',
    "poll fallback"
)

replace_once(
    '  clearShortTimers();\n  void chrome.alarms.clear(BOOST_WAKE);\n  connectedTabId = undefined;',
    '  clearShortTimers();\n  void chrome.alarms.clear(BOOST_WAKE);\n  connectionEpoch += 1;\n  boostStateEpoch += 1;\n  connectedTabId = undefined;',
    "disconnect epochs"
)
replace_once(
    '  lastViewport = undefined;\n  counterMisses = 0;',
    '  lastViewport = undefined;\n  viewportCheckedAt = 0;\n  invalidateMicroCrops();\n  lastAcceptedCounterGeneration = 0;\n  lastAcceptedBoostGeneration = 0;\n  lastAcceptedCounterCaptureAt = 0;\n  lastAcceptedBoostCaptureAt = 0;\n  cooldownUncertaintySec = 2;\n  nextCooldownSyncAt = 0;\n  pendingTransitionConfirm = undefined;\n  quickTransitionConfirm = false;\n  counterMisses = 0;',
    "disconnect reliability reset"
)

replace_once(
    '  await attachOrRecover(tabId);\n  connectedTabId = tabId;',
    '  await attachOrRecover(tabId);\n  connectionEpoch += 1;\n  boostStateEpoch += 1;\n  invalidateViewportCache();\n  invalidateMicroCrops();\n  connectedTabId = tabId;',
    "connect epoch"
)
replace_once(
    '  if (settings.mode === "dumb") armDumbMode();\n  if (settings.mode === "dumb") armDumbMode();',
    '  if (settings.mode === "dumb") armDumbMode();',
    "duplicate dumb arm"
)

replace_once(
    '    startedAtMs: preset?.startedAtMs || Date.now(),',
    '    startedAtMs: preset?.startedAtMs ?? (Number.isFinite(new Date(snapshot.capturedAt).getTime()) ? new Date(snapshot.capturedAt).getTime() : Date.now()),',
    "session capture start"
)
replace_once(
    '  const endedAt = Date.now();',
    '  const capturedEndAt = new Date(endSnapshot.capturedAt).getTime();\n  const endedAt = Number.isFinite(capturedEndAt) ? capturedEndAt : Date.now();',
    "session capture end"
)

replace_once(
    '    dumbModeArmed,\n    settings,',
    '    dumbModeArmed,\n    ocrQueueDepth: ocrQueue.depth,\n    fastBoostHits,\n    boostMicroCalibrated: Boolean(boostMicroCrop),\n    counterMicroCalibrated: Boolean(counterMicroCrop),\n    settings,',
    "status reliability metrics"
)

replace_once(
    '    clearTimer(verifyTimer);\n    clearTimer(activeTimer);\n    clearTimer(recheckTimer);\n    verifyTimer = undefined;\n    activeTimer = undefined;\n    recheckTimer = undefined;\n    void chrome.alarms.clear(BOOST_WAKE);',
    '    clearShortTimers();\n    boostStateEpoch += 1;\n    void chrome.alarms.clear(BOOST_WAKE);',
    "disable boost timers"
)
replace_once(
    '        setChoppingSkill(await readBoost());',
    '        setChoppingSkill(await readBoost("boost-critical"));',
    "initial boost read"
)

replace_once(
    '      case "RECALIBRATE_OCR":\n        if (connectedTabId === undefined) throw new Error("No One Block tab is connected.");\n        activeOcrProfile = undefined;\n        counterMisses = 0;\n        boostMisses = 0;\n        await readFullSnapshot(true);',
    '      case "RECALIBRATE_OCR":\n        if (connectedTabId === undefined) throw new Error("No One Block tab is connected.");\n        connectionEpoch += 1;\n        boostStateEpoch += 1;\n        activeOcrProfile = undefined;\n        invalidateViewportCache();\n        invalidateMicroCrops();\n        lastAcceptedCounterGeneration = 0;\n        lastAcceptedBoostGeneration = 0;\n        lastAcceptedCounterCaptureAt = 0;\n        lastAcceptedBoostCaptureAt = 0;\n        counterMisses = 0;\n        boostMisses = 0;\n        if (await chrome.offscreen.hasDocument()) {\n          try { await chrome.runtime.sendMessage({ target: "offscreen", type: "RESET_CALIBRATION" } satisfies OffscreenControlRequest); } catch { /* next OCR recreates calibration */ }\n        }\n        await readFullSnapshot(true);',
    "recalibrate invalidation"
)

replace_once(
    '      case "CLEAR_BOOST_FAULT":\n        boostFault = undefined;\n        boostCycle = undefined;\n        if (settings.autoBoost && connectedTabId !== undefined) {\n          setChoppingSkill(await readBoost());',
    '      case "CLEAR_BOOST_FAULT":\n        boostFault = undefined;\n        boostCycle = undefined;\n        boostStateEpoch += 1;\n        if (settings.autoBoost && connectedTabId !== undefined) {\n          setChoppingSkill(await readBoost("boost-critical"));',
    "clear fault fresh read"
)
replace_once(
    '      case "EMERGENCY_STOP":\n        settings = { ...settings, mode: "manual", manualEnabled: false, autoBoost: false };\n        precisionWindowActive = false;\n        dumbModeArmed = false;\n        precisionWindowActive = false;\n        dumbModeArmed = false;',
    '      case "EMERGENCY_STOP":\n        settings = { ...settings, mode: "manual", manualEnabled: false, autoBoost: false };\n        precisionWindowActive = false;\n        dumbModeArmed = false;',
    "duplicate emergency reset"
)

replace_once(
    '      case "EMERGENCY_STOP":\n        settings = { ...settings, mode: "manual", manualEnabled: false, autoBoost: false };',
    '      case "OFFSCREEN_WAKE":\n        if (!settings.autoBoost || connectedTabId === undefined || boostFault) return { ok: true, status: status() };\n        if (command.id === "boost-precision") {\n          if (!precisionWindowActive) enterPrecisionWindow();\n          else await precisionBoostTick();\n        } else if (command.id === "boost-verify") {\n          await verifyBoostCycle();\n        } else if (command.id === "boost-active") {\n          await activeBoostCheck();\n        } else if (predictedReadyAt !== undefined && choppingSkill.state === "cooldown") {\n          await syncCooldown();\n        } else {\n          await wakeBoost();\n        }\n        return { ok: true, status: status() };\n      case "EMERGENCY_STOP":\n        settings = { ...settings, mode: "manual", manualEnabled: false, autoBoost: false };',
    "offscreen wake command"
)

replace_once(
    '  connectedTabId = undefined;\n  connectedUrl = undefined;\n  activeOcrProfile = undefined;\n  lastViewport = undefined;\n  clearShortTimers();',
    '  connectionEpoch += 1;\n  boostStateEpoch += 1;\n  connectedTabId = undefined;\n  connectedUrl = undefined;\n  activeOcrProfile = undefined;\n  lastViewport = undefined;\n  viewportCheckedAt = 0;\n  invalidateMicroCrops();\n  clearShortTimers();',
    "tab removed reset"
)
# Same block appears again in debugger detach after the first replacement.
replace_once(
    '  connectedTabId = undefined;\n  connectedUrl = undefined;\n  activeOcrProfile = undefined;\n  lastViewport = undefined;\n  clearShortTimers();',
    '  connectionEpoch += 1;\n  boostStateEpoch += 1;\n  connectedTabId = undefined;\n  connectedUrl = undefined;\n  activeOcrProfile = undefined;\n  lastViewport = undefined;\n  viewportCheckedAt = 0;\n  invalidateMicroCrops();\n  clearShortTimers();',
    "debugger detach reset"
)

# Any remaining bare readBoost calls are intentional checks; make them sync class explicitly.
text = text.replace('setChoppingSkill(await readBoost());', 'setChoppingSkill(await readBoost("boost-sync"));')

path.write_text(text)
print("Applied v0.3.5 background reliability patch")
