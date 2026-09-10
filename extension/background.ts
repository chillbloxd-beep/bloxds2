import type { MiningSession, SidebarSnapshot, SkillStateSnapshot } from "../src/types";
import { isOneBlockUrl, lobbyFromUrl } from "../src/extension/parser";
import type {
  ActiveExtensionSession,
  BackgroundCommand,
  BackgroundResponse,
  DiagnosticEntry,
  ExtensionSettings,
  LiveExtensionStatus,
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

function log(message: string, level: DiagnosticEntry["level"] = "info") {
  diagnostics = [{ at: new Date().toISOString(), level, message }, ...diagnostics].slice(0, 80);
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

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
    justification: "Process small captured One Block sidebar regions locally for OCR."
  });
}

async function debuggerCommand<T = unknown>(method: string, params?: object): Promise<T> {
  if (connectedTabId === undefined) throw new Error("No One Block tab is connected.");
  return await chrome.debugger.sendCommand({ tabId: connectedTabId }, method, params) as T;
}

async function viewport() {
  const metrics = await debuggerCommand<any>("Page.getLayoutMetrics");
  const visual = metrics.cssVisualViewport || metrics.visualViewport || metrics.cssContentSize || metrics.contentSize;
  const width = Number(visual?.clientWidth ?? visual?.width);
  const height = Number(visual?.clientHeight ?? visual?.height);
  const pageX = Number(visual?.pageX || 0);
  const pageY = Number(visual?.pageY || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Could not determine Bloxd viewport size.");
  }
  return { width, height, pageX, pageY };
}

function region(mode: OcrMode, width: number, height: number, pageX: number, pageY: number, wide = false) {
  const normalized = wide
    ? { x: 0.60, y: 0.16, w: 0.40, h: 0.66 }
    : mode === "full"
      ? { x: 0.70, y: 0.27, w: 0.30, h: 0.54 }
      : mode === "counter"
        ? { x: 0.72, y: 0.40, w: 0.28, h: 0.15 }
        : { x: 0.72, y: 0.55, w: 0.28, h: 0.14 };
  return {
    x: pageX + width * normalized.x,
    y: pageY + height * normalized.y,
    width: width * normalized.w,
    height: height * normalized.h,
    scale: 1
  };
}

async function ocr(mode: OcrMode, wide = false): Promise<OcrResponse> {
  await ensureOffscreen();
  const view = await viewport();
  const capture = await debuggerCommand<{ data: string }>("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip: region(mode, view.width, view.height, view.pageX, view.pageY, wide)
  });
  const request: OcrRequest = {
    target: "offscreen",
    type: "OCR",
    mode,
    imageDataUrl: `data:image/png;base64,${capture.data}`
  };
  const response = await chrome.runtime.sendMessage(request) as OcrResponse;
  if (!response?.ok) throw new Error(response?.error || "OCR failed.");
  recordOcr(response);
  return response;
}

async function readFullSnapshot(): Promise<SidebarSnapshot> {
  let response = await ocr("full");
  let snapshot = response.snapshot;
  if (snapshot?.blocksMined === undefined) {
    response = await ocr("full", true);
    snapshot = response.snapshot;
  }
  if (!snapshot) throw new Error("Could not read the One Block sidebar.");
  currentSnapshot = snapshot;
  if (snapshot.blocksMined !== undefined) updateCounter(snapshot.blocksMined);
  if (snapshot.chopping?.skill) choppingSkill = snapshot.chopping.skill;
  return snapshot;
}

async function readCounter(): Promise<number | undefined> {
  const response = await ocr("counter");
  if (response.blocksMined !== undefined) {
    updateCounter(response.blocksMined);
    return response.blocksMined;
  }
  return undefined;
}

async function readBoost(): Promise<SkillStateSnapshot> {
  let response = await ocr("boost");
  let skill = response.choppingSkill || { state: "unknown" as const };
  if (skill.state === "unknown") {
    response = await ocr("full");
    skill = response.snapshot?.chopping?.skill || skill;
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
      try { await readCounter(); }
      catch (error) { log(error instanceof Error ? error.message : "Counter OCR failed.", "warn"); }
      scheduleCounter();
    })();
  }, settings.counterIntervalSec * 1000);
}

async function keyE() {
  await debuggerCommand("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "e",
    code: "KeyE",
    text: "e",
    unmodifiedText: "e",
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
  await keyE();
  await delay(settings.doubleTapGapMs);
  await keyE();
  log(`Sent E ×2 (${settings.doubleTapGapMs} ms gap).`);
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
  log(`Cooldown read: ${seconds}s. No boost OCR until ${sleepFor}s later.`);
  boostCycle = undefined;
  clearTimer(verifyTimer);
  clearTimer(activeTimer);
  clearTimer(recheckTimer);
  chrome.alarms.create(BOOST_WAKE, { when: Date.now() + sleepFor * 1000, persistAcrossSessions: false });
}

async function beginBoostCycle() {
  if (!settings.autoBoost || boostFault || connectedTabId === undefined || boostCycle) return;
  boostCycle = { retryUsed: false, confirmed: false, ambiguousReads: 0 };
  await doubleE();
  scheduleVerify();
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
        log("Still Ready after activation; sending the single E ×2 retry.", "warn");
        await doubleE();
        scheduleVerify();
        return;
      }
      boostTotals.failedActivations += 1;
      boostFault = "Input was not confirmed after the one allowed retry.";
      boostCycle = undefined;
      log(boostFault, "error");
      return;
    }
    boostCycle.ambiguousReads += 1;
    const wait = boostCycle.ambiguousReads <= 2 ? 1 : settings.readyRetrySec;
    log(`Boost OCR unclear (${boostCycle.ambiguousReads}); no key sent.`, "warn");
    clearTimer(verifyTimer);
    verifyTimer = self.setTimeout(() => void verifyBoostCycle(), wait * 1000);
  } catch (error) {
    log(error instanceof Error ? error.message : String(error), "warn");
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
    log(error instanceof Error ? error.message : String(error), "warn");
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
    scheduleRecheck();
  } catch (error) {
    log(error instanceof Error ? error.message : String(error), "warn");
    scheduleRecheck();
  }
}

