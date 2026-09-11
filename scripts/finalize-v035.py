from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{path}: expected one regex match, found {count}: {pattern[:100]!r}")
    write(path, updated)


BG = "extension/background-v3.ts"

replace_once(
    BG,
    'import { OcrDeadlineError, PriorityOcrQueue, cooldownSyncDelayMs, isStaleObservation, transitionVerdict, type OcrWorkClass } from "../src/extension/reliability";',
    'import { OcrDeadlineError, PriorityOcrQueue, cooldownSyncDelayMs, isStaleObservation, precisionProbePlan, transitionVerdict, type OcrWorkClass } from "../src/extension/reliability";'
)

replace_once(
    BG,
    '''  BackgroundResponse,\n  DiagnosticEntry,\n  ExtensionSettings,\n  LiveExtensionStatus,\n  OcrCropProfile,\n  OcrMode,\n  OcrRequest,\n  OcrResponse,\n  OffscreenControlRequest,\n  OffscreenWakeId\n''',
    '''  BackgroundResponse,\n  DiagnosticCategory,\n  DiagnosticDetails,\n  DiagnosticEntry,\n  ExtensionPowerState,\n  ExtensionSettings,\n  LiveExtensionStatus,\n  OcrCropProfile,\n  OcrMode,\n  OcrRecognitionMethod,\n  OcrRequest,\n  OcrResponse,\n  OffscreenControlRequest,\n  OffscreenWakeId,\n  UiStateMessage\n'''
)

replace_once(
    BG,
    '''let boostTotals = {\n  successfulActivations: 0,\n  activationRetries: 0,\n  failedActivations: 0,\n  cooldownsRead: [] as number[]\n};''',
    '''let boostTotals = {\n  successfulActivations: 0,\n  firstTryActivations: 0,\n  backupSuccessfulActivations: 0,\n  activationRetries: 0,\n  failedActivations: 0,\n  cooldownsRead: [] as number[]\n};'''
)

replace_once(BG, 'let liveRefreshFlight: Promise<void> | null = null;\n', '')

replace_once(
    BG,
    '''let dumbArmSnapshot: SidebarSnapshot | undefined;\n\nfunction errorText''',
    '''let dumbArmSnapshot: SidebarSnapshot | undefined;\nlet powerState: ExtensionPowerState = "idle";\nlet lastAuthoritativeSyncAt = 0;\nlet lastRecognitionMethod: OcrRecognitionMethod | undefined;\nlet lastQueueWaitMs: number | undefined;\nlet lastCaptureMs: number | undefined;\nlet rejectedOcrCount = 0;\nlet readyRecognizedAt: number | undefined;\nlet readyToE1Latencies: number[] = [];\nlet uiBroadcastTimer: ReturnType<typeof setTimeout> | undefined;\n\nfunction errorText'''
)

regex_once(
    BG,
    r'''function log\(message: string, level: DiagnosticEntry\["level"\] = "info"\) \{\n  diagnostics = \[\{ at: new Date\(\)\.toISOString\(\), level, message \}, \.\.\.diagnostics\]\.slice\(0, 300\);\n\}''',
    '''function queueUiBroadcast() {\n  if (!loaded || uiBroadcastTimer !== undefined) return;\n  uiBroadcastTimer = setTimeout(() => {\n    uiBroadcastTimer = undefined;\n    const event: UiStateMessage = { target: "ui", type: "STATE_UPDATE", status: status() };\n    void chrome.runtime.sendMessage(event).catch(() => { /* no UI is a normal state */ });\n  }, 100);\n}\n\nfunction setPowerState(next: ExtensionPowerState) {\n  if (powerState === next) return;\n  powerState = next;\n  queueUiBroadcast();\n}\n\nfunction log(\n  message: string,\n  level: DiagnosticEntry["level"] = "info",\n  meta: { category?: DiagnosticCategory; event?: string; details?: DiagnosticDetails } = {}\n) {\n  diagnostics = [{\n    at: new Date().toISOString(),\n    level,\n    category: meta.category || "system",\n    event: meta.event || "message",\n    message,\n    details: meta.details\n  }, ...diagnostics].slice(0, 500);\n  queueUiBroadcast();\n}\n\nfunction medianNumber(values: number[]) {\n  if (!values.length) return undefined;\n  const sorted = [...values].sort((a, b) => a - b);\n  const mid = Math.floor(sorted.length / 2);\n  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;\n}'''
)

replace_once(
    BG,
    '''    preferFast?: boolean;\n    forceViewport?: boolean;\n''',
    '''    preferFast?: boolean;\n    fastOnly?: boolean;\n    forceViewport?: boolean;\n'''
)

replace_once(
    BG,
    '''  const requestedConnectionEpoch = connectionEpoch;\n  const requestedBoostEpoch = options.boostEpoch ?? boostStateEpoch;\n  return ocrQueue.enqueue(options.workClass, async () => {\n''',
    '''  const requestedConnectionEpoch = connectionEpoch;\n  const requestedBoostEpoch = options.boostEpoch ?? boostStateEpoch;\n  const queuedAt = Date.now();\n  return ocrQueue.enqueue(options.workClass, async () => {\n    const queueWaitMs = Math.max(0, Date.now() - queuedAt);\n    lastQueueWaitMs = queueWaitMs;\n'''
)

replace_once(
    BG,
    '''    const key = microCalibrationKey(profile, view);\n    const captureAt = Date.now();\n    const capture = await debuggerCommand<{ data: string }>("Page.captureScreenshot", {\n''',
    '''    const key = microCalibrationKey(profile, view);\n    const captureStartedAt = Date.now();\n    const captureAt = captureStartedAt;\n    const capture = await debuggerCommand<{ data: string }>("Page.captureScreenshot", {\n'''
)

replace_once(
    BG,
    '''    if (!capture?.data) throw new Error(`Screenshot capture returned no data (${mode}/${profile}).`);\n\n    const request: OcrRequest = {\n''',
    '''    if (!capture?.data) throw new Error(`Screenshot capture returned no data (${mode}/${profile}).`);\n    const captureMs = Math.max(0, Date.now() - captureStartedAt);\n    lastCaptureMs = captureMs;\n\n    const request: OcrRequest = {\n'''
)

