import type { MiningSession, SidebarSnapshot, SkillStateSnapshot } from "../src/types";
import { cropRegion, isUsableSnapshot, profileOrder, snapshotScore, type OcrViewport } from "../src/extension/crop";
import { isOneBlockUrl, lobbyFromUrl } from "../src/extension/parser";
import type { RelativeOcrRect } from "../src/extension/ocrCalibration";
import { OcrDeadlineError, PriorityOcrQueue, cooldownSyncDelayMs, isStaleObservation, transitionVerdict, type OcrWorkClass } from "../src/extension/reliability";
import type {
  ActiveExtensionSession,
  BackgroundCommand,
  BackgroundResponse,
  DiagnosticEntry,
  ExtensionSettings,
  LiveExtensionStatus,
  OcrCropProfile,
  OcrMode,
  OcrRequest,
  OcrResponse,
  OffscreenControlRequest,
  OffscreenWakeId
} from "../src/extension/types";

const SETTINGS_KEY = "oba.extension.settings";
const SESSION_KEY = "oba.extension.activeSession";
const BOOST_WAKE = "oba.boost.wake";

const DEFAULT_SETTINGS: ExtensionSettings = {
  mode: "manual",
  manualEnabled: false,
  autoBoost: false,
  liveCounter: true,
  counterIntervalSec: 20,
  verifyAfterPressSec: 3,
  activeCheckSec: 1.5,
  cooldownSafetySec: 2,
  readyRetrySec: 3,
  doubleTapGapMs: 150,
  cooldownSyncIntervalSec: 15,
  precisionWindowSec: 4
};

let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let loaded = false;
let connectedTabId: number | undefined;
let connectedUrl: string | undefined;
let currentSnapshot: SidebarSnapshot | undefined;
let choppingSkill: SkillStateSnapshot = { state: "unknown" };
let lastCounter: { value: number; at: number } | undefined;
let rollingBps: number | undefined;
let lastOcrConfidence: number | undefined;
let lastOcrMs: number | undefined;
let ocrReads: number[] = [];
let activeSession: ActiveExtensionSession | undefined;
let boostFault: string | undefined;
let boostCycle: { retryUsed: boolean; confirmed: boolean; ambiguousReads: number; readyConfirmReads: number } | undefined;
let boostTotals = {
  successfulActivations: 0,
  activationRetries: 0,
  failedActivations: 0,
  cooldownsRead: [] as number[]
};
let diagnostics: DiagnosticEntry[] = [];
let connectFlight: Promise<void> | null = null;
let connectingTabId: number | undefined;
let fullReadFlight: Promise<SidebarSnapshot> | null = null;
const ocrQueue = new PriorityOcrQueue();
let activeOcrProfile: OcrCropProfile | undefined;
let lastViewport: OcrViewport | undefined;
let viewportCheckedAt = 0;
let connectionEpoch = 0;
let fullGeneration = 0;
let counterGeneration = 0;
let boostGeneration = 0;
let boostStateEpoch = 0;
let lastAcceptedCounterGeneration = 0;
let lastAcceptedBoostGeneration = 0;
let lastAcceptedCounterCaptureAt = 0;
let lastAcceptedBoostCaptureAt = 0;
let boostMicroCrop: { key: string; rect: RelativeOcrRect } | undefined;
let counterMicroCrop: { key: string; rect: RelativeOcrRect } | undefined;
let fastBoostHits = 0;
let cooldownUncertaintySec = 2;
let nextCooldownSyncAt = 0;
let pendingTransitionConfirm: { state: "ready" | "active"; captureAt: number } | undefined;
let quickTransitionConfirm = false;
let counterMisses = 0;
let boostMisses = 0;
let lastCounterReadAt = 0;
let lastBoostReadAt = 0;
let lastFullReadAt = 0;
let boostCooldownReadyAt: number | undefined;
let boostWakeAt: number | undefined;
let liveRefreshFlight: Promise<void> | null = null;
let predictedReadyAt: number | undefined;
let lastBoostCaptureAt: number | undefined;
let boostDriftSeconds: number | undefined;
let lastCooldownSyncAt = 0;
let precisionWindowActive = false;
let dumbModeArmed = false;
let dumbBaseline: { value: number; at: number } | undefined;
let dumbArmSnapshot: SidebarSnapshot | undefined;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function log(message: string, level: DiagnosticEntry["level"] = "info") {
  diagnostics = [{ at: new Date().toISOString(), level, message }, ...diagnostics].slice(0, 300);
}

async function ensureLoaded() {
  if (loaded) return;
  const stored = await chrome.storage.local.get([SETTINGS_KEY, SESSION_KEY]);
  settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
  if (settings.mode === "dumb") {
    settings.autoBoost = true;
    settings.liveCounter = true;
    settings.cooldownSyncIntervalSec = 15;
  }
  activeSession = stored[SESSION_KEY] as ActiveExtensionSession | undefined;
  loaded = true;
}