async function maybeArmBoostFromSnapshot() {
  if (!settings.autoBoost || boostFault || boostCycle) return;
  const observed = choppingSkill;
  if (observed.state === "ready") await beginBoostCycle();
  else if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) scheduleCooldown(observed.cooldownSeconds);
  else if (observed.state === "active") scheduleActiveCheck();
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
  if (tabId !== undefined) {
    try { await chrome.debugger.detach({ tabId }); } catch { /* already detached */ }
  }
  log(reason);
  if (await chrome.offscreen.hasDocument()) {
    try { await chrome.offscreen.closeDocument(); } catch { /* ignore */ }
  }
}

async function connectTab(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  if (!isOneBlockUrl(tab.url)) throw new Error("Open a Bloxd One Block tab first.");
  if (connectedTabId === tabId) {
    connectedUrl = tab.url;
    return;
  }
  if (connectedTabId !== undefined) await disconnect("Switching One Block tab.");
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (error) {
    throw new Error(`Could not attach to Bloxd: ${error instanceof Error ? error.message : String(error)}`);
  }
  connectedTabId = tabId;
  connectedUrl = tab.url;
  boostFault = undefined;
  log(`Connected to One Block${lobbyFromUrl(tab.url) ? ` lobby ${lobbyFromUrl(tab.url)}` : ""}.`);
  try {
    await readFullSnapshot();
  } catch (error) {
    log(error instanceof Error ? error.message : "Initial OCR failed.", "warn");
  }
  scheduleCounter();
  await maybeArmBoostFromSnapshot();
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
  const snapshot = await readFullSnapshot();
  if (snapshot.blocksMined === undefined) throw new Error("Could not read Blocks mined. Refresh the panel and try again.");
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
  log(`Session started at ${snapshot.blocksMined.toLocaleString()} blocks.`);
}

async function stopSession(): Promise<MiningSession> {
  if (!activeSession) throw new Error("No extension session is running.");
  if (connectedTabId === undefined) throw new Error("Reconnect to the same One Block game before stopping the session.");
  const endSnapshot = await readFullSnapshot();
  const startCounter = activeSession.startSnapshot.blocksMined;
  const endCounter = endSnapshot.blocksMined;
  if (activeSession.startSnapshot.owner && endSnapshot.owner && activeSession.startSnapshot.owner !== endSnapshot.owner) {
    throw new Error("Sidebar owner changed since the run started. The session was not saved; reconnect to the original island and retry.");
  }
  if (startCounter === undefined || endCounter === undefined) throw new Error("Could not read a valid before/after Blocks mined value.");
  if (endCounter <= startCounter) throw new Error("End counter is not greater than the start counter. The session was not saved; retry the final read.");
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
  log(`Session finished: ${blocksMined.toLocaleString()} blocks at ${session.averageBps.toFixed(5)} b/s.`);
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
      try { choppingSkill = await readBoost(); } catch { /* next scheduled read can recover */ }
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
        await readFullSnapshot();
        return { ok: true, status: status() };
      case "SCAN_NOW":
        await scanForOneBlock();
        return { ok: true, status: status() };
      case "START_SESSION":
        await startSession(command.miningType);
        return { ok: true, status: status() };
      case "STOP_SESSION": {
        const session = await stopSession();
        return { ok: true, status: status(), session };
      }
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
    const message = error instanceof Error ? error.message : String(error);
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
      try { await connectTab(tabId); } catch (error) { log(error instanceof Error ? error.message : String(error), "warn"); }
    }
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void ensureLoaded().then(async () => {
    if (settings.mode === "auto" && connectedTabId === undefined) {
      try { await scanForOneBlock(tabId); } catch { /* wait for the next event */ }
    } else if (settings.mode === "manual" && settings.manualEnabled && connectedTabId === undefined) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (isOneBlockUrl(tab.url)) await connectTab(tabId);
      } catch { /* ignore */ }
    }
  });
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (connectedTabId === tabId) {
    connectedTabId = undefined;
    connectedUrl = undefined;
    clearShortTimers();
    void chrome.alarms.clear(BOOST_WAKE);
    log("Connected One Block tab closed.", "warn");
    void ensureLoaded().then(async () => {
      if (settings.mode === "auto") await scanForOneBlock();
    });
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === connectedTabId) {
    connectedTabId = undefined;
    connectedUrl = undefined;
    clearShortTimers();
    void chrome.alarms.clear(BOOST_WAKE);
    log(`Debugger detached (${reason}).`, "warn");
  }
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