replace_once(
    BG,
    '''      inputScope: options.microRect ? "micro" : "base",\n      preferFast: Boolean(options.preferFast && options.microRect)\n''',
    '''      inputScope: options.microRect ? "micro" : "base",\n      preferFast: Boolean(options.preferFast && options.microRect),\n      fastOnly: Boolean(options.fastOnly && options.microRect)\n'''
)

replace_once(
    BG,
    '''    if (!response.ok) throw new Error(`${response.error || "OCR failed"} [${mode}/${profile}]`);\n    recordOcr(response);\n    return {\n''',
    '''    if (!response.ok) throw new Error(`${response.error || "OCR failed"} [${mode}/${profile}]`);\n    recordOcr(response);\n    lastRecognitionMethod = response.recognitionMethod;\n    log(`OCR ${mode} completed via ${response.recognitionMethod || "unknown"}.`, "debug", {\n      category: "ocr",\n      event: "ocr.result",\n      details: {\n        mode, profile, workClass: options.workClass, micro: Boolean(options.microRect),\n        fastOnly: Boolean(options.fastOnly), queueWaitMs, captureMs, recognitionMs: response.elapsedMs,\n        confidence: response.confidence\n      }\n    });\n    return {\n'''
)

replace_once(
    BG,
    'async function readBoost(workClass: OcrWorkClass = "boost-sync"): Promise<SkillStateSnapshot> {',
    'async function readBoost(workClass: OcrWorkClass = "boost-sync", options: { fastOnly?: boolean } = {}): Promise<SkillStateSnapshot> {'
)

replace_once(
    BG,
    '''    const key = microCalibrationKey(profile, view);\n    const stored = !forceBase && boostMicroCrop?.key === key ? boostMicroCrop : undefined;\n    let response = await captureOcr("boost", profile, {\n''',
    '''    const key = microCalibrationKey(profile, view);\n    const stored = !forceBase && boostMicroCrop?.key === key ? boostMicroCrop : undefined;\n    if (options.fastOnly && !stored) return { state: "unknown", raw: "fast-only probe has no calibrated micro crop" };\n    let response = await captureOcr("boost", profile, {\n'''
)

replace_once(
    BG,
    '''      boostEpoch: requestedBoostEpoch,\n      microRect: stored?.rect,\n      preferFast: workClass === "boost-critical"\n''',
    '''      boostEpoch: requestedBoostEpoch,\n      microRect: stored?.rect,\n      preferFast: workClass === "boost-critical",\n      fastOnly: Boolean(options.fastOnly && stored)\n'''
)

replace_once(
    BG,
    '''    )) {\n      log("Discarded a stale Chopping OCR result instead of letting it overwrite newer state.");\n      return { state: "unknown", raw: "stale observation discarded" };\n    }\n''',
    '''    )) {\n      rejectedOcrCount += 1;\n      log("Discarded a stale Chopping OCR result instead of letting it overwrite newer state.", "debug", { category: "chopping", event: "state.stale" });\n      return { state: "unknown", raw: "stale observation discarded" };\n    }\n'''
)

replace_once(
    BG,
    '''    if (response.usedMicro && skill.state === "unknown") {\n      boostMicroCrop = undefined;\n      log("Chopping micro-crop was unclear; retrying the safe Chopping crop once.", "warn");\n''',
    '''    if (response.usedMicro && skill.state === "unknown") {\n      if (options.fastOnly) return skill;\n      boostMicroCrop = undefined;\n      log("Chopping micro-crop was unclear; retrying the safe Chopping crop once.", "warn", { category: "ocr", event: "micro.fallback" });\n'''
)

replace_once(
    BG,
    '''    lastAcceptedBoostGeneration = generation;\n    lastAcceptedBoostCaptureAt = response.captureAt;\n    lastBoostCaptureAt = response.captureAt;\n''',
    '''    lastAcceptedBoostGeneration = generation;\n    lastAcceptedBoostCaptureAt = response.captureAt;\n    lastBoostCaptureAt = response.captureAt;\n    lastAuthoritativeSyncAt = response.captureAt;\n'''
)

replace_once(
    BG,
    '''    boostMisses = 0;\n    applyBoostObservation(skill, response.captureAt);\n    return skill;\n''',
    '''    boostMisses = 0;\n    applyBoostObservation(skill, response.captureAt);\n    if (skill.state === "ready") readyRecognizedAt = Date.now();\n    return skill;\n'''
)

replace_once(
    BG,
    '''    let skill = await attempt(profiles[0]);\n    if (skill.state !== "unknown") return skill;\n\n    boostMisses += 1;\n''',
    '''    let skill = await attempt(profiles[0]);\n    if (skill.state !== "unknown") return skill;\n    if (options.fastOnly) return skill;\n\n    boostMisses += 1;\n'''
)

replace_once(
    BG,
    '''      if (Math.abs(drift) > 6) {\n        boostDriftSeconds = drift;\n        cooldownUncertaintySec = Math.min(10, Math.max(cooldownUncertaintySec, Math.abs(drift)));\n        log(`Suspicious cooldown OCR: screen ${skill.cooldownSeconds}s vs predicted ${predictedSeconds}s (${drift >= 0 ? "+" : ""}${drift.toFixed(2)}s). Keeping the prior prediction.`, "warn");\n''',
    '''      if (Math.abs(drift) > 6) {\n        rejectedOcrCount += 1;\n        boostDriftSeconds = drift;\n        cooldownUncertaintySec = Math.min(10, Math.max(cooldownUncertaintySec, Math.abs(drift)));\n        log(`Suspicious cooldown OCR: screen ${skill.cooldownSeconds}s vs predicted ${predictedSeconds}s (${drift >= 0 ? "+" : ""}${drift.toFixed(2)}s). Keeping the prior prediction.`, "warn", {\n          category: "timer", event: "cooldown.rejected", details: { observedSeconds: skill.cooldownSeconds, predictedSeconds, driftSeconds: drift }\n        });\n'''
)

replace_once(
    BG,
    '''  if (previous && value < previous.value) {\n    log(`Rejected decreasing Blocks mined value ${value.toLocaleString()} < ${previous.value.toLocaleString()}.`, "warn");\n    return false;\n  }\n''',
    '''  if (previous && value < previous.value) {\n    rejectedOcrCount += 1;\n    log(`Rejected decreasing Blocks mined value ${value.toLocaleString()} < ${previous.value.toLocaleString()}.`, "warn", {\n      category: "counter", event: "counter.rejected", details: { observed: value, previous: previous.value }\n    });\n    return false;\n  }\n'''
)