function sanitizeSettings(next: ExtensionSettings): ExtensionSettings {
  return {
    ...next,
    counterIntervalSec: Math.min(180, Math.max(10, Number(next.counterIntervalSec) || 20)),
    verifyAfterPressSec: Math.min(10, Math.max(1, Number(next.verifyAfterPressSec) || 3)),
    activeCheckSec: Math.min(5, Math.max(0.75, Number(next.activeCheckSec) || 1.5)),
    cooldownSafetySec: Math.min(10, Math.max(0, Number(next.cooldownSafetySec) || 2)),
    readyRetrySec: Math.min(10, Math.max(1, Number(next.readyRetrySec) || 3)),
    doubleTapGapMs: Math.min(600, Math.max(75, Number(next.doubleTapGapMs) || 150)),
    cooldownSyncIntervalSec: Math.min(30, Math.max(5, Number(next.cooldownSyncIntervalSec) || 15)),
    precisionWindowSec: Math.min(8, Math.max(2, Number(next.precisionWindowSec) || 4))
  };
}

async function saveSettings() {
  settings = sanitizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

async function saveActiveSession() {
  if (activeSession) await chrome.storage.local.set({ [SESSION_KEY]: activeSession });
  else await chrome.storage.local.remove(SESSION_KEY);
}

function recordOcr(response: OcrResponse) {
  const now = Date.now();
  ocrReads = [...ocrReads.filter(at => now - at < 60_000), now];
  lastOcrConfidence = response.confidence;
  lastOcrMs = response.elapsedMs;
}

function microCalibrationKey(profile: OcrCropProfile, view: OcrViewport) {
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

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
    justification: "Process only small captured One Block sidebar regions locally for OCR."
  });
}

async function directDebuggerCommand<T = unknown>(tabId: number, method: string, params?: { [key: string]: unknown }): Promise<T> {
  return await chrome.debugger.sendCommand({ tabId }, method, params) as T;
}

async function debuggerCommand<T = unknown>(method: string, params?: { [key: string]: unknown }): Promise<T> {
  if (connectedTabId === undefined) throw new Error("No One Block tab is connected.");
  return await directDebuggerCommand<T>(connectedTabId, method, params);
}

