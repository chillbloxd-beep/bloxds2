from pathlib import Path


def replace_required(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise RuntimeError(f"Patch target missing: {label}")
    return text.replace(old, new, 1)

# TYPES
p = Path('src/extension/types.ts')
s = p.read_text()
s = replace_required(s,
'  doubleTapGapMs: number;\n}',
'  doubleTapGapMs: number;\n  dumbMode: boolean;\n  cooldownSyncIntervalSec: number;\n  precisionWindowSec: number;\n}',
'extension settings additions')
s = replace_required(s,
'  boostFault?: string;\n  settings: ExtensionSettings;',
'  boostFault?: string;\n  predictedReadyAt?: number;\n  lastBoostCaptureAt?: number;\n  boostDriftSeconds?: number;\n  dumbModeArmed?: boolean;\n  settings: ExtensionSettings;',
'live status precision fields')
p.write_text(s)

# BACKGROUND
p = Path('extension/background-v3.ts')
s = p.read_text()
s = replace_required(s,
'  doubleTapGapMs: 150\n};',
'  doubleTapGapMs: 150,\n  dumbMode: false,\n  cooldownSyncIntervalSec: 15,\n  precisionWindowSec: 4\n};',
'default settings')
s = replace_required(s,
'let liveRefreshFlight: Promise<void> | null = null;\n',
'let liveRefreshFlight: Promise<void> | null = null;\nlet predictedReadyAt: number | undefined;\nlet lastBoostCaptureAt: number | undefined;\nlet boostDriftSeconds: number | undefined;\nlet dumbModeArmed = false;\nlet dumbModeBaseline: { value: number; at: number } | undefined;\nlet precisionTimer: number | undefined;\nlet cooldownSyncTimer: number | undefined;\n',
'precision state vars')
s = replace_required(s,
'    doubleTapGapMs: Math.min(600, Math.max(75, Number(next.doubleTapGapMs) || 150))\n  };',
'    doubleTapGapMs: Math.min(600, Math.max(75, Number(next.doubleTapGapMs) || 150)),\n    dumbMode: Boolean(next.dumbMode),\n    cooldownSyncIntervalSec: Math.min(30, Math.max(5, Number(next.cooldownSyncIntervalSec) || 15)),\n    precisionWindowSec: Math.min(8, Math.max(2, Number(next.precisionWindowSec) || 4))\n  };',
'sanitize new settings')

# Timestamp capture before OCR so cooldown/rolling calculations are anchored to pixels, not OCR completion.
s = replace_required(s,
'async function captureOcr(mode: OcrMode, profile: OcrCropProfile): Promise<OcrResponse> {\n  return enqueueOcr(async () => {',
'async function captureOcr(mode: OcrMode, profile: OcrCropProfile): Promise<OcrResponse & { captureAt: number }> {\n  return enqueueOcr(async () => {',
'capture response type')
s = replace_required(s,
'    const capture = await debuggerCommand<{ data: string }>("Page.captureScreenshot", {',
'    const captureAt = Date.now();\n    const capture = await debuggerCommand<{ data: string }>("Page.captureScreenshot", {',
'capture timestamp')
s = replace_required(s,
'    recordOcr(response);\n    return response;',
'    recordOcr(response);\n    return { ...response, captureAt };',
'capture timestamp return')

# Counter uses screenshot timestamp for rolling bps.
s = replace_required(s,
'    updateCounter(response.blocksMined);\n    return response.blocksMined;',
'    updateCounter(response.blocksMined, response.captureAt);\n    return response.blocksMined;',
'counter primary timestamp')
s = s.replace('      updateCounter(response.blocksMined);', '      updateCounter(response.blocksMined, response.captureAt);')
s = replace_required(s,
'function updateCounter(value: number) {\n  const now = Date.now();',
'function updateCounter(value: number, sampleAt = Date.now()) {\n  const now = sampleAt;',
'counter function timestamp')

# New boost observation logic with absolute ready-time synchronization.
old = '''  let response = await captureOcr("boost", profiles[0]);\n  let skill = response.choppingSkill || { state: "unknown" as const };\n  if (skill.state !== "unknown") {\n    boostMisses = 0;\n    setChoppingSkill(skill);\n    return skill;\n  }'''
new = '''  let response = await captureOcr("boost", profiles[0]);\n  lastBoostCaptureAt = response.captureAt;\n  let skill = response.choppingSkill || { state: "unknown" as const };\n  if (skill.state !== "unknown") {\n    boostMisses = 0;\n    applyBoostObservation(skill, response.captureAt);\n    return skill;\n  }'''
s = replace_required(s, old, new, 'boost primary observation')
s = s.replace('        setChoppingSkill(skill);\n        log(`Boost crop automatically recalibrated to ${profile}.`);', '        lastBoostCaptureAt = response.captureAt;\n        applyBoostObservation(skill, response.captureAt);\n        log(`Boost crop automatically recalibrated to ${profile}.`);')
s = replace_required(s,
'  setChoppingSkill(skill);\n  return skill;\n}\n\nfunction updateCounter',
'  applyBoostObservation(skill, lastBoostCaptureAt || Date.now());\n  return skill;\n}\n\nfunction applyBoostObservation(skill: SkillStateSnapshot, captureAt: number) {\n  const previousPrediction = predictedReadyAt;\n  if (skill.state === "cooldown" && skill.cooldownSeconds !== undefined) {\n    const observedReadyAt = captureAt + skill.cooldownSeconds * 1000;\n    if (previousPrediction !== undefined) {\n      boostDriftSeconds = (observedReadyAt - previousPrediction) / 1000;\n      if (Math.abs(boostDriftSeconds) >= 0.75) {\n        log(`Cooldown sync: screen ${skill.cooldownSeconds}s · drift ${boostDriftSeconds >= 0 ? "+" : ""}${boostDriftSeconds.toFixed(2)}s → resynced.`);\n      }\n    } else {\n      boostDriftSeconds = undefined;\n    }\n    predictedReadyAt = observedReadyAt;\n  } else if (skill.state === "ready") {\n    predictedReadyAt = captureAt;\n    boostDriftSeconds = previousPrediction === undefined ? undefined : (captureAt - previousPrediction) / 1000;\n  } else if (skill.state === "active") {\n    predictedReadyAt = undefined;\n    boostDriftSeconds = undefined;\n  }\n  setChoppingSkill(skill);\n}\n\nfunction updateCounter',
'boost observation helper')

# Clear new timers.
s = replace_required(s,
'  clearTimer(counterTimer);\n  verifyTimer = undefined;',
'  clearTimer(counterTimer);\n  clearTimer(precisionTimer);\n  clearTimer(cooldownSyncTimer);\n  verifyTimer = undefined;',
'clear timers')
s = replace_required(s,
'  counterTimer = undefined;\n}',
'  counterTimer = undefined;\n  precisionTimer = undefined;\n  cooldownSyncTimer = undefined;\n}',
'clear timer vars')

# Faster post-E verification: initial quick check, then existing path. Keep fail-closed.
s = replace_required(s,
'    log(`Primary E ×5 finished. Verifying Chopping state in ${settings.verifyAfterPressSec}s.`);\n    scheduleVerify();',
'    const quickVerify = Math.min(0.8, settings.verifyAfterPressSec);\n    log(`Primary E ×5 finished. Fast verification in ${quickVerify.toFixed(2)}s.`);\n    scheduleVerify(quickVerify);',
'fast initial verify')

# Cooldown scheduling becomes sync-aware: periodic tiny boost OCR + precision wake.
old_sched = '''function scheduleCooldown(seconds: number) {\n  boostTotals.cooldownsRead = [...boostTotals.cooldownsRead, seconds].slice(-100);\n  const now = Date.now();\n  const sleepFor = seconds + settings.cooldownSafetySec;\n  boostCooldownReadyAt = now + seconds * 1000;\n  boostWakeAt = now + sleepFor * 1000;\n  setChoppingSkill({ state: "cooldown", cooldownSeconds: seconds, raw: choppingSkill.raw });\n  log(`Cooldown read: ${seconds}s. Local countdown is live; boost OCR sleeps until ${new Date(boostWakeAt).toLocaleTimeString()}.`);\n  boostCycle = undefined;\n  clearTimer(verifyTimer);\n  clearTimer(activeTimer);\n  clearTimer(recheckTimer);\n  void chrome.alarms.clear(BOOST_WAKE).then(() => {\n    chrome.alarms.create(BOOST_WAKE, { when: boostWakeAt! });\n  });\n}\n'''
new_sched = '''function scheduleCooldown(seconds: number) {\n  boostTotals.cooldownsRead = [...boostTotals.cooldownsRead, seconds].slice(-100);\n  const captureAt = lastBoostCaptureAt || Date.now();\n  predictedReadyAt = captureAt + seconds * 1000;\n  boostCooldownReadyAt = predictedReadyAt;\n  boostWakeAt = predictedReadyAt + settings.cooldownSafetySec * 1000;\n  setChoppingSkill({ state: "cooldown", cooldownSeconds: seconds, raw: choppingSkill.raw });\n  log(`Cooldown read: ${seconds}s at capture time. 15s sync armed; predicted Ready ${new Date(predictedReadyAt).toLocaleTimeString()}.`);\n  boostCycle = undefined;\n  clearTimer(verifyTimer);\n  clearTimer(activeTimer);\n  clearTimer(recheckTimer);\n  clearTimer(cooldownSyncTimer);\n  clearTimer(precisionTimer);\n  scheduleCooldownSync();\n}\n\nfunction scheduleCooldownSync() {\n  clearTimer(cooldownSyncTimer);\n  if (!settings.autoBoost || !predictedReadyAt || connectedTabId === undefined) return;\n  const remainingMs = predictedReadyAt - Date.now();\n  const precisionMs = settings.precisionWindowSec * 1000;\n  if (remainingMs <= precisionMs) {\n    enterPrecisionWindow();\n    return;\n  }\n  const nextMs = Math.max(500, Math.min(settings.cooldownSyncIntervalSec * 1000, remainingMs - precisionMs));\n  cooldownSyncTimer = self.setTimeout(() => void syncCooldown(), nextMs);\n}\n\nasync function syncCooldown() {\n  if (!settings.autoBoost || connectedTabId === undefined || boostFault) return;\n  try {\n    const before = predictedReadyAt;\n    const observed = await readBoost();\n    if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) {\n      if (before !== undefined && predictedReadyAt !== undefined) {\n        const drift = (predictedReadyAt - before) / 1000;\n        log(`15s Chopping sync: ${observed.cooldownSeconds}s on screen${Math.abs(drift) >= 0.05 ? ` · adjusted ${drift >= 0 ? "+" : ""}${drift.toFixed(2)}s` : " · matched"}.`);\n      }\n      scheduleCooldownSync();\n      return;\n    }\n    if (observed.state === "ready") {\n      log("15s Chopping sync saw Ready early; entering immediate activation.");\n      await beginBoostCycle();\n      return;\n    }\n    if (observed.state === "active") {\n      log("15s Chopping sync saw Active; waiting for cooldown value.");\n      scheduleActiveCheck();\n      return;\n    }\n    scheduleCooldownSync();\n  } catch (error) {\n    log(`15s Chopping sync failed: ${errorText(error)}; preserving last prediction.`, "warn");\n    scheduleCooldownSync();\n  }\n}\n\nfunction enterPrecisionWindow() {\n  clearTimer(precisionTimer);\n  if (!settings.autoBoost || connectedTabId === undefined || boostFault) return;\n  const remaining = predictedReadyAt ? Math.max(0, (predictedReadyAt - Date.now()) / 1000) : 0;\n  log(`Precision window started · predicted ${remaining.toFixed(2)}s remaining. Counter OCR deferred.`);\n  const tick = async () => {\n    if (!settings.autoBoost || connectedTabId === undefined || boostFault || boostCycle) return;\n    try {\n      const observed = await readBoost();\n      if (observed.state === "ready") {\n        const recognizedAt = Date.now();\n        log(`Ready confirmed from current Chopping crop · OCR finished ${Math.max(0, recognizedAt - (lastBoostCaptureAt || recognizedAt))}ms after capture.`);\n        await beginBoostCycle();\n        return;\n      }\n      if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) {\n        const ms = predictedReadyAt ? predictedReadyAt - Date.now() : observed.cooldownSeconds * 1000;\n        if (ms > settings.precisionWindowSec * 1000) { scheduleCooldownSync(); return; }\n      }\n      if (observed.state === "active") { scheduleActiveCheck(); return; }\n    } catch (error) {\n      log(`Precision Chopping read: ${errorText(error)}`, "warn");\n    }\n    precisionTimer = self.setTimeout(() => void tick(), 350);\n  };\n  precisionTimer = self.setTimeout(() => void tick(), Math.min(250, Math.max(50, remaining * 1000 - 500)));\n}\n'''
s = replace_required(s, old_sched, new_sched, 'cooldown scheduler')

# Prevent generic poll boost OCR while a synchronized cooldown prediction exists; dedicated scheduler owns it.
s = replace_required(s,
'    const boostSleeping = boostWakeAt !== undefined && now < boostWakeAt;\n    let boostReadRan = false;\n\n    if (settings.autoBoost && !boostFault && !boostCycle && !boostSleeping && now - lastBoostReadAt >= 2000) {',
'    const synchronizedCooldown = predictedReadyAt !== undefined && choppingSkill.state === "cooldown";\n    const boostSleeping = synchronizedCooldown || (boostWakeAt !== undefined && now < boostWakeAt);\n    let boostReadRan = false;\n\n    if (settings.autoBoost && !boostFault && !boostCycle && !boostSleeping && now - lastBoostReadAt >= 2000) {',
'poll defers to cooldown scheduler')

# Dumb mode auto-session: arm baseline and auto-start AFK after a confirmed counter increase.
s = replace_required(s,
'function updateCounter(value: number, sampleAt = Date.now()) {\n  const now = sampleAt;',
'function updateCounter(value: number, sampleAt = Date.now()) {\n  const now = sampleAt;\n  const dumbBaseline = dumbModeBaseline;',
'dumb baseline capture')
s = replace_required(s,
'  if (previous && value !== previous.value) {\n    const delta = value - previous.value;\n    log(`Blocks mined updated: ${previous.value.toLocaleString()} → ${value.toLocaleString()} (${delta >= 0 ? "+" : ""}${delta}).`);\n  }\n}',
'  if (previous && value !== previous.value) {\n    const delta = value - previous.value;\n    log(`Blocks mined updated: ${previous.value.toLocaleString()} → ${value.toLocaleString()} (${delta >= 0 ? "+" : ""}${delta}).`);\n  }\n  if (settings.dumbMode && !activeSession) {\n    if (!dumbBaseline) {\n      dumbModeBaseline = { value, at: now };\n      dumbModeArmed = true;\n      log("Dumb mode armed: waiting for Blocks mined to increase before auto-starting an AFK run.");\n    } else if (value > dumbBaseline.value) {\n      dumbModeArmed = false;\n      dumbModeBaseline = { value, at: now };\n      log(`Dumb mode detected mining (+${value - dumbBaseline.value || value - dumbBaseline.value} blocks). Auto-starting AFK run.`);\n      void startSession("afk", true);\n    }\n  }\n}',
'dumb auto session')
# Fix delta expression via simpler replace after above.
s = s.replace('log(`Dumb mode detected mining (+${value - dumbBaseline.value || value - dumbBaseline.value} blocks). Auto-starting AFK run.`);', 'log(`Dumb mode detected mining. Auto-starting AFK run.`);')

# Rename start session helper signature; replace function and command caller.
s = replace_required(s,
'async function startSession(miningType: MiningType) {',
'async function startSession(miningType: MiningType, fromDumbMode = false) {',
'startSession signature')
s = replace_required(s,
'  const snapshot = await readFullSnapshot(false);',
'  const snapshot = fromDumbMode && currentSnapshot?.blocksMined !== undefined ? { ...currentSnapshot, blocksMined: lastCounter?.value ?? currentSnapshot.blocksMined } : await readFullSnapshot(false);',
'dumb start avoids heavy full read')

# Settings application: Dumb mode forces auto connection, auto boost, live counter, 15s sync. Turning off clears arm state.
old_set = '''      settings = sanitizeSettings({ ...settings, ...message.patch });\n      await saveSettings();'''
new_set = '''      settings = sanitizeSettings({ ...settings, ...message.patch });\n      if (settings.dumbMode) {\n        settings.mode = "auto";\n        settings.autoBoost = true;\n        settings.liveCounter = true;\n        settings.cooldownSyncIntervalSec = 15;\n        dumbModeArmed = !activeSession;\n      } else {\n        dumbModeArmed = false;\n        dumbModeBaseline = undefined;\n      }\n      await saveSettings();'''
s = replace_required(s, old_set, new_set, 'dumb settings behavior')

# Status fields.
s = replace_required(s,
'    boostFault,\n    settings,',
'    boostFault,\n    predictedReadyAt,\n    lastBoostCaptureAt,\n    boostDriftSeconds,\n    dumbModeArmed,\n    settings,',
'status precision fields')

# Version comments not necessary. Write background.
p.write_text(s)

# UI
p = Path('src/views/LiveExtension.tsx')
s = p.read_text()
# 6 significant figures helper.
s = replace_required(s,
'function elapsed(startedAt?: string) {',
'function formatRate6(value?: number) {\n  if (value === undefined || !Number.isFinite(value)) return "—";\n  if (value === 0) return "0.00000";\n  return Number(value).toPrecision(6);\n}\n\nfunction elapsed(startedAt?: string) {',
'6sf helper')
s = replace_required(s,
'<Metric label="Rolling speed" value={formatRate(status.rollingBps)} suffix=" b/s" />',
'<Metric label="Rolling speed" value={formatRate6(status.rollingBps)} suffix=" b/s" />',
'rolling 6sf')
# Dumb mode UI master toggle after auto note.
anchor = '      {settings.mode === "auto" && <div className="mode-note">Auto detection is enabled. The extension connects when it sees <span className="mono">bloxd.io/play/oneBlock</span>; the <span className="mono">?lobby=</span> value does not affect detection.</div>}\n'
insert = anchor + '      <label className="switch-row"><span><strong>Dumb mode</strong><small>One switch: Auto connection + Auto Chopping + 15s cooldown sync + live counter. When Blocks mined first increases, automatically starts an AFK run. It does not auto-stop the run.</small></span><input type="checkbox" checked={settings.dumbMode} onChange={event => void patch({ dumbMode: event.target.checked })} /></label>\n      {settings.dumbMode && <div className="mode-note"><strong>Dumb mode:</strong> {status.sessionActive ? "AFK run recording" : status.dumbModeArmed ? "Armed · waiting for mining to start" : "Starting…"}</div>}\n'
s = replace_required(s, anchor, insert, 'dumb mode UI')
# Add precision fields to diagnostics strip.
s = replace_required(s,
'        <span>Viewport <strong>{status.viewportWidth && status.viewportHeight ? `${Math.round(status.viewportWidth)}×${Math.round(status.viewportHeight)}` : "—"}</strong></span>\n',
'        <span>Viewport <strong>{status.viewportWidth && status.viewportHeight ? `${Math.round(status.viewportWidth)}×${Math.round(status.viewportHeight)}` : "—"}</strong></span>\n        <span>Ready prediction <strong>{status.predictedReadyAt ? `${Math.max(0, (status.predictedReadyAt - Date.now()) / 1000).toFixed(2)}s` : "—"}</strong></span>\n        <span>Cooldown drift <strong>{status.boostDriftSeconds === undefined ? "—" : `${status.boostDriftSeconds >= 0 ? "+" : ""}${status.boostDriftSeconds.toFixed(2)}s`}</strong></span>\n',
'precision diagnostics')
# Change performance copy and add settings fields.
s = replace_required(s,
'<label className="field"><span>E burst gap (ms)</span><input type="number" min="75" max="600" step="25" value={settings.doubleTapGapMs} onChange={event => void patch({ doubleTapGapMs: Number(event.target.value) })} /></label>',
'<label className="field"><span>E burst gap (ms)</span><input type="number" min="75" max="600" step="25" value={settings.doubleTapGapMs} onChange={event => void patch({ doubleTapGapMs: Number(event.target.value) })} /></label>\n        <label className="field"><span>Cooldown sync interval (s)</span><input type="number" min="5" max="30" step="1" value={settings.cooldownSyncIntervalSec} onChange={event => void patch({ cooldownSyncIntervalSec: Number(event.target.value) })} /></label>\n        <label className="field"><span>Precision window (s)</span><input type="number" min="2" max="8" step="0.5" value={settings.precisionWindowSec} onChange={event => void patch({ precisionWindowSec: Number(event.target.value) })} /></label>',
'precision settings UI')
s = s.replace('Low-overhead mode: full sidebar OCR runs only on connect, run start/end, Refresh full panel, or Recalibrate. The live counter uses only a tiny crop at the interval above (20s default). Chopping uses its own tiny crop only around Ready / verification / cooldown transitions. During a known cooldown, boost OCR sleeps completely until the scheduled wake.', 'Precision low-overhead mode: full sidebar OCR stays limited to connect/start/end/manual refresh. During Chopping cooldown, only the tiny Chopping crop re-syncs every 15s by default. In the final precision window, counter OCR is deferred and Chopping is checked rapidly until the actual game says Ready; only then can E fire.')
p.write_text(s)

# Package/manifest versions.
for fn in ['package.json', 'extension/public/manifest.json']:
    p = Path(fn); s = p.read_text(); s = s.replace('"version": "0.3.3"', '"version": "0.3.4"'); p.write_text(s)

# README notes.
p = Path('README.md')
s = p.read_text().replace('v0.3.3', 'v0.3.4')
s += '\n\n### v0.3.4 precision boost + Dumb mode\n\nChopping cooldown observations are timestamped at screenshot capture time. A tiny Chopping-only OCR re-sync runs every 15 seconds by default, then enters a short precision window near predicted Ready and defers counter OCR until the actual Chopping crop confirms Ready. Rolling speed is shown to 6 significant figures and uses counter capture timestamps. Dumb mode forces Auto connection, Auto Chopping, 15-second sync, and live counter, and automatically starts an AFK run after it observes Blocks mined increasing. Dumb mode does not automatically stop the run.\n'
p.write_text(s)