replace_once(
    BG,
    '''    log(`Blocks mined updated: ${previous.value.toLocaleString()} → ${value.toLocaleString()} (${delta >= 0 ? "+" : ""}${delta}).`);\n''',
    '''    log(`Blocks mined updated: ${previous.value.toLocaleString()} → ${value.toLocaleString()} (${delta >= 0 ? "+" : ""}${delta}).`, "info", {\n      category: "counter", event: "counter.updated", details: { previous: previous.value, current: value, delta, rollingBps }\n    });\n'''
)

replace_once(
    BG,
    '''function scheduleVerify(seconds = settings.verifyAfterPressSec) {\n  void scheduleOffscreenWake("boost-verify", Date.now() + seconds * 1000);\n}\n\nfunction scheduleActiveCheck() {\n  void scheduleOffscreenWake("boost-active", Date.now() + settings.activeCheckSec * 1000);\n}\n''',
    '''function scheduleVerify(seconds = settings.verifyAfterPressSec) {\n  setPowerState("verifying");\n  void scheduleOffscreenWake("boost-verify", Date.now() + seconds * 1000);\n}\n\nfunction scheduleActiveCheck() {\n  setPowerState("active-wait");\n  void scheduleOffscreenWake("boost-active", Date.now() + settings.activeCheckSec * 1000);\n}\n'''
)

replace_once(
    BG,
    '''function scheduleCounter() {\n  // Live counter work remains demand-driven by the side-panel/status path.\n  // There is intentionally no independent background counter OCR loop.\n}\n''',
    '''function scheduleCounter(delayMs?: number) {\n  const detectMining = settings.mode === "dumb" && !activeSession && dumbModeArmed;\n  const sampleRun = Boolean(activeSession && settings.liveCounter);\n  if (connectedTabId === undefined || (!detectMining && !sampleRun)) {\n    void cancelOffscreenWake("counter");\n    return;\n  }\n  const delay = delayMs ?? (detectMining ? 2_000 : settings.counterIntervalSec * 1000);\n  void scheduleOffscreenWake("counter", Date.now() + Math.max(250, delay));\n}\n\nasync function counterWake() {\n  if (connectedTabId === undefined) return;\n  if (precisionWindowActive) {\n    log("Blocks counter wake deferred because Chopping is in the precision Ready window.", "debug", { category: "counter", event: "counter.deferred" });\n    scheduleCounter(1_000);\n    return;\n  }\n  if (settings.mode === "dumb" && !activeSession && dumbModeArmed) {\n    try { await dumbModeCounterTick(); }\n    catch (error) { log(`Dumb mode mining detector: ${errorText(error)}`, "warn", { category: "counter", event: "dumb.detect.error" }); }\n    scheduleCounter(activeSession ? undefined : 2_000);\n    return;\n  }\n  if (activeSession && settings.liveCounter) {\n    try {\n      const value = await readCounter();\n      if (value === undefined) log("Scheduled live counter read returned no number; the next sample remains armed.", "warn", { category: "counter", event: "counter.miss" });\n    } catch (error) {\n      log(`Scheduled live counter refresh: ${errorText(error)}`, "warn", { category: "counter", event: "counter.error" });\n    }\n    scheduleCounter();\n  }\n}\n'''
)

replace_once(
    BG,
    '''    log(`${label}: pressing E ${i}/${count}…`);\n    await keyE();\n    log(`${label}: E ${i}/${count} pressed.`);\n''',
    '''    log(`${label}: pressing E ${i}/${count}…`, "debug", { category: "input", event: "input.e.pending", details: { burst: label, index: i, count } });\n    const dispatchStartedAt = Date.now();\n    if (i === 1 && label === "Primary boost input" && readyRecognizedAt !== undefined) {\n      const readyToE1Ms = Math.max(0, dispatchStartedAt - readyRecognizedAt);\n      const captureToE1Ms = lastBoostCaptureAt === undefined ? undefined : Math.max(0, dispatchStartedAt - lastBoostCaptureAt);\n      readyToE1Latencies = [...readyToE1Latencies, readyToE1Ms].slice(-50);\n      log(`Ready recognition → E1 dispatch: ${readyToE1Ms}ms.`, "info", {\n        category: "input", event: "input.ready_to_e1", details: { readyToE1Ms, captureToE1Ms }\n      });\n      readyRecognizedAt = undefined;\n    }\n    await keyE();\n    log(`${label}: E ${i}/${count} pressed.`, "debug", { category: "input", event: "input.e.sent", details: { burst: label, index: i, count } });\n'''
)

replace_once(
    BG,
    '''function confirmBoostSuccess() {\n  if (!boostCycle?.confirmed) {\n    boostTotals.successfulActivations += 1;\n    if (boostCycle) boostCycle.confirmed = true;\n  }\n}\n''',
    '''function confirmBoostSuccess() {\n  if (!boostCycle?.confirmed) {\n    boostTotals.successfulActivations += 1;\n    if (boostCycle?.retryUsed) boostTotals.backupSuccessfulActivations += 1;\n    else boostTotals.firstTryActivations += 1;\n    if (boostCycle) boostCycle.confirmed = true;\n    queueUiBroadcast();\n  }\n}\n'''
)

replace_once(
    BG,
    '''  nextCooldownSyncAt = now + syncDelayMs;\n  void scheduleOffscreenWake("boost-sync", nextCooldownSyncAt);\n''',
    '''  nextCooldownSyncAt = now + syncDelayMs;\n  setPowerState("deep-sleep");\n  log(`Chopping sleeping for ${(syncDelayMs / 1000).toFixed(2)}s until the next tiny synchronization.`, "debug", {\n    category: "timer", event: "sleep.enter", details: { sleepMs: syncDelayMs, remainingMs, uncertaintySec: cooldownUncertaintySec }\n  });\n  void scheduleOffscreenWake("boost-sync", nextCooldownSyncAt);\n'''
)

