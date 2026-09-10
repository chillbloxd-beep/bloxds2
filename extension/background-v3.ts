import type { MiningSession, SidebarSnapshot, SkillStateSnapshot } from "../src/types";
import { cropRegion, isUsableSnapshot, profileOrder, snapshotScore, type OcrViewport } from "../src/extension/crop";
import { isOneBlockUrl, lobbyFromUrl } from "../src/extension/parser";
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
  OcrResponse
} from "../src/extension/types";

const SETTINGS_KEY = "oba.extension.settings";
const SESSION_KEY = "oba.extension.activeSession";
const BOOST_WAKE = "oba.boost.wake";

const DEFAULT_SETTINGS: ExtensionSettings = {
  mode: "manual",
  manualEnabled: false,
  autoBoost: false,
  liveCounter: true,
  counterIntervalSec: 10,
  verifyAfterPressSec: 3,
  activeCheckSec: 1.5,
  cooldownSafetySec: 2,
  readyRetrySec: 3,
  doubleTapGapMs: 150
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
let boostCycle: { retryUsed: boolean; confirmed: boolean; ambiguousReads: number } | undefined;
let boostTotals = {
  successfulActivations: 0,
  activationRetries: 0,
  failedActivations: 0,
  cooldownsRead: [] as number[]
};
let diagnostics: DiagnosticEntry[] = [];
let verifyTimer: number | undefined;
let activeTimer: number | undefined;
let recheckTimer: number | undefined;
let counterTimer: number | undefined;
let connectFlight: Promise<void> | null = null;
let connectingTabId: number | undefined;
let fullReadFlight: Promise<SidebarSnapshot> | null = null;
let ocrQueue: Promise<void> = Promise.resolve();
let activeOcrProfile: OcrCropProfile | undefined;
let lastViewport: OcrViewport | undefined;
let counterMisses = 0;
let boostMisses = 0;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function log(message: string, level: DiagnosticEntry["level"] = "info") {
  diagnostics = [{ at: new Date().toISOString(), level, message }, ...diagnostics].slice(0, 100);
}

async function ensureLoaded() {
  if (loaded) return;
  const stored = await chrome.storage.local.get([SETTINGS_KEY, SESSION_KEY]);
  settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
  activeSession = stored[SESSION_KEY] as ActiveExtensionSession | undefined;
  loaded = true;
}

function sanitizeSettings(next: ExtensionSettings): ExtensionSettings {
  return {
    ...next,
    counterIntervalSec: Math.min(60, Math.max(5, Number(next.counterIntervalSec) || 10)),
    verifyAfterPressSec: Math.min(10, Math.max(1, Number(next.verifyAfterPressSec) || 3)),
    activeCheckSec: Math.min(5, Math.max(0.75, Number(next.activeCheckSec) || 1.5)),
    cooldownSafetySec: Math.min(10, Math.max(0, Number(next.cooldownSafetySec) || 2)),
    readyRetrySec: Math.min(10, Math.max(1, Number(next.readyRetrySec) || 3)),
    doubleTapGapMs: Math.min(600, Math.max(75, Number(next.doubleTapGapMs) || 150))
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

function enqueueOcr<T>(task: () => Promise<T>): Promise<T> {
  const next = ocrQueue.then(task, task);
  ocrQueue = next.then(() => undefined, () => undefined);
  return next;
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

async function viewport(): Promise<OcrViewport> {
  const metrics = await debuggerCommand<any>("Page.getLayoutMetrics");
  const visual = metrics.cssVisualViewport || metrics.visualViewport || metrics.cssContentSize || metrics.contentSize;
  const width = Number(visual?.clientWidth ?? visual?.width);
  const height = Number(visual?.clientHeight ?? visual?.height);
  const pageX = Number(visual?.pageX || 0);
  const pageY = Number(visual?.pageY || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Could not determine the Bloxd game viewport size.");
  }
  lastViewport = { width, height, pageX, pageY };
  return lastViewport;
}

function orderedProfiles(view: OcrViewport): OcrCropProfile[] {
  const ordered = profileOrder(view.width, view.height);
  if (!activeOcrProfile) return ordered;
  return [activeOcrProfile, ...ordered.filter(profile => profile !== activeOcrProfile)];
}

async function captureOcr(mode: OcrMode, profile: OcrCropProfile): Promise<OcrResponse> {
  return enqueueOcr(async () => {
    await ensureOffscreen();
    const view = await viewport();
    const clip = cropRegion(profile, mode, view);
    const capture = await debuggerCommand<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      clip
    });
    if (!capture?.data) throw new Error(`Screenshot capture returned no data (${mode}/${profile}).`);

    const request: OcrRequest = {
      target: "offscreen",
      type: "OCR",
      mode,
      imageDataUrl: `data:image/png;base64,${capture.data}`
    };
    const response = await chrome.runtime.sendMessage(request) as OcrResponse;
    if (!response) throw new Error(`OCR worker returned no response (${mode}/${profile}).`);
    if (!response.ok) throw new Error(`${response.error || "OCR failed"} [${mode}/${profile}]`);
    recordOcr(response);
    return response;
  });
}

function applySnapshot(snapshot: SidebarSnapshot) {
  currentSnapshot = snapshot;
  if (snapshot.blocksMined !== undefined) updateCounter(snapshot.blocksMined);
  if (snapshot.chopping?.skill) choppingSkill = snapshot.chopping.skill;
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
      const response = await captureOcr("full", profile);
      const snapshot = response.snapshot;
      const score = snapshotScore(snapshot);
      attempted.push(`${profile}:${score}`);
      if (snapshot && (!best || score > best.score)) best = { profile, snapshot, score };
      if (isUsableSnapshot(snapshot)) {
        const changed = activeOcrProfile !== profile;
        activeOcrProfile = profile;
        applySnapshot(snapshot!);
        counterMisses = 0;
        if (changed) {
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
  const view = await viewport();
  const profiles = orderedProfiles(view);
  const primary = profiles[0];
  let response = await captureOcr("counter", primary);
  if (response.blocksMined !== undefined) {
    counterMisses = 0;
    updateCounter(response.blocksMined);
    return response.blocksMined;
  }

  counterMisses += 1;
  if (counterMisses < 2) return undefined;

  // Two consecutive misses indicate that the viewport may have changed (for
  // example the Chrome side panel was opened/closed). Try small alternate
  // crops before paying for a full-panel recalibration.
  for (const profile of profiles.slice(1)) {
    response = await captureOcr("counter", profile);
    if (response.blocksMined !== undefined) {
      activeOcrProfile = profile;
      counterMisses = 0;
      updateCounter(response.blocksMined);
      log(`Counter crop automatically recalibrated to ${profile}.`);
      return response.blocksMined;
    }
  }

  counterMisses = 0;
  const snapshot = await readFullSnapshot(true);
  return snapshot.blocksMined;
}

async function readBoost(): Promise<SkillStateSnapshot> {
  const view = await viewport();
  const profiles = orderedProfiles(view);
  let response = await captureOcr("boost", profiles[0]);
  let skill = response.choppingSkill || { state: "unknown" as const };
  if (skill.state !== "unknown") {
    boostMisses = 0;
    choppingSkill = skill;
    return skill;
  }

  boostMisses += 1;
  // Bootstrap reliability: one unknown Chopping read immediately tries the
  // alternate calibrated crops instead of leaving Auto Boost idle.
  if (boostMisses >= 1) {
    for (const profile of profiles.slice(1)) {
      response = await captureOcr("boost", profile);
      skill = response.choppingSkill || { state: "unknown" as const };
      if (skill.state !== "unknown") {
        activeOcrProfile = profile;
        boostMisses = 0;
        choppingSkill = skill;
        log(`Boost crop automatically recalibrated to ${profile}.`);
        return skill;
      }
    }

    // A full read is the final recovery path. parseChoppingFromText fails
    // closed, so neighboring Digging/Gold Ready states cannot trigger E.
    const snapshot = await readFullSnapshot(true);
    skill = snapshot.chopping?.skill || { state: "unknown" as const };
    boostMisses = 0;
  }

  choppingSkill = skill;
  return skill;
}

function updateCounter(value: number) {
  const now = Date.now();
  if (lastCounter && value >= lastCounter.value && now > lastCounter.at) {
    const delta = value - lastCounter.value;
    rollingBps = delta / ((now - lastCounter.at) / 1000);
  }
  lastCounter = { value, at: now };
  if (currentSnapshot) currentSnapshot.blocksMined = value;
}

function clearTimer(handle: number | undefined) {
  if (handle !== undefined) clearTimeout(handle);
}

function clearShortTimers() {
  clearTimer(verifyTimer);
  clearTimer(activeTimer);
  clearTimer(recheckTimer);
  clearTimer(counterTimer);
  verifyTimer = undefined;
  activeTimer = undefined;
  recheckTimer = undefined;
  counterTimer = undefined;
}

function scheduleVerify(seconds = settings.verifyAfterPressSec) {
  clearTimer(verifyTimer);
  verifyTimer = self.setTimeout(() => void verifyBoostCycle(), seconds * 1000);
}

function scheduleActiveCheck() {
  clearTimer(activeTimer);
  activeTimer = self.setTimeout(() => void activeBoostCheck(), settings.activeCheckSec * 1000);
}

function scheduleRecheck(seconds = settings.readyRetrySec) {
  clearTimer(recheckTimer);
  recheckTimer = self.setTimeout(() => void wakeBoost(), seconds * 1000);
}

function scheduleCounter() {
  clearTimer(counterTimer);
  counterTimer = undefined;
  if (connectedTabId === undefined || !settings.liveCounter) return;
  counterTimer = self.setTimeout(() => {
    void (async () => {
      try {
        await readCounter();
      } catch (error) {
        log(`Counter OCR: ${errorText(error)}`, "warn");
      } finally {
        scheduleCounter();
      }
    })();
  }, settings.counterIntervalSec * 1000);
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

async function doubleE() {
  // The side panel can own keyboard focus after the user changes a toggle.
  // Bring the already-connected Bloxd target to the front before dispatching
  // trusted DevTools-protocol key input. This does not click or move the mouse.
  await debuggerCommand("Page.bringToFront");
  await delay(60);
  await keyE();
  await delay(settings.doubleTapGapMs);
  await keyE();
  log(`Focused Bloxd and sent E ×2 (${settings.doubleTapGapMs} ms gap).`);
}

function confirmBoostSuccess() {
  if (!boostCycle?.confirmed) {
    boostTotals.successfulActivations += 1;
    if (boostCycle) boostCycle.confirmed = true;
  }
}

function scheduleCooldown(seconds: number) {
  boostTotals.cooldownsRead = [...boostTotals.cooldownsRead, seconds].slice(-100);
  const sleepFor = seconds + settings.cooldownSafetySec;
  log(`Cooldown read: ${seconds}s. Boost OCR sleeping for ${sleepFor}s.`);
  boostCycle = undefined;
  clearTimer(verifyTimer);
  clearTimer(activeTimer);
  clearTimer(recheckTimer);
  void chrome.alarms.clear(BOOST_WAKE).then(() => {
    chrome.alarms.create(BOOST_WAKE, { when: Date.now() + sleepFor * 1000 });
  });
}

async function beginBoostCycle() {
  if (!settings.autoBoost || boostFault || connectedTabId === undefined || boostCycle) return;
  boostCycle = { retryUsed: false, confirmed: false, ambiguousReads: 0 };
  try {
    await doubleE();
    scheduleVerify();
  } catch (error) {
    boostCycle = undefined;
    boostFault = `Could not send E: ${errorText(error)}`;
    log(boostFault, "error");
  }
}

async function verifyBoostCycle() {
  if (!settings.autoBoost || boostFault || connectedTabId === undefined || !boostCycle) return;
  try {
    const observed = await readBoost();
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
      if (!boostCycle.retryUsed) {
        boostCycle.retryUsed = true;
        boostTotals.activationRetries += 1;
        log("Chopping still Ready after 3s; sending the single E ×2 retry.", "warn");
        await doubleE();
        scheduleVerify();
        return;
      }
      boostTotals.failedActivations += 1;
      boostFault = "Input was not confirmed after the one allowed E ×2 retry.";
      boostCycle = undefined;
      log(boostFault, "error");
      return;
    }
    boostCycle.ambiguousReads += 1;
    const wait = boostCycle.ambiguousReads <= 2 ? 1 : settings.readyRetrySec;
    log(`Chopping OCR unclear (${boostCycle.ambiguousReads}); no key sent. Rechecking in ${wait}s.`, "warn");
    clearTimer(verifyTimer);
    verifyTimer = self.setTimeout(() => void verifyBoostCycle(), wait * 1000);
  } catch (error) {
    log(`Boost verify: ${errorText(error)}`, "warn");
    if (boostCycle) scheduleVerify(settings.readyRetrySec);
  }
}

async function activeBoostCheck() {
  if (!settings.autoBoost || boostFault || connectedTabId === undefined) return;
  try {
    const observed = await readBoost();
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
    const observed = await readBoost();
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
  if (observed.state === "ready") await beginBoostCycle();
  else if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) scheduleCooldown(observed.cooldownSeconds);
  else if (observed.state === "active") scheduleActiveCheck();
  else {
    // v0.3.0 could stop here forever when the first OCR read was unknown.
    // Keep the watcher alive without sending any input until Chopping is
    // positively identified as Ready/Active/cooldown.
    log(`Auto Boost waiting for a clear Chopping state; rechecking in ${settings.readyRetrySec}s.`, "warn");
    scheduleRecheck();
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
  connectedTabId = undefined;
  connectedUrl = undefined;
  currentSnapshot = undefined;
  choppingSkill = { state: "unknown" };
  lastCounter = undefined;
  rollingBps = undefined;
  boostCycle = undefined;
  activeOcrProfile = undefined;
  lastViewport = undefined;
  counterMisses = 0;
  boostMisses = 0;
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
  if (settings.mode === "auto") {
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

async function startSession(miningType: "active" | "afk") {
  if (connectedTabId === undefined) throw new Error("Connect to a One Block tab first.");
  if (activeSession) throw new Error("A session is already running.");
  const snapshot = await readFullSnapshot(false);
  if (snapshot.blocksMined === undefined) {
    throw new Error("Could not read Blocks mined. Keep the One Block sidebar visible and use Recalibrate OCR, then try again.");
  }

  activeSession = {
    id: crypto.randomUUID(),
    startedAtMs: Date.now(),
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
  log(`Session started at ${snapshot.blocksMined.toLocaleString()} blocks. Full sidebar snapshot saved.`);
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

  const endedAt = Date.now();
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
  return {
    ready: loaded,
    connected: connectedTabId !== undefined,
    tabId: connectedTabId,
    url: connectedUrl,
    lobby: lobbyFromUrl(connectedUrl),
    phase: currentSnapshot?.phase,
    blocksMined: lastCounter?.value ?? currentSnapshot?.blocksMined,
    rollingBps,
    choppingSkill,
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
    settings,
    currentSnapshot,
    diagnostics
  };
}

async function setSettings(patch: Partial<ExtensionSettings>) {
  const previousAutoBoost = settings.autoBoost;
  settings = sanitizeSettings({ ...settings, ...patch });
  await saveSettings();

  if (!settings.autoBoost) {
    boostFault = undefined;
    boostCycle = undefined;
    clearTimer(verifyTimer);
    clearTimer(activeTimer);
    clearTimer(recheckTimer);
    verifyTimer = undefined;
    activeTimer = undefined;
    recheckTimer = undefined;
    void chrome.alarms.clear(BOOST_WAKE);
  }

  if (settings.autoBoost && !previousAutoBoost) {
    boostFault = undefined;
    if (connectedTabId !== undefined) {
      try {
        choppingSkill = await readBoost();
      } catch (error) {
        log(`Initial boost read: ${errorText(error)}`, "warn");
      }
      await maybeArmBoostFromSnapshot();
    }
  }

  scheduleCounter();
  await reconcileConnection();
}

async function handleCommand(command: BackgroundCommand): Promise<BackgroundResponse> {
  await ensureLoaded();
  try {
    switch (command.type) {
      case "GET_STATUS":
        await reconcileConnection();
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
        activeOcrProfile = undefined;
        counterMisses = 0;
        boostMisses = 0;
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
        if (settings.autoBoost) throw new Error("Turn Auto-use Chopping skill OFF before using Test E ×2.");
        log("Manual E ×2 input diagnostic requested.");
        await doubleE();
        return { ok: true, status: status() };
      case "CLEAR_BOOST_FAULT":
        boostFault = undefined;
        boostCycle = undefined;
        if (settings.autoBoost && connectedTabId !== undefined) {
          choppingSkill = await readBoost();
          await maybeArmBoostFromSnapshot();
        }
        return { ok: true, status: status() };
      case "EMERGENCY_STOP":
        settings = { ...settings, mode: "manual", manualEnabled: false, autoBoost: false };
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
  void ensureLoaded().then(wakeBoost);
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  void ensureLoaded().then(async () => {
    const url = change.url || tab.url;
    if (connectedTabId === tabId) {
      if (!isOneBlockUrl(url)) {
        await disconnect("Connected tab left One Block.");
        if (settings.mode === "auto") await scanForOneBlock();
      } else {
        connectedUrl = url;
      }
      return;
    }

    if (settings.mode === "auto" && connectedTabId === undefined && isOneBlockUrl(url)) {
      try { await connectTab(tabId); } catch (error) { log(errorText(error), "warn"); }
    }
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void ensureLoaded().then(async () => {
    if (settings.mode === "auto" && connectedTabId === undefined) {
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
  connectedTabId = undefined;
  connectedUrl = undefined;
  activeOcrProfile = undefined;
  lastViewport = undefined;
  clearShortTimers();
  void chrome.alarms.clear(BOOST_WAKE);
  log("Connected One Block tab closed.", "warn");
  void ensureLoaded().then(async () => {
    if (settings.mode === "auto") await scanForOneBlock();
  });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId !== connectedTabId) return;
  connectedTabId = undefined;
  connectedUrl = undefined;
  activeOcrProfile = undefined;
  lastViewport = undefined;
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
