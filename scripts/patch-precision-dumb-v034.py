from pathlib import Path


def req(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise RuntimeError(f"Missing patch target: {label}")
    return text.replace(old, new, 1)

# ---------- types ----------
p = Path('src/extension/types.ts')
s = p.read_text()
s = req(s,
'export type ExtensionConnectionMode = "manual" | "auto";',
'export type ExtensionConnectionMode = "manual" | "auto" | "dumb";',
'connection mode')
s = req(s,
'  doubleTapGapMs: number;\n}',
'  doubleTapGapMs: number;\n  cooldownSyncIntervalSec: number;\n  precisionWindowSec: number;\n}',
'precision settings')
s = req(s,
'  boostFault?: string;\n  settings: ExtensionSettings;',
'  boostFault?: string;\n  predictedReadyAt?: number;\n  lastBoostCaptureAt?: number;\n  boostDriftSeconds?: number;\n  dumbModeArmed?: boolean;\n  settings: ExtensionSettings;',
'status fields')
p.write_text(s)

# ---------- background ----------
p = Path('extension/background-v3.ts')
s = p.read_text()
s = req(s,
'  doubleTapGapMs: 150\n};',
'  doubleTapGapMs: 150,\n  cooldownSyncIntervalSec: 15,\n  precisionWindowSec: 4\n};',
'default precision settings')
s = req(s,
'let boostCycle: { retryUsed: boolean; confirmed: boolean; ambiguousReads: number } | undefined;',
'let boostCycle: { retryUsed: boolean; confirmed: boolean; ambiguousReads: number; readyConfirmReads: number } | undefined;',
'boost cycle ready confirmation')
s = req(s,
'let liveRefreshFlight: Promise<void> | null = null;\n',
'let liveRefreshFlight: Promise<void> | null = null;\nlet predictedReadyAt: number | undefined;\nlet lastBoostCaptureAt: number | undefined;\nlet boostDriftSeconds: number | undefined;\nlet lastCooldownSyncAt = 0;\nlet precisionTimer: number | undefined;\nlet precisionWindowActive = false;\nlet dumbModeArmed = false;\nlet dumbBaseline: { value: number; at: number } | undefined;\nlet dumbArmSnapshot: SidebarSnapshot | undefined;\n',
'precision runtime state')

s = req(s,
'  settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };\n  activeSession = stored[SESSION_KEY] as ActiveExtensionSession | undefined;',
'  settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };\n  if (settings.mode === "dumb") {\n    settings.autoBoost = true;\n    settings.liveCounter = true;\n    settings.cooldownSyncIntervalSec = 15;\n  }\n  activeSession = stored[SESSION_KEY] as ActiveExtensionSession | undefined;',
'load dumb invariants')
s = req(s,
'    doubleTapGapMs: Math.min(600, Math.max(75, Number(next.doubleTapGapMs) || 150))\n  };',
'    doubleTapGapMs: Math.min(600, Math.max(75, Number(next.doubleTapGapMs) || 150)),\n    cooldownSyncIntervalSec: Math.min(30, Math.max(5, Number(next.cooldownSyncIntervalSec) || 15)),\n    precisionWindowSec: Math.min(8, Math.max(2, Number(next.precisionWindowSec) || 4))\n  };',
'sanitize precision settings')

# Pixel-capture timestamps: timing math must use when the screenshot was taken, not when OCR returned.
s = req(s,
'async function captureOcr(mode: OcrMode, profile: OcrCropProfile): Promise<OcrResponse> {\n  return enqueueOcr(async () => {',
'async function captureOcr(mode: OcrMode, profile: OcrCropProfile): Promise<OcrResponse & { captureAt: number }> {\n  return enqueueOcr(async () => {',
'capture return type')
s = req(s,
'    const clip = cropRegion(profile, mode, view);\n    const capture = await debuggerCommand<{ data: string }>("Page.captureScreenshot", {',
'    const clip = cropRegion(profile, mode, view);\n    const captureAt = Date.now();\n    const capture = await debuggerCommand<{ data: string }>("Page.captureScreenshot", {',
'capture timestamp')
s = req(s,
'    recordOcr(response);\n    return response;',
'    recordOcr(response);\n    return { ...response, captureAt };',
'capture timestamp return')

# Full snapshot uses its capture timestamp for the counter sample when possible.
s = req(s,
'function applySnapshot(snapshot: SidebarSnapshot) {\n  currentSnapshot = snapshot;\n  lastFullReadAt = Date.now();\n  if (snapshot.blocksMined !== undefined) updateCounter(snapshot.blocksMined);',
'function applySnapshot(snapshot: SidebarSnapshot, sampleAt = Date.now()) {\n  currentSnapshot = snapshot;\n  lastFullReadAt = Date.now();\n  if (snapshot.blocksMined !== undefined) updateCounter(snapshot.blocksMined, sampleAt);',
'apply snapshot timestamp')
s = s.replace('        applySnapshot(snapshot!);', '        applySnapshot(snapshot!, response.captureAt);')
s = s.replace('    applySnapshot(best.snapshot);', '    applySnapshot(best.snapshot);')

# Counter timing uses screenshot capture time.
s = s.replace('    updateCounter(response.blocksMined);\n    return response.blocksMined;', '    updateCounter(response.blocksMined, response.captureAt);\n    return response.blocksMined;', 1)
s = s.replace('      updateCounter(response.blocksMined);\n      log(`Counter crop automatically recalibrated to ${profile}.`);', '      updateCounter(response.blocksMined, response.captureAt);\n      log(`Counter crop automatically recalibrated to ${profile}.`);', 1)
s = req(s,
'function updateCounter(value: number) {\n  const now = Date.now();',
'function updateCounter(value: number, sampleAt = Date.now()) {\n  const now = sampleAt;',
'counter capture time')

# Chopping reads carry capture time and synchronize an absolute predicted ready timestamp.
old = '''  let response = await captureOcr("boost", profiles[0]);\n  let skill = response.choppingSkill || { state: "unknown" as const };\n  if (skill.state !== "unknown") {\n    boostMisses = 0;\n    setChoppingSkill(skill);\n    return skill;\n  }'''
new = '''  let response = await captureOcr("boost", profiles[0]);\n  lastBoostCaptureAt = response.captureAt;\n  let skill = response.choppingSkill || { state: "unknown" as const };\n  if (skill.state !== "unknown") {\n    boostMisses = 0;\n    applyBoostObservation(skill, response.captureAt);\n    return skill;\n  }'''
s = req(s, old, new, 'primary boost observation')
s = req(s,
'        boostMisses = 0;\n        setChoppingSkill(skill);\n        log(`Boost crop automatically recalibrated to ${profile}.`);',
'        boostMisses = 0;\n        lastBoostCaptureAt = response.captureAt;\n        applyBoostObservation(skill, response.captureAt);\n        log(`Boost crop automatically recalibrated to ${profile}.`);',
'alternate boost observation')
s = req(s,
'  setChoppingSkill(skill);\n  return skill;\n}\n\nfunction updateCounter',
'  applyBoostObservation(skill, lastBoostCaptureAt || Date.now());\n  return skill;\n}\n\nfunction applyBoostObservation(skill: SkillStateSnapshot, captureAt: number) {\n  const previousPrediction = predictedReadyAt;\n  if (skill.state === "cooldown" && skill.cooldownSeconds !== undefined) {\n    const observedReadyAt = captureAt + skill.cooldownSeconds * 1000;\n    if (previousPrediction !== undefined && previousPrediction > captureAt) {\n      const drift = (observedReadyAt - previousPrediction) / 1000;\n      const predictedSeconds = Math.max(0, Math.ceil((previousPrediction - captureAt) / 1000));\n      if (Math.abs(drift) > 6) {\n        boostDriftSeconds = drift;\n        log(`Suspicious cooldown OCR: screen ${skill.cooldownSeconds}s vs predicted ${predictedSeconds}s (${drift >= 0 ? "+" : ""}${drift.toFixed(2)}s). Keeping the prior prediction.`, "warn");\n        setChoppingSkill({ state: "cooldown", cooldownSeconds: predictedSeconds, raw: skill.raw });\n        return;\n      }\n      boostDriftSeconds = drift;\n      if (Math.abs(drift) >= 0.5) log(`Cooldown sync: screen ${skill.cooldownSeconds}s · drift ${drift >= 0 ? "+" : ""}${drift.toFixed(2)}s → resynced.`);\n    } else {\n      boostDriftSeconds = undefined;\n    }\n    predictedReadyAt = observedReadyAt;\n    boostCooldownReadyAt = observedReadyAt;\n  } else if (skill.state === "ready") {\n    if (previousPrediction !== undefined) boostDriftSeconds = (captureAt - previousPrediction) / 1000;\n    predictedReadyAt = captureAt;\n    boostCooldownReadyAt = captureAt;\n  } else if (skill.state === "active") {\n    predictedReadyAt = undefined;\n    boostCooldownReadyAt = undefined;\n    boostDriftSeconds = undefined;\n  }\n  setChoppingSkill(skill);\n}\n\nfunction updateCounter',
'boost synchronization helper')

# Extra timer cleanup.
s = req(s,
'  clearTimer(counterTimer);\n  verifyTimer = undefined;',
'  clearTimer(counterTimer);\n  clearTimer(precisionTimer);\n  verifyTimer = undefined;',
'timer cleanup add precision')
s = req(s,
'  counterTimer = undefined;\n}',
'  counterTimer = undefined;\n  precisionTimer = undefined;\n  precisionWindowActive = false;\n}',
'timer cleanup state')

# Precision cooldown scheduler replaces long blind sleep. 15s tiny reads keep prediction aligned,
# final window does rapid tiny Chopping-only reads; no counter OCR can run in that window.
old_cooldown = '''function scheduleCooldown(seconds: number) {\n  boostTotals.cooldownsRead = [...boostTotals.cooldownsRead, seconds].slice(-100);\n  const now = Date.now();\n  const sleepFor = seconds + settings.cooldownSafetySec;\n  boostCooldownReadyAt = now + seconds * 1000;\n  boostWakeAt = now + sleepFor * 1000;\n  setChoppingSkill({ state: "cooldown", cooldownSeconds: seconds, raw: choppingSkill.raw });\n  log(`Cooldown read: ${seconds}s. Local countdown is live; boost OCR sleeps until ${new Date(boostWakeAt).toLocaleTimeString()}.`);\n  boostCycle = undefined;\n  clearTimer(verifyTimer);\n  clearTimer(activeTimer);\n  clearTimer(recheckTimer);\n  void chrome.alarms.clear(BOOST_WAKE).then(() => {\n    chrome.alarms.create(BOOST_WAKE, { when: boostWakeAt! });\n  });\n}\n'''
new_cooldown = '''function scheduleCooldown(seconds: number) {\n  boostTotals.cooldownsRead = [...boostTotals.cooldownsRead, seconds].slice(-100);\n  const captureAt = lastBoostCaptureAt || Date.now();\n  predictedReadyAt = captureAt + seconds * 1000;\n  boostCooldownReadyAt = predictedReadyAt;\n  boostWakeAt = predictedReadyAt + settings.cooldownSafetySec * 1000;\n  lastCooldownSyncAt = captureAt;\n  precisionWindowActive = false;\n  setChoppingSkill({ state: "cooldown", cooldownSeconds: seconds, raw: choppingSkill.raw });\n  log(`Cooldown read: ${seconds}s at screenshot time. Tiny Chopping sync every ${settings.cooldownSyncIntervalSec}s; predicted Ready ${new Date(predictedReadyAt).toLocaleTimeString()}.`);\n  boostCycle = undefined;\n  clearTimer(verifyTimer);\n  clearTimer(activeTimer);\n  clearTimer(recheckTimer);\n  clearTimer(precisionTimer);\n  void chrome.alarms.clear(BOOST_WAKE).then(() => {\n    chrome.alarms.create(BOOST_WAKE, { when: Math.max(Date.now() + 1000, predictedReadyAt!) });\n  });\n}\n\nasync function syncCooldown() {\n  if (!settings.autoBoost || connectedTabId === undefined || boostFault || !predictedReadyAt) return;\n  lastCooldownSyncAt = Date.now();\n  const before = predictedReadyAt;\n  try {\n    const observed = await readBoost();\n    if (observed.state === "ready") {\n      log("Cooldown sync saw actual Ready. Activating immediately.");\n      await beginBoostCycle();\n      return;\n    }\n    if (observed.state === "active") {\n      log("Cooldown sync saw Active. Waiting for the first numeric cooldown.");\n      scheduleActiveCheck();\n      return;\n    }\n    if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) {\n      const adjustment = predictedReadyAt === undefined ? 0 : (predictedReadyAt - before) / 1000;\n      log(`15s Chopping sync: screen ${observed.cooldownSeconds}s${Math.abs(adjustment) >= 0.05 ? ` · adjusted ${adjustment >= 0 ? "+" : ""}${adjustment.toFixed(2)}s` : " · matched prediction"}.`);\n    }\n  } catch (error) {\n    log(`15s Chopping sync failed: ${errorText(error)}. Keeping the last good prediction.`, "warn");\n  }\n}\n\nfunction enterPrecisionWindow() {\n  if (precisionWindowActive || !settings.autoBoost || connectedTabId === undefined || boostFault) return;\n  precisionWindowActive = true;\n  clearTimer(precisionTimer);\n  const remaining = predictedReadyAt ? Math.max(0, (predictedReadyAt - Date.now()) / 1000) : 0;\n  log(`Precision window started at ${remaining.toFixed(2)}s predicted remaining. Blocks counter OCR is paused.`);\n  const tick = async () => {\n    if (!precisionWindowActive || !settings.autoBoost || connectedTabId === undefined || boostFault || boostCycle) return;\n    try {\n      const observed = await readBoost();\n      if (observed.state === "ready") {\n        precisionWindowActive = false;\n        const finishedAt = Date.now();\n        log(`Actual Ready confirmed. Recognition finished ${Math.max(0, finishedAt - (lastBoostCaptureAt || finishedAt))}ms after screenshot capture.`);\n        await beginBoostCycle();\n        return;\n      }\n      if (observed.state === "active") {\n        precisionWindowActive = false;\n        scheduleActiveCheck();\n        return;\n      }\n      if (observed.state === "cooldown" && predictedReadyAt !== undefined) {\n        const left = predictedReadyAt - Date.now();\n        if (left > settings.precisionWindowSec * 1000 + 1000) {\n          precisionWindowActive = false;\n          log("Precision window moved back after cooldown re-sync; returning to low-overhead monitoring.");\n          return;\n        }\n      }\n    } catch (error) {\n      log(`Precision Chopping OCR: ${errorText(error)}`, "warn");\n    }\n    precisionTimer = self.setTimeout(() => void tick(), 450);\n  };\n  precisionTimer = self.setTimeout(() => void tick(), 50);\n}\n'''
s = req(s, old_cooldown, new_cooldown, 'cooldown precision scheduler')

# Faster E verification, with a rapid second Ready confirmation before backup E×3.
s = req(s,
'  boostCycle = { retryUsed: false, confirmed: false, ambiguousReads: 0 };',
'  boostCycle = { retryUsed: false, confirmed: false, ambiguousReads: 0, readyConfirmReads: 0 };',
'boost cycle init')
s = req(s,
'    log("Chopping Ready confirmed. Starting primary E ×5 activation burst.");\n    await pressEBurst(5, "Primary boost input");\n    log(`Primary E ×5 finished. Verifying Chopping state in ${settings.verifyAfterPressSec}s.`);\n    scheduleVerify();',
'    const readyAt = Date.now();\n    log(`Chopping Ready confirmed. Starting primary E ×5 activation burst${lastBoostCaptureAt ? ` (${Math.max(0, readyAt - lastBoostCaptureAt)}ms after Ready screenshot)` : ""}.`);\n    await pressEBurst(5, "Primary boost input");\n    const quickVerify = Math.min(0.65, settings.verifyAfterPressSec);\n    log(`Primary E ×5 finished. Fast verification in ${quickVerify.toFixed(2)}s.`);\n    scheduleVerify(quickVerify);',
'fast primary verification')
old_ready_retry = '''    if (observed.state === "ready") {\n      if (!boostCycle.retryUsed) {\n        boostCycle.retryUsed = true;\n        boostTotals.activationRetries += 1;\n        log(`Chopping still Ready after ${settings.verifyAfterPressSec}s; starting backup E ×3 burst.`, "warn");\n        await pressEBurst(3, "Backup boost input");\n        log(`Backup E ×3 finished. Verifying again in ${settings.verifyAfterPressSec}s.`);\n        scheduleVerify();\n        return;\n      }'''
new_ready_retry = '''    if (observed.state === "ready") {\n      if (!boostCycle.retryUsed && boostCycle.readyConfirmReads < 1) {\n        boostCycle.readyConfirmReads += 1;\n        log("Fast verification still reads Ready; confirming once more in 0.35s before backup E ×3.", "warn");\n        scheduleVerify(0.35);\n        return;\n      }\n      if (!boostCycle.retryUsed) {\n        boostCycle.retryUsed = true;\n        boostTotals.activationRetries += 1;\n        log("Ready confirmed twice after primary burst; starting backup E ×3 immediately.", "warn");\n        await pressEBurst(3, "Backup boost input");\n        log("Backup E ×3 finished. Fast verification in 0.65s.");\n        scheduleVerify(0.65);\n        return;\n      }'''
s = req(s, old_ready_retry, new_ready_retry, 'fast backup confirmation')

# Dumb mode session creation from the previous tiny-counter sample: catches the first blocks while
# bounding start-time error to the short arming sample interval and avoids a full OCR mid-mining.
s = req(s,
'async function startSession(miningType: "active" | "afk") {\n  if (connectedTabId === undefined) throw new Error("Connect to a One Block tab first.");\n  if (activeSession) throw new Error("A session is already running.");\n  const snapshot = await readFullSnapshot(false);',
'async function startSession(miningType: "active" | "afk", preset?: { snapshot: SidebarSnapshot; startedAtMs: number }) {\n  if (connectedTabId === undefined) throw new Error("Connect to a One Block tab first.");\n  if (activeSession) throw new Error("A session is already running.");\n  const snapshot = preset?.snapshot || await readFullSnapshot(false);',
'start session preset')
s = req(s,
'    startedAtMs: Date.now(),',
'    startedAtMs: preset?.startedAtMs || Date.now(),',
'preset start time')
s = req(s,
'  log(`Session started at ${snapshot.blocksMined.toLocaleString()} blocks. Full sidebar snapshot saved; live counter refresh armed.`);\n}',
'  log(`Session started at ${snapshot.blocksMined.toLocaleString()} blocks${preset ? " (Dumb mode auto-start)" : ""}. Full sidebar snapshot saved; live counter refresh armed.`);\n}\n\nfunction armDumbMode() {\n  if (settings.mode !== "dumb" || activeSession || connectedTabId === undefined) return;\n  const counter = lastCounter?.value ?? currentSnapshot?.blocksMined;\n  if (counter === undefined) return;\n  dumbArmSnapshot = currentSnapshot ? { ...currentSnapshot, blocksMined: counter } : { blocksMined: counter };\n  dumbBaseline = { value: counter, at: lastCounter?.at || Date.now() };\n  dumbModeArmed = true;\n  log(`Dumb mode armed at ${counter.toLocaleString()} blocks. Start mining and an AFK run will begin automatically.`);\n}\n\nasync function dumbModeCounterTick() {\n  if (settings.mode !== "dumb" || activeSession || !dumbModeArmed || connectedTabId === undefined) return false;\n  const previous = dumbBaseline;\n  if (!previous) { armDumbMode(); return false; }\n  const value = await readCounter();\n  const current = lastCounter;\n  if (value === undefined || !current) return true;\n  if (value > previous.value) {\n    const startSnapshot: SidebarSnapshot = { ...(dumbArmSnapshot || currentSnapshot || {}), blocksMined: previous.value };\n    dumbModeArmed = false;\n    dumbBaseline = undefined;\n    log(`Dumb mode detected mining (${previous.value.toLocaleString()} → ${value.toLocaleString()}). Auto-starting AFK run from the previous counter sample.`);\n    await startSession("afk", { snapshot: startSnapshot, startedAtMs: previous.at });\n    return true;\n  }\n  dumbBaseline = { value, at: current.at };\n  return true;\n}',
'dumb mode helpers')

# Connection/disconnection resets and arms dumb mode.
s = req(s,
'  boostWakeAt = undefined;\n  if (tabId !== undefined) {',
'  boostWakeAt = undefined;\n  predictedReadyAt = undefined;\n  lastBoostCaptureAt = undefined;\n  boostDriftSeconds = undefined;\n  lastCooldownSyncAt = 0;\n  precisionWindowActive = false;\n  dumbModeArmed = false;\n  dumbBaseline = undefined;\n  dumbArmSnapshot = undefined;\n  if (tabId !== undefined) {',
'disconnect resets')
s = req(s,
'  scheduleCounter();\n  await maybeArmBoostFromSnapshot();',
'  scheduleCounter();\n  await maybeArmBoostFromSnapshot();\n  if (settings.mode === "dumb") armDumbMode();',
'connect arms dumb')

# Auto/dumb connection behavior.
s = s.replace('  if (settings.mode === "auto") {', '  if (settings.mode === "auto" || settings.mode === "dumb") {', 1)
s = s.replace('        if (settings.mode === "auto") await scanForOneBlock();', '        if (settings.mode === "auto" || settings.mode === "dumb") await scanForOneBlock();')
s = s.replace('    if (settings.mode === "auto" && connectedTabId === undefined && isOneBlockUrl(url)) {', '    if ((settings.mode === "auto" || settings.mode === "dumb") && connectedTabId === undefined && isOneBlockUrl(url)) {')
s = s.replace('    if (settings.mode === "auto" && connectedTabId === undefined) {', '    if ((settings.mode === "auto" || settings.mode === "dumb") && connectedTabId === undefined) {')
s = s.replace('    if (settings.mode === "auto") await scanForOneBlock();', '    if (settings.mode === "auto" || settings.mode === "dumb") await scanForOneBlock();')

# Poll orchestration: Dumb arming gets a tiny counter read ~2s until mining starts. During a
# synchronized cooldown, 15s Chopping sync and precision window own boost reads. Counter never
# competes with the precision window.
old_refresh = '''async function refreshLiveStateOnPoll() {\n  if (connectedTabId === undefined) return;\n  if (liveRefreshFlight) return liveRefreshFlight;\n  const flight = (async () => {\n    const now = Date.now();\n    const boostSleeping = boostWakeAt !== undefined && now < boostWakeAt;\n    let boostReadRan = false;\n\n    if (settings.autoBoost && !boostFault && !boostCycle && !boostSleeping && now - lastBoostReadAt >= 2000) {\n      boostReadRan = true;\n      try {\n        const observed = await readBoost();\n        if (observed.state === "ready") await beginBoostCycle();\n        else if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) scheduleCooldown(observed.cooldownSeconds);\n        else if (observed.state === "active") scheduleActiveCheck();\n        else scheduleRecheck();\n      } catch (error) {\n        log(`Live Chopping refresh: ${errorText(error)}`, "warn");\n      }\n    }\n\n    const afterBoost = Date.now();\n    if (!boostReadRan && settings.liveCounter && afterBoost - lastCounterReadAt >= settings.counterIntervalSec * 1000) {\n      try {\n        const value = await readCounter();\n        if (value === undefined) log("Live counter refresh did not get a number; it will retry automatically.", "warn");\n      } catch (error) {\n        log(`Live counter refresh: ${errorText(error)}`, "warn");\n      }\n    }\n\n    // No automatic full-panel OCR while mining. Full sidebar snapshots are\n    // limited to connect, run start/end, and explicit Refresh/Recalibrate.\n  })();'''
new_refresh = '''async function refreshLiveStateOnPoll() {\n  if (connectedTabId === undefined) return;\n  if (liveRefreshFlight) return liveRefreshFlight;\n  const flight = (async () => {\n    const now = Date.now();\n\n    if (settings.mode === "dumb" && !activeSession && dumbModeArmed && now - lastCounterReadAt >= 2000) {\n      try { await dumbModeCounterTick(); } catch (error) { log(`Dumb mode mining detector: ${errorText(error)}`, "warn"); }\n      return;\n    }\n\n    const synchronizedCooldown = settings.autoBoost && choppingSkill.state === "cooldown" && predictedReadyAt !== undefined;\n    if (synchronizedCooldown && predictedReadyAt !== undefined) {\n      const remainingMs = predictedReadyAt - now;\n      if (remainingMs <= settings.precisionWindowSec * 1000) {\n        enterPrecisionWindow();\n        return;\n      }\n      if (now - lastCooldownSyncAt >= settings.cooldownSyncIntervalSec * 1000) {\n        await syncCooldown();\n        return;\n      }\n    }\n\n    let boostReadRan = false;\n    if (settings.autoBoost && !boostFault && !boostCycle && !synchronizedCooldown && now - lastBoostReadAt >= 2000) {\n      boostReadRan = true;\n      try {\n        const observed = await readBoost();\n        if (observed.state === "ready") await beginBoostCycle();\n        else if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) scheduleCooldown(observed.cooldownSeconds);\n        else if (observed.state === "active") scheduleActiveCheck();\n        else scheduleRecheck();\n      } catch (error) {\n        log(`Live Chopping refresh: ${errorText(error)}`, "warn");\n      }\n    }\n\n    const afterBoost = Date.now();\n    if (!precisionWindowActive && !boostReadRan && settings.liveCounter && afterBoost - lastCounterReadAt >= settings.counterIntervalSec * 1000) {\n      try {\n        const value = await readCounter();\n        if (value === undefined) log("Live counter refresh did not get a number; it will retry automatically.", "warn");\n      } catch (error) {\n        log(`Live counter refresh: ${errorText(error)}`, "warn");\n      }\n    } else if (precisionWindowActive && settings.liveCounter && afterBoost - lastCounterReadAt >= settings.counterIntervalSec * 1000) {\n      log("Blocks counter OCR deferred because Chopping is in the precision Ready window.");\n    }\n  })();'''
s = req(s, old_refresh, new_refresh, 'refresh orchestration')

# Status uses absolute ready prediction and exposes timing diagnostics.
s = req(s,
'  if (choppingSkill.state === "cooldown" && boostCooldownReadyAt !== undefined) {\n    liveChoppingSkill = {\n      ...choppingSkill,\n      cooldownSeconds: Math.max(0, Math.ceil((boostCooldownReadyAt - now) / 1000))\n    };\n  }',
'  if (choppingSkill.state === "cooldown" && (predictedReadyAt !== undefined || boostCooldownReadyAt !== undefined)) {\n    const readyAt = predictedReadyAt ?? boostCooldownReadyAt!;\n    liveChoppingSkill = {\n      ...choppingSkill,\n      cooldownSeconds: Math.max(0, Math.ceil((readyAt - now) / 1000))\n    };\n  }',
'live countdown prediction')
s = req(s,
'    boostFault,\n    settings,',
'    boostFault,\n    predictedReadyAt,\n    lastBoostCaptureAt,\n    boostDriftSeconds,\n    dumbModeArmed,\n    settings,',
'status diagnostics')

# Setting Dumb forces the simple bundle of behavior and arms the detector after connection.
s = req(s,
'async function setSettings(patch: Partial<ExtensionSettings>) {\n  const previousAutoBoost = settings.autoBoost;\n  settings = sanitizeSettings({ ...settings, ...patch });\n  await saveSettings();',
'async function setSettings(patch: Partial<ExtensionSettings>) {\n  const previousAutoBoost = settings.autoBoost;\n  const previousMode = settings.mode;\n  settings = sanitizeSettings({ ...settings, ...patch });\n  if (settings.mode === "dumb") {\n    settings.autoBoost = true;\n    settings.liveCounter = true;\n    settings.cooldownSyncIntervalSec = 15;\n  }\n  await saveSettings();',
'settings dumb invariant')
s = req(s,
'  scheduleCounter();\n  await reconcileConnection();\n}',
'  scheduleCounter();\n  await reconcileConnection();\n  if (settings.mode === "dumb" && previousMode !== "dumb" && connectedTabId !== undefined && !activeSession) armDumbMode();\n  if (settings.mode !== "dumb") { dumbModeArmed = false; dumbBaseline = undefined; dumbArmSnapshot = undefined; }\n}',
'settings dumb arm')

# Emergency stop exits Dumb too and clears precision state.
s = req(s,
'        settings = { ...settings, mode: "manual", manualEnabled: false, autoBoost: false };',
'        settings = { ...settings, mode: "manual", manualEnabled: false, autoBoost: false };\n        precisionWindowActive = false;\n        dumbModeArmed = false;',
'emergency reset')

p.write_text(s)

# ---------- live UI ----------
p = Path('src/views/LiveExtension.tsx')
s = p.read_text()
s = req(s,
'function elapsed(startedAt?: string) {',
'function formatRate6(value?: number) {\n  if (value === undefined || !Number.isFinite(value)) return "—";\n  if (value === 0) return "0.00000";\n  return value.toPrecision(6);\n}\n\nfunction elapsed(startedAt?: string) {',
'6sf rate formatter')
s = req(s,
'<Metric label="Rolling speed" value={formatRate(status.rollingBps)} suffix=" b/s" />',
'<Metric label="Rolling speed" value={formatRate6(status.rollingBps)} suffix=" b/s" />',
'rolling 6sf')

# Three connection modes.
s = req(s,
'          <button className={settings.mode === "auto" ? "active" : ""} onClick={() => void patch({ mode: "auto" })}>Auto</button>\n        </div>',
'          <button className={settings.mode === "auto" ? "active" : ""} onClick={() => void patch({ mode: "auto" })}>Auto</button>\n          <button className={settings.mode === "dumb" ? "active" : ""} onClick={() => void patch({ mode: "dumb" })}>Dumb</button>\n        </div>',
'dumb mode button')
s = req(s,
'      {settings.mode === "auto" && <div className="mode-note">Auto detection is enabled. The extension connects when it sees <span className="mono">bloxd.io/play/oneBlock</span>; the <span className="mono">?lobby=</span> value does not affect detection.</div>}\n',
'      {(settings.mode === "auto" || settings.mode === "dumb") && <div className="mode-note">Auto detection is enabled. The extension connects when it sees <span className="mono">bloxd.io/play/oneBlock</span>; the <span className="mono">?lobby=</span> value does not affect detection.</div>}\n      {settings.mode === "dumb" && <div className="mode-note"><strong>Dumb mode:</strong> Auto connection + Auto Chopping + 15s cooldown synchronization + live counter. {status.sessionActive ? "AFK run is recording." : status.dumbModeArmed ? "Start mining; the AFK run will auto-start from the previous counter sample." : "Arming mining detector…"}</div>}\n',
'dumb mode note')

# Run capture: in Dumb mode, auto-start only; finish remains manual.
old_run = '''        {!status.sessionActive ? <>\n          <label className="field"><span>Run type</span><select value={miningType} onChange={event => setMiningType(event.target.value as MiningType)}><option value="active">Active</option><option value="afk">AFK</option></select></label>\n          <button className="primary-button full" disabled={busy || !status.connected} onClick={() => void run(() => command({ target: "background", type: "START_SESSION", miningType }))}>Start run + capture sidebar</button>\n        </> : <button className="primary-button full" disabled={busy || !status.connected} onClick={() => void finishSession()}>Finish run + capture sidebar</button>}'''
new_run = '''        {!status.sessionActive ? settings.mode === "dumb" ? <div className="mode-note"><strong>Automatic AFK recording armed.</strong> Start mining normally. A tiny counter check detects the first increase and starts the run automatically; no full OCR is triggered mid-mining.</div> : <>\n          <label className="field"><span>Run type</span><select value={miningType} onChange={event => setMiningType(event.target.value as MiningType)}><option value="active">Active</option><option value="afk">AFK</option></select></label>\n          <button className="primary-button full" disabled={busy || !status.connected} onClick={() => void run(() => command({ target: "background", type: "START_SESSION", miningType }))}>Start run + capture sidebar</button>\n        </> : <button className="primary-button full" disabled={busy || !status.connected} onClick={() => void finishSession()}>Finish run + capture sidebar</button>}'''
s = req(s, old_run, new_run, 'dumb run capture')

# Forced toggles in Dumb mode.
s = req(s,
'<input type="checkbox" checked={settings.autoBoost} onChange={event => void patch({ autoBoost: event.target.checked })} />',
'<input type="checkbox" checked={settings.autoBoost} disabled={settings.mode === "dumb"} onChange={event => void patch({ autoBoost: event.target.checked })} />',
'dumb auto boost lock')
s = req(s,
'<input type="checkbox" checked={settings.liveCounter} onChange={event => void patch({ liveCounter: event.target.checked })} />',
'<input type="checkbox" checked={settings.liveCounter} disabled={settings.mode === "dumb"} onChange={event => void patch({ liveCounter: event.target.checked })} />',
'dumb live counter lock')

# Precision settings and diagnostics.
s = req(s,
'<label className="field"><span>E burst gap (ms)</span><input type="number" min="75" max="600" step="25" value={settings.doubleTapGapMs} onChange={event => void patch({ doubleTapGapMs: Number(event.target.value) })} /></label>',
'<label className="field"><span>E burst gap (ms)</span><input type="number" min="75" max="600" step="25" value={settings.doubleTapGapMs} onChange={event => void patch({ doubleTapGapMs: Number(event.target.value) })} /></label>\n        <label className="field"><span>Cooldown sync interval (s)</span><input type="number" min="5" max="30" step="1" disabled={settings.mode === "dumb"} value={settings.cooldownSyncIntervalSec} onChange={event => void patch({ cooldownSyncIntervalSec: Number(event.target.value) })} /></label>\n        <label className="field"><span>Precision Ready window (s)</span><input type="number" min="2" max="8" step="0.5" value={settings.precisionWindowSec} onChange={event => void patch({ precisionWindowSec: Number(event.target.value) })} /></label>',
'precision settings UI')
s = s.replace('Low-overhead mode: full sidebar OCR runs only on connect, run start/end, Refresh full panel, or Recalibrate. The live counter uses only a tiny crop at the interval above (20s default). Chopping uses its own tiny crop only around Ready / verification / cooldown transitions. During a known cooldown, boost OCR sleeps completely until the scheduled wake.', 'Precision low-overhead mode: full sidebar OCR remains limited to connect/start/end/manual refresh. Chopping uses only its tiny crop every 15s by default to re-sync the real countdown. Near predicted Ready it enters a short precision window, pauses counter OCR, and checks Chopping rapidly until the current game UI actually says Ready. E is never triggered by the local timer alone.')
s = req(s,
'        <span>Viewport <strong>{status.viewportWidth && status.viewportHeight ? `${Math.round(status.viewportWidth)}×${Math.round(status.viewportHeight)}` : "—"}</strong></span>\n',
'        <span>Viewport <strong>{status.viewportWidth && status.viewportHeight ? `${Math.round(status.viewportWidth)}×${Math.round(status.viewportHeight)}` : "—"}</strong></span>\n        <span>Ready prediction <strong>{status.predictedReadyAt ? `${Math.max(0, (status.predictedReadyAt - Date.now()) / 1000).toFixed(2)}s` : "—"}</strong></span>\n        <span>Cooldown drift <strong>{status.boostDriftSeconds === undefined ? "—" : `${status.boostDriftSeconds >= 0 ? "+" : ""}${status.boostDriftSeconds.toFixed(2)}s`}</strong></span>\n',
'precision diagnostics')
p.write_text(s)

# ---------- versions/docs ----------
for fn in ['package.json', 'extension/public/manifest.json']:
    p = Path(fn)
    t = p.read_text().replace('"version": "0.3.3"', '"version": "0.3.4"')
    p.write_text(t)

p = Path('README.md')
s = p.read_text().replace('v0.3.3', 'v0.3.4')
s += '''\n\n### v0.3.4 precision Chopping + Dumb mode\n\nCooldown timing is anchored to screenshot capture time rather than OCR completion. A tiny Chopping-only crop re-synchronizes the displayed cooldown every 15 seconds by default, rejects implausible >6-second jumps, and enters a short precision window near Ready where counter OCR is deferred and Chopping is re-read rapidly. E only fires after a fresh Chopping Ready observation. The first post-E verification is accelerated, with one extra rapid Ready confirmation before the existing backup E ×3 burst. Rolling blocks/second is displayed to 6 significant figures and counter-rate timing uses screenshot capture timestamps.\n\nDumb mode is a third connection mode. It forces auto connection, Auto Chopping, 15-second cooldown sync and live counter. After connection it arms from the current sidebar snapshot; while no run is active it takes a tiny counter sample about every two seconds. The first observed Blocks mined increase automatically starts an AFK run using the previous counter sample as the run boundary, avoiding a heavy full-panel OCR in the middle of mining. Runs are still stopped manually so the user controls the recording boundary.\n'''
p.write_text(s)