replace_once(
    BG,
    '''async function syncCooldown() {\n  if (!settings.autoBoost || connectedTabId === undefined || boostFault || !predictedReadyAt) return;\n  lastCooldownSyncAt = Date.now();\n''',
    '''async function syncCooldown() {\n  if (!settings.autoBoost || connectedTabId === undefined || boostFault || !predictedReadyAt) return;\n  setPowerState("sync");\n  lastCooldownSyncAt = Date.now();\n'''
)

replace_once(
    BG,
    '''  precisionWindowActive = true;\n  const remaining = predictedReadyAt ? Math.max(0, (predictedReadyAt - Date.now()) / 1000) : 0;\n''',
    '''  precisionWindowActive = true;\n  setPowerState("precision");\n  const remaining = predictedReadyAt ? Math.max(0, (predictedReadyAt - Date.now()) / 1000) : 0;\n'''
)

regex_once(
    BG,
    r'''async function precisionBoostTick\(\) \{[\s\S]*?\n\}\n\nasync function beginBoostCycle''',
    '''async function precisionBoostTick() {\n  if (!precisionWindowActive || !settings.autoBoost || connectedTabId === undefined || boostFault || boostCycle) return;\n  const remainingMs = predictedReadyAt === undefined ? 0 : predictedReadyAt - Date.now();\n  const plan = precisionProbePlan({ remainingMs, hasMicroCrop: Boolean(boostMicroCrop) });\n  try {\n    const observed = await readBoost("boost-critical", { fastOnly: plan.fastOnly });\n    if (observed.state === "ready") {\n      precisionWindowActive = false;\n      const finishedAt = Date.now();\n      log(`Actual Ready confirmed. Recognition finished ${Math.max(0, finishedAt - (lastBoostCaptureAt || finishedAt))}ms after screenshot capture.`, "info", {\n        category: "chopping", event: "ready.confirmed", details: { captureToRecognitionMs: Math.max(0, finishedAt - (lastBoostCaptureAt || finishedAt)), fastOnly: plan.fastOnly }\n      });\n      await beginBoostCycle();\n      return;\n    }\n    if (observed.state === "active") {\n      precisionWindowActive = false;\n      scheduleActiveCheck();\n      return;\n    }\n    if (observed.state === "cooldown" && predictedReadyAt !== undefined) {\n      const left = predictedReadyAt - Date.now();\n      if (left > settings.precisionWindowSec * 1000 + 1000) {\n        precisionWindowActive = false;\n        log("Precision window moved back after cooldown re-sync; returning to low-overhead monitoring.", "info", { category: "timer", event: "precision.exit" });\n        scheduleCooldownMonitoring();\n        return;\n      }\n    }\n  } catch (error) {\n    log(`Precision Chopping read: ${errorText(error)}`, "warn", { category: "chopping", event: "precision.error" });\n  }\n  if (precisionWindowActive) void scheduleOffscreenWake("boost-precision", Date.now() + plan.nextDelayMs);\n}\n\nasync function beginBoostCycle'''
)

replace_once(
    BG,
    '''  boostCycle = { retryUsed: false, confirmed: false, ambiguousReads: 0, readyConfirmReads: 0 };\n  try {\n''',
    '''  boostCycle = { retryUsed: false, confirmed: false, ambiguousReads: 0, readyConfirmReads: 0 };\n  setPowerState("activating");\n  try {\n'''
)

replace_once(
    BG,
    '''    boostFault = `Could not send E: ${errorText(error)}`;\n    log(boostFault, "error");\n''',
    '''    boostFault = `Could not send E: ${errorText(error)}`;\n    setPowerState("fault");\n    log(boostFault, "error", { category: "input", event: "input.fault" });\n'''
)

replace_once(
    BG,
    '''async function verifyBoostCycle() {\n  if (!settings.autoBoost || boostFault || connectedTabId === undefined || !boostCycle) return;\n  try {\n''',
    '''async function verifyBoostCycle() {\n  if (!settings.autoBoost || boostFault || connectedTabId === undefined || !boostCycle) return;\n  setPowerState("verifying");\n  try {\n'''
)

replace_once(
    BG,
    '''      boostFault = "Input was not confirmed after the one allowed backup E ×3 burst.";\n      boostCycle = undefined;\n      log(boostFault, "error");\n''',
    '''      boostFault = "Input was not confirmed after the one allowed backup E ×3 burst.";\n      boostCycle = undefined;\n      setPowerState("fault");\n      log(boostFault, "error", { category: "input", event: "input.unconfirmed" });\n'''
)

replace_once(
    BG,
    '''async function activeBoostCheck() {\n  if (!settings.autoBoost || boostFault || connectedTabId === undefined) return;\n  try {\n''',
    '''async function activeBoostCheck() {\n  if (!settings.autoBoost || boostFault || connectedTabId === undefined) return;\n  setPowerState("active-wait");\n  try {\n'''
)

replace_once(
    BG,
    '''async function wakeBoost() {\n  if (!settings.autoBoost || boostFault || connectedTabId === undefined) return;\n  try {\n''',
    '''async function wakeBoost() {\n  if (!settings.autoBoost || boostFault || connectedTabId === undefined) return;\n  setPowerState("sync");\n  try {\n'''
)

regex_once(
    BG,
    r'''async function refreshLiveStateOnPoll\(\) \{[\s\S]*?\n\}\n\nasync function closeOffscreen''',
    '''async function closeOffscreen'''
)

replace_once(
    BG,
    '''  clearShortTimers();\n  void chrome.alarms.clear(BOOST_WAKE);\n''',
    '''  clearShortTimers();\n  void cancelOffscreenWake("counter");\n  void chrome.alarms.clear(BOOST_WAKE);\n'''
)

replace_once(
    BG,
    '''  dumbArmSnapshot = undefined;\n  if (tabId !== undefined) {\n''',
    '''  dumbArmSnapshot = undefined;\n  readyRecognizedAt = undefined;\n  setPowerState("idle");\n  if (tabId !== undefined) {\n'''
)

replace_once(
    BG,
    '''  connectedTabId = tabId;\n  connectedUrl = tab.url;\n  boostFault = undefined;\n''',
    '''  connectedTabId = tabId;\n  connectedUrl = tab.url;\n  boostFault = undefined;\n  setPowerState("idle");\n'''
)