async function viewport(force = false): Promise<OcrViewport> {
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

function orderedProfiles(view: OcrViewport): OcrCropProfile[] {
  const ordered = profileOrder(view.width, view.height);
  if (!activeOcrProfile) return ordered;
  return [activeOcrProfile, ...ordered.filter(profile => profile !== activeOcrProfile)];
}

type CapturedOcrResponse = OcrResponse & {
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

function skillText(skill: SkillStateSnapshot): string {
  if (skill.state === "cooldown") return `${skill.cooldownSeconds ?? "?"}s`;
  return skill.state;
}

function setChoppingSkill(skill: SkillStateSnapshot) {
  const previous = skillText(choppingSkill);
  const next = skillText(skill);
  choppingSkill = skill;
  lastBoostReadAt = Date.now();
  if (currentSnapshot) {
    currentSnapshot.chopping = { ...(currentSnapshot.chopping || {}), skill };
  }
  if (skill.state === "ready" || skill.state === "active") {
    boostCooldownReadyAt = undefined;
    boostWakeAt = undefined;
  }
  if (previous !== next) log(`Chopping state updated: ${previous} → ${next}.`);
}

function applySnapshot(snapshot: SidebarSnapshot, sampleAt = Date.now()) {
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

async function performFullRead(forceRecalibrate = false): Promise<SidebarSnapshot> {
  const view = await viewport();
  const candidates = forceRecalibrate
    ? profileOrder(view.width, view.height)
    : orderedProfiles(view);

  let best: { profile: OcrCropProfile; snapshot: SidebarSnapshot; score: number } | undefined;
  const attempted: string[] = [];

  for (const profile of candidates) {
    try {
      const response = await captureOcr("full", profile, { workClass: "full", generation: ++fullGeneration });
      const snapshot = response.snapshot;
      if (snapshot) snapshot.capturedAt = new Date(response.captureAt).toISOString();
      const score = snapshotScore(snapshot);
      attempted.push(`${profile}:${score}`);
      if (snapshot && (!best || score > best.score)) best = { profile, snapshot, score };
      if (isUsableSnapshot(snapshot)) {
        const changed = activeOcrProfile !== profile;
        activeOcrProfile = profile;
        applySnapshot(snapshot!, response.captureAt);
        counterMisses = 0;
        if (changed) {
          invalidateMicroCrops();
          log(`OCR calibrated to ${profile} for ${Math.round(view.width)}×${Math.round(view.height)} viewport.`);
        }
        return snapshot!;
      }
    } catch (error) {
      attempted.push(`${profile}:error`);
      log(`OCR ${profile} calibration attempt failed: ${errorText(error)}`, "warn");
    }
  }

  if (best) {
    activeOcrProfile = best.profile;
    applySnapshot(best.snapshot);
    log(`OCR produced a partial sidebar read (${attempted.join(", ")}). Blocks mined was not reliably located.`, "warn");
    return best.snapshot;
  }

  throw new Error(`Could not OCR the One Block sidebar. Profiles tried: ${attempted.join(", ") || "none"}.`);
}

async function readFullSnapshot(forceRecalibrate = false): Promise<SidebarSnapshot> {
  if (fullReadFlight) return fullReadFlight;
  fullReadFlight = performFullRead(forceRecalibrate).finally(() => {
    fullReadFlight = null;
  });
  return fullReadFlight;
}

async function readCounter(): Promise<number | undefined> {
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

async function readBoost(workClass: OcrWorkClass = "boost-sync"): Promise<SkillStateSnapshot> {
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

function applyBoostObservation(skill: SkillStateSnapshot, captureAt: number) {
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

function updateCounter(value: number, sampleAt = Date.now()): boolean {
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

function clearShortTimers() {
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

async function keyE() {
  await debuggerCommand("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "e",
    code: "KeyE",
    autoRepeat: false,
    windowsVirtualKeyCode: 69,
    nativeVirtualKeyCode: 69
  });
  await debuggerCommand("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "e",
    code: "KeyE",
    windowsVirtualKeyCode: 69,
    nativeVirtualKeyCode: 69
  });
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pressEBurst(count: number, label: string) {
  log(`${label}: attempting E ×${count}.`);
  await debuggerCommand("Page.bringToFront");
  try {
    await debuggerCommand("Runtime.evaluate", {
      expression: `(function(){const cs=[...document.querySelectorAll('canvas')].filter(c=>c.offsetWidth>0&&c.offsetHeight>0);const c=cs.sort((a,b)=>(b.offsetWidth*b.offsetHeight)-(a.offsetWidth*a.offsetHeight))[0];if(c){if(!c.hasAttribute('tabindex'))c.tabIndex=-1;c.focus({preventScroll:true});return 'canvas';}if(document.body){if(!document.body.hasAttribute('tabindex'))document.body.tabIndex=-1;document.body.focus({preventScroll:true});return 'body';}return 'page';})()`,
      returnByValue: true
    });
    log(`${label}: Bloxd game surface focused.`);
  } catch (error) {
    log(`${label}: focus helper failed (${errorText(error)}); continuing with page focus.`, "warn");
  }
  await delay(80);
  for (let i = 1; i <= count; i += 1) {
    log(`${label}: pressing E ${i}/${count}…`);
    await keyE();
    log(`${label}: E ${i}/${count} pressed.`);
    if (i < count) await delay(settings.doubleTapGapMs);
  }
  log(`${label}: E ×${count} completed.`);
}

function confirmBoostSuccess() {
  if (!boostCycle?.confirmed) {
    boostTotals.successfulActivations += 1;
    if (boostCycle) boostCycle.confirmed = true;
  }
}

function scheduleCooldownMonitoring() {
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

async function syncCooldown() {
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

function enterPrecisionWindow() {
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

async function beginBoostCycle() {
  if (!settings.autoBoost || boostFault || connectedTabId === undefined || boostCycle) return;
  boostCycle = { retryUsed: false, confirmed: false, ambiguousReads: 0, readyConfirmReads: 0 };
  try {
    boostStateEpoch += 1;
    pendingTransitionConfirm = undefined;
    quickTransitionConfirm = false;
    precisionWindowActive = false;
    void cancelOffscreenWake("boost-sync");
    void cancelOffscreenWake("boost-precision");
    const readyAt = Date.now();
    log(`Chopping Ready confirmed. Starting primary E ×5 activation burst${lastBoostCaptureAt ? ` (${Math.max(0, readyAt - lastBoostCaptureAt)}ms after Ready screenshot)` : ""}.`);
    await pressEBurst(5, "Primary boost input");
    const quickVerify = Math.min(0.65, settings.verifyAfterPressSec);
    log(`Primary E ×5 finished. Fast verification in ${quickVerify.toFixed(2)}s.`);
    scheduleVerify(quickVerify);
  } catch (error) {
    boostCycle = undefined;
    boostFault = `Could not send E: ${errorText(error)}`;
    log(boostFault, "error");
  }
}

async function verifyBoostCycle() {
  if (!settings.autoBoost || boostFault || connectedTabId === undefined || !boostCycle) return;
  try {
    const observed = await readBoost("boost-critical");
    if (observed.state === "active") {
      confirmBoostSuccess();
      boostCycle = undefined;
      log("Chopping boost Active confirmed.");
      scheduleActiveCheck();
      return;
    }
    if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) {
      confirmBoostSuccess();
      scheduleCooldown(observed.cooldownSeconds);
      return;
    }
    if (observed.state === "ready") {
      if (!boostCycle.retryUsed && boostCycle.readyConfirmReads < 1) {
        boostCycle.readyConfirmReads += 1;
        log("Fast verification still reads Ready; confirming once more in 0.35s before backup E ×3.", "warn");
        scheduleVerify(0.35);
        return;
      }
      if (!boostCycle.retryUsed) {
        boostCycle.retryUsed = true;
        boostTotals.activationRetries += 1;
        log("Ready confirmed twice after primary burst; starting backup E ×3 immediately.", "warn");
        await pressEBurst(3, "Backup boost input");
        log("Backup E ×3 finished. Fast verification in 0.65s.");
        scheduleVerify(0.65);
        return;
      }
      boostTotals.failedActivations += 1;
      boostFault = "Input was not confirmed after the one allowed backup E ×3 burst.";
      boostCycle = undefined;
      log(boostFault, "error");
      return;
    }
    boostCycle.ambiguousReads += 1;
    const wait = boostCycle.ambiguousReads <= 2 ? 1 : settings.readyRetrySec;
    log(`Chopping OCR unclear (${boostCycle.ambiguousReads}); no key sent. Rechecking in ${wait}s.`, "warn");
    scheduleVerify(quickTransitionConfirm ? Math.min(wait, 0.3) : wait);
  } catch (error) {
    log(`Boost verify: ${errorText(error)}`, "warn");
    if (boostCycle) scheduleVerify(settings.readyRetrySec);
  }
}

async function activeBoostCheck() {
  if (!settings.autoBoost || boostFault || connectedTabId === undefined) return;
  try {
    const observed = await readBoost("boost-sync");
    if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) {
      scheduleCooldown(observed.cooldownSeconds);
      return;
    }
    if (observed.state === "active") {
      scheduleActiveCheck();
      return;
    }
    if (observed.state === "ready") {
      await beginBoostCycle();
      return;
    }
    scheduleRecheck();
  } catch (error) {
    log(`Active boost check: ${errorText(error)}`, "warn");
    scheduleRecheck();
  }
}

async function wakeBoost() {
  if (!settings.autoBoost || boostFault || connectedTabId === undefined) return;
  try {
    const observed = await readBoost("boost-critical");
    if (observed.state === "ready") {
      await beginBoostCycle();
      return;
    }
    if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) {
      scheduleCooldown(observed.cooldownSeconds);
      return;
    }
    if (observed.state === "active") {
      scheduleActiveCheck();
      return;
    }
    log(`Cooldown wake did not read Ready; checking again in ${settings.readyRetrySec}s.`, "warn");
    scheduleRecheck();
  } catch (error) {
    log(`Boost wake: ${errorText(error)}`, "warn");
    scheduleRecheck();
  }
}

async function maybeArmBoostFromSnapshot() {
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

async function refreshLiveStateOnPoll() {
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

async function closeOffscreen() {
  if (!(await chrome.offscreen.hasDocument())) return;
  try { await chrome.offscreen.closeDocument(); } catch { /* already closed */ }
}

async function disconnect(reason = "Disconnected") {
  const tabId = connectedTabId;
  clearShortTimers();
  void chrome.alarms.clear(BOOST_WAKE);
  connectionEpoch += 1;
  boostStateEpoch += 1;
  connectedTabId = undefined;
  connectedUrl = undefined;
  currentSnapshot = undefined;
  choppingSkill = { state: "unknown" };
  lastCounter = undefined;
  rollingBps = undefined;
  boostCycle = undefined;
  activeOcrProfile = undefined;
  lastViewport = undefined;
  viewportCheckedAt = 0;
  invalidateMicroCrops();
  lastAcceptedCounterGeneration = 0;
  lastAcceptedBoostGeneration = 0;
  lastAcceptedCounterCaptureAt = 0;
  lastAcceptedBoostCaptureAt = 0;
  cooldownUncertaintySec = 2;
  nextCooldownSyncAt = 0;
  pendingTransitionConfirm = undefined;
  quickTransitionConfirm = false;
  counterMisses = 0;
  boostMisses = 0;
  lastCounterReadAt = 0;
  lastBoostReadAt = 0;
  lastFullReadAt = 0;
  boostCooldownReadyAt = undefined;
  boostWakeAt = undefined;
  predictedReadyAt = undefined;
  lastBoostCaptureAt = undefined;
  boostDriftSeconds = undefined;
  lastCooldownSyncAt = 0;
  precisionWindowActive = false;
  dumbModeArmed = false;
  dumbBaseline = undefined;
  dumbArmSnapshot = undefined;
  if (tabId !== undefined) {
    try { await chrome.debugger.detach({ tabId }); } catch { /* already detached */ }
  }
  log(reason);
  await closeOffscreen();
}

async function attachOrRecover(tabId: number) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    return;
  } catch (error) {
    const message = errorText(error);
    if (!/another debugger is already attached/i.test(message)) {
      throw new Error(`Could not attach to Bloxd: ${message}`);
    }

    // A Manifest V3 service worker can restart while its debugger session is
    // still attached. If the existing session belongs to this extension,
    // sendCommand succeeds and we can safely adopt it instead of attaching twice.
    try {
      await directDebuggerCommand(tabId, "Page.getLayoutMetrics");
      log("Recovered the existing OneBlock Analytics debugger session.");
      return;
    } catch {
      throw new Error("Bloxd already has another debugger attached. Close Chrome DevTools or the other debugging extension for this tab, then press Scan now.");
    }
  }
}

async function doConnect(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  if (!isOneBlockUrl(tab.url)) throw new Error("Open a Bloxd One Block tab first.");
  if (connectedTabId === tabId) {
    connectedUrl = tab.url;
    return;
  }
  if (connectedTabId !== undefined) await disconnect("Switching One Block tab.");

  await attachOrRecover(tabId);
  connectionEpoch += 1;
  boostStateEpoch += 1;
  invalidateViewportCache();
  invalidateMicroCrops();
  connectedTabId = tabId;
  connectedUrl = tab.url;
  boostFault = undefined;
  activeOcrProfile = undefined;
  counterMisses = 0;
  boostMisses = 0;
  log(`Connected to One Block${lobbyFromUrl(tab.url) ? ` lobby ${lobbyFromUrl(tab.url)}` : ""}.`);

  try {
    const snapshot = await readFullSnapshot(true);
    if (snapshot.blocksMined === undefined) {
      log("Connected, but the initial OCR did not find Blocks mined. Use Recalibrate OCR if the sidebar is visible.", "warn");
    }
  } catch (error) {
    log(`Initial OCR: ${errorText(error)}`, "warn");
  }

  scheduleCounter();
  await maybeArmBoostFromSnapshot();
  if (settings.mode === "dumb") armDumbMode();
}

async function connectTab(tabId: number) {
  if (connectedTabId === tabId) return;
  if (connectFlight) {
    if (connectingTabId === tabId) return connectFlight;
    try { await connectFlight; } catch { /* the next connection can still try */ }
    if (connectedTabId === tabId) return;
  }

  connectingTabId = tabId;
  const flight = doConnect(tabId);
  connectFlight = flight;
  try {
    await flight;
  } finally {
    if (connectFlight === flight) {
      connectFlight = null;
      connectingTabId = undefined;
    }
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function scanForOneBlock(preferredTabId?: number) {
  await ensureLoaded();
  if (preferredTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(preferredTabId);
      if (isOneBlockUrl(tab.url)) {
        await connectTab(preferredTabId);
        return true;
      }
    } catch { /* continue */ }
  }

  const active = await activeTab();
  if (active?.id !== undefined && isOneBlockUrl(active.url)) {
    await connectTab(active.id);
    return true;
  }

  const tabs = await chrome.tabs.query({ url: "https://bloxd.io/*" });
  const oneBlock = tabs.find(tab => tab.id !== undefined && isOneBlockUrl(tab.url));
  if (oneBlock?.id !== undefined) {
    await connectTab(oneBlock.id);
    return true;
  }
  return false;
}

async function reconcileConnection() {
  await ensureLoaded();
  if (settings.mode === "auto" || settings.mode === "dumb") {
    if (connectedTabId === undefined) await scanForOneBlock();
    return;
  }

  if (!settings.manualEnabled) {
    if (connectedTabId !== undefined) await disconnect("Manual mode switched off.");
    return;
  }

  if (connectedTabId === undefined) {
    const tab = await activeTab();
    if (tab?.id !== undefined && isOneBlockUrl(tab.url)) await connectTab(tab.id);
  }
}

async function startSession(miningType: "active" | "afk", preset?: { snapshot: SidebarSnapshot; startedAtMs: number }) {
  if (connectedTabId === undefined) throw new Error("Connect to a One Block tab first.");
  if (activeSession) throw new Error("A session is already running.");
  const snapshot = preset?.snapshot || await readFullSnapshot(false);
  if (snapshot.blocksMined === undefined) {
    throw new Error("Could not read Blocks mined. Keep the One Block sidebar visible and use Recalibrate OCR, then try again.");
  }

  activeSession = {
    id: crypto.randomUUID(),
    startedAtMs: preset?.startedAtMs ?? (Number.isFinite(new Date(snapshot.capturedAt).getTime()) ? new Date(snapshot.capturedAt).getTime() : Date.now()),
    miningType,
    startSnapshot: snapshot,
    connectionMode: settings.mode,
    lobby: lobbyFromUrl(connectedUrl),
    boostStart: {
      successfulActivations: boostTotals.successfulActivations,
      activationRetries: boostTotals.activationRetries,
      failedActivations: boostTotals.failedActivations,
      cooldownCount: boostTotals.cooldownsRead.length
    }
  };
  await saveActiveSession();
  lastCounterReadAt = 0; // Force a fresh small counter read on the next 1s UI poll.
  log(`Session started at ${snapshot.blocksMined.toLocaleString()} blocks${preset ? " (Dumb mode auto-start)" : ""}. Full sidebar snapshot saved; live counter refresh armed.`);
}

function armDumbMode() {
  if (settings.mode !== "dumb" || activeSession || connectedTabId === undefined || dumbModeArmed) return;
  const counter = lastCounter?.value ?? currentSnapshot?.blocksMined;
  if (counter === undefined) return;
  dumbArmSnapshot = currentSnapshot ? { ...currentSnapshot, blocksMined: counter } : { capturedAt: new Date().toISOString(), rawText: "", lines: [], blocksMined: counter };
  dumbBaseline = { value: counter, at: lastCounter?.at || Date.now() };
  dumbModeArmed = true;
  log(`Dumb mode armed at ${counter.toLocaleString()} blocks. Start mining and an AFK run will begin automatically.`);
}

async function dumbModeCounterTick() {
  if (settings.mode !== "dumb" || activeSession || !dumbModeArmed || connectedTabId === undefined) return false;
  const previous = dumbBaseline;
  if (!previous) { armDumbMode(); return false; }
  const value = await readCounter();
  const current = lastCounter;
  if (value === undefined || !current) return true;
  if (value > previous.value) {
    const baseSnapshot: SidebarSnapshot = dumbArmSnapshot || currentSnapshot || { capturedAt: new Date(previous.at).toISOString(), rawText: "", lines: [] };
    const startSnapshot: SidebarSnapshot = { ...baseSnapshot, blocksMined: previous.value };
    dumbModeArmed = false;
    dumbBaseline = undefined;
    log(`Dumb mode detected mining (${previous.value.toLocaleString()} → ${value.toLocaleString()}). Auto-starting AFK run from the previous counter sample.`);
    await startSession("afk", { snapshot: startSnapshot, startedAtMs: previous.at });
    return true;
  }
  dumbBaseline = { value, at: current.at };
  return true;
}

async function stopSession(): Promise<MiningSession> {
  if (!activeSession) throw new Error("No extension session is running.");
  if (connectedTabId === undefined) throw new Error("Reconnect to the same One Block game before stopping the session.");

  const endSnapshot = await readFullSnapshot(false);
  const startCounter = activeSession.startSnapshot.blocksMined;
  const endCounter = endSnapshot.blocksMined;

  if (activeSession.startSnapshot.owner && endSnapshot.owner && activeSession.startSnapshot.owner !== endSnapshot.owner) {
    throw new Error("Sidebar owner changed since the run started. The session was not saved; reconnect to the original island and retry.");
  }
  if (startCounter === undefined || endCounter === undefined) {
    throw new Error("Could not read a valid before/after Blocks mined value. The run remains active so you can recalibrate and retry.");
  }
  if (endCounter <= startCounter) {
    throw new Error("End counter is not greater than the start counter. The run remains active; retry the final read.");
  }

  const capturedEndAt = new Date(endSnapshot.capturedAt).getTime();
  const endedAt = Number.isFinite(capturedEndAt) ? capturedEndAt : Date.now();
  const durationMs = endedAt - activeSession.startedAtMs;
  const blocksMined = endCounter - startCounter;
  const boostStats = {
    successfulActivations: Math.max(0, boostTotals.successfulActivations - activeSession.boostStart.successfulActivations),
    activationRetries: Math.max(0, boostTotals.activationRetries - activeSession.boostStart.activationRetries),
    failedActivations: Math.max(0, boostTotals.failedActivations - activeSession.boostStart.failedActivations),
    cooldownsRead: boostTotals.cooldownsRead.slice(activeSession.boostStart.cooldownCount)
  };

  const session: MiningSession = {
    id: activeSession.id,
    game: "bloxd",
    implementation: "One Block",
    gameDataVersion: "2026-09",
    phase: endSnapshot.phase || activeSession.startSnapshot.phase || "Unknown",
    miningType: activeSession.miningType,
    startCounter,
    endCounter,
    blocksMined,
    durationMs,
    averageBps: blocksMined / (durationMs / 1000),
    source: "extension",
    startedAt: new Date(activeSession.startedAtMs).toISOString(),
    createdAt: new Date(endedAt).toISOString(),
    sidebarBefore: activeSession.startSnapshot,
    sidebarAfter: endSnapshot,
    boostStats,
    extensionConnectionMode: activeSession.connectionMode,
    lobby: activeSession.lobby || lobbyFromUrl(connectedUrl),
    communityOptIn: false,
    cloudStatus: "local"
  };

  activeSession = undefined;
  await saveActiveSession();
  log(`Session finished: ${blocksMined.toLocaleString()} blocks at ${session.averageBps.toFixed(5)} b/s. Final sidebar snapshot saved.`);
  return session;
}

function status(): LiveExtensionStatus {
  const now = Date.now();
  ocrReads = ocrReads.filter(at => now - at < 60_000);
  let liveChoppingSkill = choppingSkill;
  if (choppingSkill.state === "cooldown" && (predictedReadyAt !== undefined || boostCooldownReadyAt !== undefined)) {
    const readyAt = predictedReadyAt ?? boostCooldownReadyAt!;
    liveChoppingSkill = {
      ...choppingSkill,
      cooldownSeconds: Math.max(0, Math.ceil((readyAt - now) / 1000))
    };
  }
  const liveSnapshot = currentSnapshot ? { ...currentSnapshot } : undefined;
  if (liveSnapshot && liveChoppingSkill.state !== "unknown") {
    liveSnapshot.chopping = { ...(liveSnapshot.chopping || {}), skill: liveChoppingSkill };
  }
  return {
    ready: loaded,
    connected: connectedTabId !== undefined,
    tabId: connectedTabId,
    url: connectedUrl,
    lobby: lobbyFromUrl(connectedUrl),
    phase: currentSnapshot?.phase,
    blocksMined: lastCounter?.value ?? currentSnapshot?.blocksMined,
    rollingBps,
    choppingSkill: liveChoppingSkill,
    lastOcrConfidence,
    lastOcrMs,
    readsLastMinute: ocrReads.length,
    ocrProfile: activeOcrProfile,
    viewportWidth: lastViewport?.width,
    viewportHeight: lastViewport?.height,
    sessionActive: Boolean(activeSession),
    sessionStartedAt: activeSession ? new Date(activeSession.startedAtMs).toISOString() : undefined,
    sessionStartBlocks: activeSession?.startSnapshot.blocksMined,
    boostFault,
    predictedReadyAt,
    lastBoostCaptureAt,
    boostDriftSeconds,
    dumbModeArmed,
    ocrQueueDepth: ocrQueue.depth,
    fastBoostHits,
    boostMicroCalibrated: Boolean(boostMicroCrop),
    counterMicroCalibrated: Boolean(counterMicroCrop),
    settings,
    currentSnapshot: liveSnapshot,
    diagnostics
  };
}

async function setSettings(patch: Partial<ExtensionSettings>) {
  const previousAutoBoost = settings.autoBoost;
  const previousMode = settings.mode;
  settings = sanitizeSettings({ ...settings, ...patch });
  if (settings.mode === "dumb") {
    settings.autoBoost = true;
    settings.liveCounter = true;
    settings.cooldownSyncIntervalSec = 15;
  }
  await saveSettings();

  if (!settings.autoBoost) {
    boostFault = undefined;
    boostCycle = undefined;
    clearShortTimers();
    boostStateEpoch += 1;
    void chrome.alarms.clear(BOOST_WAKE);
    boostCooldownReadyAt = undefined;
    boostWakeAt = undefined;
  }

  if (settings.autoBoost && !previousAutoBoost) {
    boostFault = undefined;
    if (connectedTabId !== undefined) {
      try {
        setChoppingSkill(await readBoost("boost-critical"));
      } catch (error) {
        log(`Initial boost read: ${errorText(error)}`, "warn");
      }
      await maybeArmBoostFromSnapshot();
    }
  }

  scheduleCounter();
  await reconcileConnection();
  if (settings.mode === "dumb" && previousMode !== "dumb" && connectedTabId !== undefined && !activeSession) armDumbMode();
  if (settings.mode !== "dumb") { dumbModeArmed = false; dumbBaseline = undefined; dumbArmSnapshot = undefined; }
}

async function handleCommand(command: BackgroundCommand): Promise<BackgroundResponse> {
  await ensureLoaded();
  try {
    switch (command.type) {
      case "GET_STATUS":
        await reconcileConnection();
        await refreshLiveStateOnPoll();
        return { ok: true, status: status() };
      case "SET_SETTINGS":
        await setSettings(command.patch);
        return { ok: true, status: status() };
      case "REFRESH_FULL":
        if (connectedTabId === undefined) throw new Error("No One Block tab is connected.");
        await readFullSnapshot(false);
        return { ok: true, status: status() };
      case "RECALIBRATE_OCR":
        if (connectedTabId === undefined) throw new Error("No One Block tab is connected.");
        connectionEpoch += 1;
        boostStateEpoch += 1;
        activeOcrProfile = undefined;
        invalidateViewportCache();
        invalidateMicroCrops();
        lastAcceptedCounterGeneration = 0;
        lastAcceptedBoostGeneration = 0;
        lastAcceptedCounterCaptureAt = 0;
        lastAcceptedBoostCaptureAt = 0;
        counterMisses = 0;
        boostMisses = 0;
        if (await chrome.offscreen.hasDocument()) {
          try { await chrome.runtime.sendMessage({ target: "offscreen", type: "RESET_CALIBRATION" } satisfies OffscreenControlRequest); } catch { /* next OCR recreates calibration */ }
        }
        await readFullSnapshot(true);
        return { ok: true, status: status() };
      case "SCAN_NOW":
        if (settings.mode === "manual" && !settings.manualEnabled) {
          throw new Error("Manual mode is OFF. Switch Extension enabled ON before scanning.");
        }
        if (!(await scanForOneBlock())) throw new Error("No Bloxd One Block tab was found.");
        return { ok: true, status: status() };
      case "START_SESSION":
        await startSession(command.miningType);
        return { ok: true, status: status() };
      case "STOP_SESSION": {
        const session = await stopSession();
        return { ok: true, status: status(), session };
      }
      case "TEST_E":
        if (connectedTabId === undefined) throw new Error("No One Block tab is connected.");
        if (settings.autoBoost) throw new Error("Turn Auto-use Chopping skill OFF before using Test E ×5.");
        log("Manual E ×5 input diagnostic requested.");
        await pressEBurst(5, "Manual input test");
        return { ok: true, status: status() };
      case "CLEAR_BOOST_FAULT":
        boostFault = undefined;
        boostCycle = undefined;
        boostStateEpoch += 1;
        if (settings.autoBoost && connectedTabId !== undefined) {
          setChoppingSkill(await readBoost("boost-critical"));
          await maybeArmBoostFromSnapshot();
        }
        return { ok: true, status: status() };
      case "OFFSCREEN_WAKE":
        if (!settings.autoBoost || connectedTabId === undefined || boostFault) return { ok: true, status: status() };
        if (command.id === "boost-precision") {
          if (!precisionWindowActive) enterPrecisionWindow();
          else await precisionBoostTick();
        } else if (command.id === "boost-verify") {
          await verifyBoostCycle();
        } else if (command.id === "boost-active") {
          await activeBoostCheck();
        } else if (predictedReadyAt !== undefined && choppingSkill.state === "cooldown") {
          await syncCooldown();
        } else {
          await wakeBoost();
        }
        return { ok: true, status: status() };
      case "EMERGENCY_STOP":
        settings = { ...settings, mode: "manual", manualEnabled: false, autoBoost: false };
        precisionWindowActive = false;
        dumbModeArmed = false;
        await saveSettings();
        boostFault = undefined;
        await disconnect("Emergency stop: extension disabled.");
        return { ok: true, status: status() };
    }
  } catch (error) {
    const message = errorText(error);
    log(message, "error");
    return { ok: false, status: status(), error: message };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const command = message as BackgroundCommand;
  if (command?.target !== "background") return undefined;
  void handleCommand(command).then(sendResponse);
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== BOOST_WAKE) return;
  boostWakeAt = undefined;
  if (precisionWindowActive) {
    log("Cooldown wake alarm fired while precision watcher is already active; duplicate OCR skipped.");
    return;
  }
  log("Cooldown wake alarm fired; checking Chopping state now.");
  void ensureLoaded().then(wakeBoost);
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  void ensureLoaded().then(async () => {
    const url = change.url || tab.url;
    if (connectedTabId === tabId) {
      if (!isOneBlockUrl(url)) {
        await disconnect("Connected tab left One Block.");
        if (settings.mode === "auto" || settings.mode === "dumb") await scanForOneBlock();
      } else {
        connectedUrl = url;
      }
      return;
    }

    if ((settings.mode === "auto" || settings.mode === "dumb") && connectedTabId === undefined && isOneBlockUrl(url)) {
      try { await connectTab(tabId); } catch (error) { log(errorText(error), "warn"); }
    }
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void ensureLoaded().then(async () => {
    if ((settings.mode === "auto" || settings.mode === "dumb") && connectedTabId === undefined) {
      try { await scanForOneBlock(tabId); } catch { /* next event/status poll can retry */ }
    } else if (settings.mode === "manual" && settings.manualEnabled && connectedTabId === undefined) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (isOneBlockUrl(tab.url)) await connectTab(tabId);
      } catch { /* ignore */ }
    }
  });
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (connectedTabId !== tabId) return;
  connectionEpoch += 1;
  boostStateEpoch += 1;
  connectedTabId = undefined;
  connectedUrl = undefined;
  activeOcrProfile = undefined;
  lastViewport = undefined;
  viewportCheckedAt = 0;
  invalidateMicroCrops();
  clearShortTimers();
  void chrome.alarms.clear(BOOST_WAKE);
  log("Connected One Block tab closed.", "warn");
  void ensureLoaded().then(async () => {
    if (settings.mode === "auto" || settings.mode === "dumb") await scanForOneBlock();
  });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId !== connectedTabId) return;
  connectionEpoch += 1;
  boostStateEpoch += 1;
  connectedTabId = undefined;
  connectedUrl = undefined;
  activeOcrProfile = undefined;
  lastViewport = undefined;
  viewportCheckedAt = 0;
  invalidateMicroCrops();
  clearShortTimers();
  void chrome.alarms.clear(BOOST_WAKE);
  log(`Debugger detached (${reason}).`, "warn");
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void ensureLoaded().then(async () => {
    await saveSettings();
    await reconcileConnection();
  });
});

chrome.runtime.onStartup.addListener(() => {
  void ensureLoaded().then(reconcileConnection);
});

void ensureLoaded().then(reconcileConnection);