replace_once(
    BG,
    '''  scheduleCounter();\n  await maybeArmBoostFromSnapshot();\n  if (settings.mode === "dumb") armDumbMode();\n''',
    '''  await maybeArmBoostFromSnapshot();\n  if (settings.mode === "dumb") armDumbMode();\n  scheduleCounter();\n'''
)

replace_once(
    BG,
    '''  await saveActiveSession();\n  lastCounterReadAt = 0; // Force a fresh small counter read on the next 1s UI poll.\n  log(`Session started at ${snapshot.blocksMined.toLocaleString()} blocks${preset ? " (Dumb mode auto-start)" : ""}. Full sidebar snapshot saved; live counter refresh armed.`);\n''',
    '''  await saveActiveSession();\n  lastCounterReadAt = 0;\n  scheduleCounter(250);\n  log(`Session started at ${snapshot.blocksMined.toLocaleString()} blocks${preset ? " (Dumb mode auto-start)" : ""}. Full sidebar snapshot saved; scheduled live counter is armed.`, "info", {\n    category: "session", event: "session.started", details: { startBlocks: snapshot.blocksMined, miningType, automatic: Boolean(preset) }\n  });\n'''
)

replace_once(
    BG,
    '''  dumbModeArmed = true;\n  log(`Dumb mode armed at ${counter.toLocaleString()} blocks. Start mining and an AFK run will begin automatically.`);\n''',
    '''  dumbModeArmed = true;\n  log(`Dumb mode armed at ${counter.toLocaleString()} blocks. Start mining and an AFK run will begin automatically.`, "info", { category: "session", event: "dumb.armed", details: { baseline: counter } });\n  scheduleCounter(2_000);\n'''
)

replace_once(
    BG,
    '''  activeSession = undefined;\n  await saveActiveSession();\n  log(`Session finished: ${blocksMined.toLocaleString()} blocks at ${session.averageBps.toFixed(5)} b/s. Final sidebar snapshot saved.`);\n  return session;\n''',
    '''  activeSession = undefined;\n  await saveActiveSession();\n  void cancelOffscreenWake("counter");\n  log(`Session finished: ${blocksMined.toLocaleString()} blocks at ${session.averageBps.toFixed(5)} b/s. Final sidebar snapshot saved.`, "info", {\n    category: "session", event: "session.finished", details: { blocksMined, durationMs, averageBps: session.averageBps }\n  });\n  return session;\n'''
)

# Replace the whole status function to keep the health model internally consistent.
regex_once(
    BG,
    r'''function status\(\): LiveExtensionStatus \{[\s\S]*?\n\}\n\nasync function setSettings''',
    '''function status(): LiveExtensionStatus {\n  const now = Date.now();\n  ocrReads = ocrReads.filter(at => now - at < 60_000);\n  let liveChoppingSkill = choppingSkill;\n  if (choppingSkill.state === "cooldown" && (predictedReadyAt !== undefined || boostCooldownReadyAt !== undefined)) {\n    const readyAt = predictedReadyAt ?? boostCooldownReadyAt!;\n    liveChoppingSkill = {\n      ...choppingSkill,\n      cooldownSeconds: Math.max(0, Math.ceil((readyAt - now) / 1000))\n    };\n  }\n  const liveSnapshot = currentSnapshot ? { ...currentSnapshot } : undefined;\n  if (liveSnapshot && liveChoppingSkill.state !== "unknown") {\n    liveSnapshot.chopping = { ...(liveSnapshot.chopping || {}), skill: liveChoppingSkill };\n  }\n\n  let health: LiveExtensionStatus["health"] = "healthy";\n  let healthReason = "Runtime state is within configured reliability limits.";\n  if (connectedTabId === undefined) {\n    health = "offline";\n    healthReason = "No Bloxd One Block tab is connected.";\n  } else if (boostFault) {\n    health = "paused";\n    healthReason = boostFault;\n  } else if (settings.autoBoost && choppingSkill.state === "unknown" && lastBoostReadAt > 0 && now - lastBoostReadAt > 10_000) {\n    health = "degraded";\n    healthReason = "Chopping state has not been authoritatively confirmed for more than 10 seconds.";\n  } else if (cooldownUncertaintySec > 4) {\n    health = "degraded";\n    healthReason = `Cooldown prediction uncertainty is ±${cooldownUncertaintySec.toFixed(2)}s.`;\n  } else if (ocrQueue.depth > 2) {\n    health = "degraded";\n    healthReason = `OCR queue depth is ${ocrQueue.depth}; critical Chopping work still has priority.`;\n  }\n\n  const readyMedian = medianNumber(readyToE1Latencies);\n  return {\n    ready: loaded,\n    connected: connectedTabId !== undefined,\n    tabId: connectedTabId,\n    url: connectedUrl,\n    lobby: lobbyFromUrl(connectedUrl),\n    phase: currentSnapshot?.phase,\n    blocksMined: lastCounter?.value ?? currentSnapshot?.blocksMined,\n    rollingBps,\n    choppingSkill: liveChoppingSkill,\n    lastOcrConfidence,\n    lastOcrMs,\n    readsLastMinute: ocrReads.length,\n    ocrProfile: activeOcrProfile,\n    viewportWidth: lastViewport?.width,\n    viewportHeight: lastViewport?.height,\n    sessionActive: Boolean(activeSession),\n    sessionStartedAt: activeSession ? new Date(activeSession.startedAtMs).toISOString() : undefined,\n    sessionStartBlocks: activeSession?.startSnapshot.blocksMined,\n    boostFault,\n    predictedReadyAt,\n    lastBoostCaptureAt,\n    boostDriftSeconds,\n    cooldownUncertaintySec,\n    lastAuthoritativeSyncAt: lastAuthoritativeSyncAt || undefined,\n    nextCooldownSyncAt: nextCooldownSyncAt || undefined,\n    dumbModeArmed,\n    ocrQueueDepth: ocrQueue.depth,\n    fastBoostHits,\n    boostMicroCalibrated: Boolean(boostMicroCrop),\n    counterMicroCalibrated: Boolean(counterMicroCrop),\n    powerState: boostFault ? "fault" : powerState,\n    health,\n    healthReason,\n    lastRecognitionMethod,\n    lastQueueWaitMs,\n    lastCaptureMs,\n    rejectedOcrCount,\n    readyToE1LatencyLastMs: readyToE1Latencies.at(-1),\n    readyToE1LatencyMedianMs: readyMedian,\n    readyToE1LatencyWorstMs: readyToE1Latencies.length ? Math.max(...readyToE1Latencies) : undefined,\n    firstTryActivations: boostTotals.firstTryActivations,\n    backupSuccessfulActivations: boostTotals.backupSuccessfulActivations,\n    successfulActivations: boostTotals.successfulActivations,\n    activationRetries: boostTotals.activationRetries,\n    failedActivations: boostTotals.failedActivations,\n    settings,\n    currentSnapshot: liveSnapshot,\n    diagnostics\n  };\n}\n\nasync function setSettings'''
)

replace_once(
    BG,
    '''    boostCooldownReadyAt = undefined;\n    boostWakeAt = undefined;\n  }\n''',
    '''    boostCooldownReadyAt = undefined;\n    boostWakeAt = undefined;\n    setPowerState("idle");\n  }\n'''
)

replace_once(
    BG,
    '''  scheduleCounter();\n  await reconcileConnection();\n  if (settings.mode === "dumb" && previousMode !== "dumb" && connectedTabId !== undefined && !activeSession) armDumbMode();\n  if (settings.mode !== "dumb") { dumbModeArmed = false; dumbBaseline = undefined; dumbArmSnapshot = undefined; }\n}\n''',
    '''  await reconcileConnection();\n  if (settings.mode === "dumb" && previousMode !== "dumb" && connectedTabId !== undefined && !activeSession) armDumbMode();\n  if (settings.mode !== "dumb") { dumbModeArmed = false; dumbBaseline = undefined; dumbArmSnapshot = undefined; }\n  scheduleCounter();\n  queueUiBroadcast();\n}\n\nasync function openMonitor() {\n  const monitorUrl = chrome.runtime.getURL("monitor.html");\n  const windows = await chrome.windows.getAll({ populate: true });\n  for (const window of windows) {\n    const tab = window.tabs?.find(candidate => candidate.url === monitorUrl);\n    if (tab && window.id !== undefined) {\n      await chrome.windows.update(window.id, { focused: true });\n      if (tab.id !== undefined) await chrome.tabs.update(tab.id, { active: true });\n      return;\n    }\n  }\n  await chrome.windows.create({ url: monitorUrl, type: "popup", width: 420, height: 640, focused: true });\n  log("Live Monitor opened manually. It reads cached/event-driven state and does not create an OCR schedule.", "info", { category: "system", event: "monitor.opened" });\n}\n'''
)

replace_once(
    BG,
    '''      case "GET_STATUS":\n        await reconcileConnection();\n        await refreshLiveStateOnPoll();\n        return { ok: true, status: status() };\n''',
    '''      case "GET_STATUS":\n        await reconcileConnection();\n        return { ok: true, status: status() };\n'''
)

replace_once(
    BG,
    '''      case "CLEAR_BOOST_FAULT":\n        boostFault = undefined;\n        boostCycle = undefined;\n        boostStateEpoch += 1;\n''',
    '''      case "CLEAR_BOOST_FAULT":\n        boostFault = undefined;\n        boostCycle = undefined;\n        setPowerState("idle");\n        boostStateEpoch += 1;\n'''
)

replace_once(
    BG,
    '''        }\n        return { ok: true, status: status() };\n      case "OFFSCREEN_WAKE":\n        if (!settings.autoBoost || connectedTabId === undefined || boostFault) return { ok: true, status: status() };\n''',
    '''        }\n        return { ok: true, status: status() };\n      case "OPEN_MONITOR":\n        await openMonitor();\n        return { ok: true, status: status() };\n      case "OFFSCREEN_WAKE":\n        if (command.id === "counter") {\n          await counterWake();\n          return { ok: true, status: status() };\n        }\n        if (!settings.autoBoost || connectedTabId === undefined || boostFault) return { ok: true, status: status() };\n'''
)

# When tab/debugger disappears, cancel counter scheduling and reflect the idle/offline state immediately.
text = read(BG)
text = text.replace(
    '''  invalidateMicroCrops();\n  clearShortTimers();\n  void chrome.alarms.clear(BOOST_WAKE);\n  log("Connected One Block tab closed.", "warn");''',
    '''  invalidateMicroCrops();\n  clearShortTimers();\n  void cancelOffscreenWake("counter");\n  void chrome.alarms.clear(BOOST_WAKE);\n  setPowerState("idle");\n  log("Connected One Block tab closed.", "warn");''',
    1
)
text = text.replace(
    '''  invalidateMicroCrops();\n  clearShortTimers();\n  void chrome.alarms.clear(BOOST_WAKE);\n  log(`Debugger detached (${reason}).`, "warn");''',
    '''  invalidateMicroCrops();\n  clearShortTimers();\n  void cancelOffscreenWake("counter");\n  void chrome.alarms.clear(BOOST_WAKE);\n  setPowerState("idle");\n  log(`Debugger detached (${reason}).`, "warn");''',
    1
)
write(BG, text)

# Side panel: event-driven state, manual monitor button, duplicate-field cleanup and richer diagnostics.
LIVE = "src/views/LiveExtension.tsx"
replace_once(
    LIVE,
    'import type { BackgroundCommand, BackgroundResponse, ExtensionSettings, LiveExtensionStatus } from "../extension/types";',
    'import type { BackgroundCommand, BackgroundResponse, ExtensionSettings, LiveExtensionStatus, UiStateMessage } from "../extension/types";'
)

regex_once(
    LIVE,
    r'''  useEffect\(\(\) => \{\n    void refresh\(\);\n    const statusTimer = window\.setInterval\(\(\) => void refresh\(\), 2000\);\n    const clockTimer = window\.setInterval\(\(\) => forceClock\(value => value \+ 1\), 1000\);\n    return \(\) => \{\n      window\.clearInterval\(statusTimer\);\n      window\.clearInterval\(clockTimer\);\n    \};\n  \}, \[\]\);''',
    '''  useEffect(() => {\n    void refresh();\n    const listener = (message: unknown) => {\n      const event = message as UiStateMessage;\n      if (event?.target === "ui" && event.type === "STATE_UPDATE") setStatus(event.status);\n    };\n    chrome.runtime.onMessage.addListener(listener);\n    const statusTimer = window.setInterval(() => void refresh(), 15_000);\n    const clockTimer = window.setInterval(() => forceClock(value => value + 1), 1000);\n    return () => {\n      chrome.runtime.onMessage.removeListener(listener);\n      window.clearInterval(statusTimer);\n      window.clearInterval(clockTimer);\n    };\n  }, []);'''
)

replace_once(
    LIVE,
    '''      <button className="quiet-button" disabled={busy} onClick={() => void run(() => command({ target: "background", type: "SCAN_NOW" }))}>Scan now</button>\n''',
    '''      <div className="live-connection-actions">\n        <button className="quiet-button" disabled={busy} onClick={() => void run(() => command({ target: "background", type: "OPEN_MONITOR" }))}>Open Live Monitor</button>\n        <button className="quiet-button" disabled={busy} onClick={() => void run(() => command({ target: "background", type: "SCAN_NOW" }))}>Scan now</button>\n      </div>\n'''
)

# Remove the accidental duplicate timing fields.
replace_once(
    LIVE,
    '''        <label className="field"><span>Cooldown sync interval (s)</span><input type="number" min="5" max="30" step="1" disabled={settings.mode === "dumb"} value={settings.cooldownSyncIntervalSec} onChange={event => void patch({ cooldownSyncIntervalSec: Number(event.target.value) })} /></label>\n        <label className="field"><span>Precision Ready window (s)</span><input type="number" min="2" max="8" step="0.5" value={settings.precisionWindowSec} onChange={event => void patch({ precisionWindowSec: Number(event.target.value) })} /></label>\n        <label className="field"><span>Cooldown sync interval (s)</span><input type="number" min="5" max="30" step="1" disabled={settings.mode === "dumb"} value={settings.cooldownSyncIntervalSec} onChange={event => void patch({ cooldownSyncIntervalSec: Number(event.target.value) })} /></label>\n        <label className="field"><span>Precision Ready window (s)</span><input type="number" min="2" max="8" step="0.5" value={settings.precisionWindowSec} onChange={event => void patch({ precisionWindowSec: Number(event.target.value) })} /></label>\n''',
    '''        <label className="field"><span>Cooldown sync interval (s)</span><input type="number" min="5" max="30" step="1" disabled={settings.mode === "dumb"} value={settings.cooldownSyncIntervalSec} onChange={event => void patch({ cooldownSyncIntervalSec: Number(event.target.value) })} /></label>\n        <label className="field"><span>Precision Ready window (s)</span><input type="number" min="2" max="8" step="0.5" value={settings.precisionWindowSec} onChange={event => void patch({ precisionWindowSec: Number(event.target.value) })} /></label>\n'''
)

replace_once(
    LIVE,
    '''      <p className="microcopy">Precision low-overhead mode: full sidebar OCR remains limited to connect/start/end/manual refresh. Chopping uses only its tiny crop every 15s by default to re-sync the real countdown. Near predicted Ready it enters a short precision window, pauses counter OCR, and checks Chopping rapidly until the current game UI actually says Ready. E is never triggered by the local timer alone.</p>\n''',
    '''      <p className="microcopy">v0.3.5 low-overhead mode: full sidebar OCR remains limited to connect/start/end/manual refresh. After a numeric Chopping cooldown is confirmed, the watcher sleeps between scheduled tiny synchronizations. Near predicted Ready it pauses counter OCR and prefers the learned fast state matcher; Tesseract remains a guarded fallback at the transition boundary. E is never triggered by the local timer alone. The optional Live Monitor is passive and opens only when you press its button.</p>\n'''
)

# Make the floating log useful without flooding it with every debug event.
replace_once(
    LIVE,
    '''      <div className="floating-action-log-body">{status.diagnostics.length ? status.diagnostics.slice(0, 40).map((entry, index) => <div key={`action-${entry.at}-${index}`} className={entry.level}><time>{new Date(entry.at).toLocaleTimeString()}</time><span>{entry.message}</span></div>) : <span className="muted-text">Waiting for extension actions…</span>}</div>\n''',
    '''      <div className="floating-action-log-body">{status.diagnostics.length ? status.diagnostics.filter(entry => entry.level !== "debug").slice(0, 40).map((entry, index) => <div key={`action-${entry.at}-${index}`} className={entry.level}><time>{new Date(entry.at).toLocaleTimeString()}</time><span><b>{entry.category}</b> · {entry.message}</span></div>) : <span className="muted-text">Waiting for extension actions…</span>}</div>\n'''
)

regex_once(
    LIVE,
    r'''      <div className="diagnostic-strip">[\s\S]*?</div>\n      <div className="diagnostic-log">''',
    '''      <div className="diagnostic-strip">\n        <span>Health <strong>{status.health}</strong></span>\n        <span>Power <strong>{status.powerState}</strong></span>\n        <span>Last OCR <strong>{status.lastOcrMs === undefined ? "—" : `${status.lastOcrMs} ms`}</strong></span>\n        <span>Method <strong>{status.lastRecognitionMethod || "—"}</strong></span>\n        <span>Queue/capture <strong>{status.lastQueueWaitMs ?? 0}/{status.lastCaptureMs ?? 0} ms</strong></span>\n        <span>Reads/min <strong>{status.readsLastMinute}</strong></span>\n        <span>Crop <strong>{status.ocrProfile || "un-calibrated"}</strong></span>\n        <span>Ready prediction <strong>{status.predictedReadyAt ? `${Math.max(0, (status.predictedReadyAt - Date.now()) / 1000).toFixed(2)}s` : "—"}</strong></span>\n        <span>Cooldown drift <strong>{status.boostDriftSeconds === undefined ? "—" : `${status.boostDriftSeconds >= 0 ? "+" : ""}${status.boostDriftSeconds.toFixed(2)}s`}</strong></span>\n        <span>Uncertainty <strong>{status.cooldownUncertaintySec === undefined ? "—" : `±${status.cooldownUncertaintySec.toFixed(2)}s`}</strong></span>\n        <span>Ready→E1 <strong>{status.readyToE1LatencyLastMs === undefined ? "—" : `${status.readyToE1LatencyLastMs}ms`}</strong></span>\n        <span>Rejected reads <strong>{status.rejectedOcrCount}</strong></span>\n      </div>\n      <div className="diagnostic-log">'''
)

replace_once(
    LIVE,
    '''{status.diagnostics.length ? status.diagnostics.slice(0, 24).map((entry, index) => <div key={`${entry.at}-${index}`} className={entry.level}><time>{new Date(entry.at).toLocaleTimeString()}</time><span>{entry.message}</span></div>) : <span className="muted-text">No diagnostic events yet.</span>}''',
    '''{status.diagnostics.length ? status.diagnostics.slice(0, 40).map((entry, index) => <div key={`${entry.at}-${index}`} className={entry.level}><time>{new Date(entry.at).toLocaleTimeString()}</time><span><b>{entry.category}</b> · {entry.message}{entry.details && <small> · {Object.entries(entry.details).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${String(value)}`).join(" · ")}</small>}</span></div>) : <span className="muted-text">No diagnostic events yet.</span>}'''
)

# Styling for the paired header actions and debug logs.
CSS = "src/extension.css"
css = read(CSS)
if ".live-connection-actions" not in css:
    css += '''\n.live-connection-actions { display:flex; gap:7px; flex-wrap:wrap; justify-content:flex-end; }\n.diagnostic-log .debug { opacity:.68; }\n.diagnostic-log b,.floating-action-log b { text-transform:uppercase; font-size:10px; letter-spacing:.06em; color:var(--muted); }\n.diagnostic-log small { color:var(--muted); }\n'''
write(CSS, css)

# README: replace stale extension runtime description with one internally consistent v0.3.5 section.
README = "README.md"
readme = read(README)
runtime = '''### Chopping automation and low-overhead runtime\n\nThe automation targets **Chopping** specifically. A local countdown never authorizes input by itself: only a fresh Chopping `Ready` observation can start the E sequence. The primary activation is E ×5, followed by a fast verification. If `Ready` is observed again, one rapid confirmation is required before the single backup E ×3 burst. Unclear or surprising observations fail closed and send no key.\n\nNumeric cooldown observations are anchored to screenshot capture time, not OCR completion time. During a known cooldown the Chopping watcher enters an explicit sleep state between scheduled tiny synchronization reads. Dumb mode uses a nominal 15-second sync interval, tightened only near Ready or when prediction uncertainty is high. Near the predicted transition the counter is paused and the watcher uses a learned Ready/Active micro-state matcher first; uncertain boundary reads fall back to constrained Tesseract. Full-sidebar OCR is not run periodically while mining.\n\nExpensive capture/OCR work uses a single-concurrency priority queue: critical Chopping reads outrank cooldown sync, live counter analytics and full-panel reads. Old connection/generation/capture results are rejected, decreasing Blocks-mined readings are rejected on the same connected island, and a timeout watchdog can recreate a stuck OCR worker.\n\n### Counter, sessions and Dumb mode\n\nLive Blocks mined uses a small crop at the configured counter interval (20 seconds by default) while a run is active. It is scheduled independently of the UI, so closing the side panel does not stop an active run or Chopping automation. Counter work is deferred during the precision Ready window. Rolling blocks/second uses screenshot capture timestamps and is displayed to 6 significant figures.\n\nDumb mode forces Auto connection, Auto Chopping, the nominal 15-second Chopping synchronization and live counter. Before the run starts, a tiny counter check runs about every two seconds. The first observed increase starts an AFK run from the previous counter sample; stopping remains manual so the user controls the final boundary. Complete right-sidebar OCR snapshots are still captured at run start/end and raw recognized text remains local.\n\n### Optional Live Monitor\n\nThe Live Monitor is **never opened automatically**. Press **Open Live Monitor** in the side panel to create the compact popup. Closing the side panel or monitor does not stop the automation. The monitor consumes cached/event-driven runtime state and a low-frequency recovery status check; opening it does not create its own Chopping or counter OCR schedule.\n\nMini mode shows Chopping state, Blocks mined, rolling speed, run progress and health. Monitor mode adds timer drift/uncertainty, last authoritative sync, recognition method, OCR/queue/capture timing, activation statistics and Ready→E1 latency. Diagnostic mode adds local structured logs. Logs are bounded in memory and no screenshots/video are retained.\n\n### Performance behavior\n\n- full sidebar OCR: connect/calibration, explicit refresh/recalibration, run start and run end only\n- Chopping cooldown: sleep between scheduled tiny reads; nominal 15-second sync in Dumb mode\n- precision window: counter paused; learned state matching preferred; Tesseract is a guarded fallback rather than a constant sub-second loop\n- live counter: small crop, default 20 seconds while a run is active\n- UI: side panel and optional monitor display cached/event-driven state; `GET_STATUS` does not itself trigger OCR\n- OCR worker: kept loaded but idle during sleep periods to avoid repeated initialization spikes\n\nThe Diagnostics surfaces report structured state-machine, timer, OCR, input, counter and session events. Measured live Chromebook performance and real Ready→E latency still require an actual Bloxd browser run; CI cannot prove those runtime quantities.\n'''
pattern = r'### Chopping boost state machine[\s\S]*?\n## Build\n'
updated, count = re.subn(pattern, runtime + '\n## Build\n', readme, count=1)
if count != 1:
    raise RuntimeError(f"README runtime section replacement count={count}")
# Remove stale historical release-note tail, replacing it with a concise current release note.
updated = re.sub(r'\n### v0\.3\.1 Auto Boost bootstrap fix[\s\S]*$', '''\n### v0.3.5 reliability / performance release\n\nv0.3.5 combines the existing Dumb AFK workflow with priority/deadline OCR scheduling, stale-result rejection, self-calibrating micro-crops, conservative learned Ready/Active recognition, adaptive cooldown synchronization, offscreen wake scheduling, explicit sleep states, passive manual Live Monitor support and structured diagnostics. The release is only considered complete after the source/build audit, CI, merged-main package build and real-browser acceptance testing described above.\n''', updated)
write(README, updated)

# Remove the old migration helper that must never ship.
old_helper = ROOT / "scripts/refine-v035-background.py"
if old_helper.exists():
    old_helper.unlink()

print("v0.3.5 source finalization patch applied")
