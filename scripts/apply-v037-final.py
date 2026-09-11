from pathlib import Path
import json, re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text()


def write(path, text):
    (ROOT / path).write_text(text)


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label):
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one regex match, found {count}")
    return new_text

# ---------------- reliability.ts ----------------
path = "src/extension/reliability.ts"
text = read(path)
insert = '''\nexport const BOUNDARY_E_OFFSETS_MS = [-1000, -600, -200, 200, 600, 1000] as const;\nexport const FINAL_LOCK_AGREEMENT_MS = 1_000;\n\n/** Final boundary lock is intentionally stricter than ordinary cooldown sync.\n * Two integer countdown samples must predict Ready within 1 second before the\n * low-latency scheduled input window is allowed. */\nexport function finalLockSamplesAgree(first: CooldownSample, second: CooldownSample): boolean {\n  return cooldownSamplesAgree(first, second, FINAL_LOCK_AGREEMENT_MS);\n}\n\n'''
marker = 'export type TransitionVerdict = "accept" | "confirm";\n'
text = replace_once(text, marker, insert + marker, "reliability boundary helpers")
write(path, text)

# ---------------- types.ts ----------------
path = "src/extension/types.ts"
text = read(path)
text = replace_once(
    text,
    'export type OffscreenWakeId = "boost-sync" | "boost-precision" | "boost-verify" | "boost-active" | "counter";',
    'export type OffscreenWakeId = "boost-sync" | "boost-precision" | "boost-boundary" | "boost-verify" | "boost-active" | "counter";',
    "boundary wake type"
)
write(path, text)

# ---------------- ocrCalibration.ts ----------------
path = "src/extension/ocrCalibration.ts"
text = read(path)
old_block = '''/**\n * Chopping's value is right-aligned in the Skill cell. Centering a micro crop\n * on the currently recognized token made the crop move when `149s`, `Ready`\n * and `Active` had different widths. Keep a wider, right-anchored cell instead\n * so one calibration remains valid through the whole state cycle.\n */\nfunction normalizedStateCellRect(\n  word: HocrWord,\n  imageWidth: number,\n  imageHeight: number\n): RelativeOcrRect | undefined {\n  if (imageWidth <= 0 || imageHeight <= 0) return undefined;\n  const wordHeight = word.y1 - word.y0;\n  // Fixed cell dimensions are intentional: centering width on the token itself\n  // made Ready/Active/149s produce different rectangles. The Skill value cell\n  // is right-aligned, so its capture geometry must not depend on token width.\n  const targetWidth = Math.min(imageWidth, imageWidth * 0.42);\n  const targetHeight = Math.min(imageHeight, Math.max(imageHeight * 0.22, wordHeight * 2.4));\n  const right = Math.min(imageWidth, word.x1 + wordHeight * 1.4);\n  const left = Math.max(0, Math.min(imageWidth - targetWidth, right - targetWidth));\n  const centerY = (word.y0 + word.y1) / 2;\n  const top = Math.max(0, Math.min(imageHeight - targetHeight, centerY - targetHeight / 2));\n  return {\n    x: left / imageWidth,\n    y: top / imageHeight,\n    width: Math.min(imageWidth - left, targetWidth) / imageWidth,\n    height: Math.min(imageHeight - top, targetHeight) / imageHeight\n  };\n}\n\nfunction resemblesChopping(value: string) {\n  return /^ch[o0]pp(?:ing|lng)$/i.test(value.replace(/[^a-z0-9]/gi, ""));\n}\n\nfunction resemblesState(value: string) {\n  const compact = value.replace(/\\s+/g, "");\n  return /^(ready|active)$/i.test(compact) || /^[0-9IlOo|]{1,5}s$/i.test(compact);\n}\n\nexport function findBoostStateRect(\n  words: HocrWord[],\n  imageWidth: number,\n  imageHeight: number\n): RelativeOcrRect | undefined {\n  const chopping = words.find(word => resemblesChopping(word.text));\n  if (!chopping) return undefined;\n  const choppingCenterY = (chopping.y0 + chopping.y1) / 2;\n  const lineHeight = Math.max(1, chopping.y1 - chopping.y0);\n  const candidates = words\n    .filter(word => resemblesState(word.text))\n    .filter(word => {\n      const centerY = (word.y0 + word.y1) / 2;\n      return centerY >= choppingCenterY - lineHeight * 0.35\n        && centerY <= choppingCenterY + lineHeight * 4.5;\n    })\n    .sort((a, b) => {\n      const ay = Math.max(0, (a.y0 + a.y1) / 2 - choppingCenterY);\n      const by = Math.max(0, (b.y0 + b.y1) / 2 - choppingCenterY);\n      return ay - by || b.x0 - a.x0;\n    });\n  const state = candidates[0];\n  if (!state) return undefined;\n  return normalizedStateCellRect(state, imageWidth, imageHeight);\n}\n'''
new_block = '''/**\n * Chopping's changing value (`Ready`, `Active`, `153s`, ...) is not a stable\n * calibration anchor. The literal `Skill:` label immediately to its left is.\n * Anchor the recurring micro-crop to that fixed word and capture only the value\n * cell to its right. This keeps geometry stable across the whole cooldown cycle\n * and gives the single-word OCR path more vertical breathing room.\n */\nfunction normalizedSkillValueRect(\n  skillAnchor: HocrWord,\n  imageWidth: number,\n  imageHeight: number\n): RelativeOcrRect | undefined {\n  if (imageWidth <= 0 || imageHeight <= 0) return undefined;\n  const wordHeight = Math.max(1, skillAnchor.y1 - skillAnchor.y0);\n  const left = Math.max(0, Math.min(imageWidth - 1, skillAnchor.x1 + wordHeight * 0.12));\n  const targetWidth = Math.min(imageWidth - left, imageWidth * 0.34);\n  const targetHeight = Math.min(imageHeight, Math.max(imageHeight * 0.28, wordHeight * 2.8));\n  const centerY = (skillAnchor.y0 + skillAnchor.y1) / 2;\n  const top = Math.max(0, Math.min(imageHeight - targetHeight, centerY - targetHeight / 2));\n  return {\n    x: left / imageWidth,\n    y: top / imageHeight,\n    width: targetWidth / imageWidth,\n    height: targetHeight / imageHeight\n  };\n}\n\nfunction resemblesChopping(value: string) {\n  return /^ch[o0]pp(?:ing|lng)$/i.test(value.replace(/[^a-z0-9]/gi, ""));\n}\n\nfunction resemblesSkillAnchor(value: string) {\n  return /^skill[:=]?$/i.test(value.replace(/\\s+/g, ""));\n}\n\nexport function findBoostStateRect(\n  words: HocrWord[],\n  imageWidth: number,\n  imageHeight: number\n): RelativeOcrRect | undefined {\n  const chopping = words.find(word => resemblesChopping(word.text));\n  if (!chopping) return undefined;\n  const choppingCenterY = (chopping.y0 + chopping.y1) / 2;\n  const lineHeight = Math.max(1, chopping.y1 - chopping.y0);\n  const anchors = words\n    .filter(word => resemblesSkillAnchor(word.text))\n    .filter(word => {\n      const centerY = (word.y0 + word.y1) / 2;\n      return centerY >= choppingCenterY - lineHeight * 0.35\n        && centerY <= choppingCenterY + lineHeight * 4.5;\n    })\n    .sort((a, b) => {\n      const ay = Math.max(0, (a.y0 + a.y1) / 2 - choppingCenterY);\n      const by = Math.max(0, (b.y0 + b.y1) / 2 - choppingCenterY);\n      return ay - by || b.x0 - a.x0;\n    });\n  const skillAnchor = anchors[0];\n  if (!skillAnchor) return undefined;\n  return normalizedSkillValueRect(skillAnchor, imageWidth, imageHeight);\n}\n'''
text = replace_once(text, old_block, new_block, "Skill-anchor crop")
write(path, text)

# ---------------- background-v3.ts ----------------
path = "extension/background-v3.ts"
text = read(path)
text = replace_once(
    text,
    'import { OcrDeadlineError, PriorityOcrQueue, cooldownReadyEstimateMs, cooldownSamplesAgree, cooldownSyncDelayMs, isStaleObservation, precisionProbePlan, transitionVerdict, type OcrWorkClass } from "../src/extension/reliability";',
    'import { BOUNDARY_E_OFFSETS_MS, OcrDeadlineError, PriorityOcrQueue, cooldownReadyEstimateMs, cooldownSamplesAgree, cooldownSyncDelayMs, finalLockSamplesAgree, isStaleObservation, transitionVerdict, type OcrWorkClass } from "../src/extension/reliability";',
    "background reliability import"
)
text = replace_once(
    text,
    'let precisionWindowActive = false;\nlet dumbModeArmed = false;',
    'let precisionWindowActive = false;\nlet finalLockSample: { seconds: number; captureAt: number } | undefined;\nlet finalLockAttempts = 0;\nlet finalLockConfirmed = false;\nlet boundaryBurstRunning = false;\nlet boundaryWakeAt: number | undefined;\nlet dumbModeArmed = false;',
    "boundary state variables"
)
text = replace_once(
    text,
    'for (const id of ["boost-sync", "boost-precision", "boost-verify", "boost-active"] as OffscreenWakeId[]) {',
    'for (const id of ["boost-sync", "boost-precision", "boost-boundary", "boost-verify", "boost-active"] as OffscreenWakeId[]) {',
    "cancel boundary wake"
)
# Keep the immutable full snapshot separate from live Chopping state.
text = replace_once(
    text,
    '  if (currentSnapshot) {\n    currentSnapshot.chopping = { ...(currentSnapshot.chopping || {}), skill };\n  }\n',
    '',
    "do not mutate full snapshot with live Chopping"
)
# Defer two ordinary misses before a larger same-profile fallback.
text = replace_once(text, 'if (!critical && boostMisses < 1) {', 'if (!critical && boostMisses < 2) {', "micro fallback threshold")
# Boundary state reset helper and critical counter blackout.
old_clear = '''function clearShortTimers() {\n  precisionWindowActive = false;\n  quickTransitionConfirm = false;\n  pendingTransitionConfirm = undefined;\n  cancelAllBoostWakes();\n}\n'''
new_clear = '''function resetBoundaryState() {\n  finalLockSample = undefined;\n  finalLockAttempts = 0;\n  finalLockConfirmed = false;\n  boundaryBurstRunning = false;\n  boundaryWakeAt = undefined;\n  void cancelOffscreenWake("boost-boundary");\n}\n\nfunction clearShortTimers() {\n  precisionWindowActive = false;\n  quickTransitionConfirm = false;\n  pendingTransitionConfirm = undefined;\n  resetBoundaryState();\n  cancelAllBoostWakes();\n}\n'''
text = replace_once(text, old_clear, new_clear, "boundary reset helper")
old_counter = '''  const nearReady = settings.autoBoost && predictedReadyAt !== undefined\n    && predictedReadyAt - Date.now() <= settings.precisionWindowSec * 1000 + 2_000;\n  if (precisionWindowActive || nearReady) {\n'''
new_counter = '''  const nearReady = settings.autoBoost && predictedReadyAt !== undefined\n    && predictedReadyAt - Date.now() <= Math.max(9_000, (settings.precisionWindowSec + 3) * 1000);\n  if (precisionWindowActive || boundaryBurstRunning || Boolean(boostCycle) || nearReady) {\n'''
text = replace_once(text, old_counter, new_counter, "critical counter blackout")
# Focus once; the boundary path reuses the same helper without re-running it per E.
old_press_prefix = '''async function pressEBurst(count: number, label: string) {\n  log(`${label}: attempting E ×${count}.`);\n  await debuggerCommand("Page.bringToFront");\n  try {\n    await debuggerCommand("Runtime.evaluate", {\n      expression: `(function(){const cs=[...document.querySelectorAll('canvas')].filter(c=>c.offsetWidth>0&&c.offsetHeight>0);const c=cs.sort((a,b)=>(b.offsetWidth*b.offsetHeight)-(a.offsetWidth*a.offsetHeight))[0];if(c){if(!c.hasAttribute('tabindex'))c.tabIndex=-1;c.focus({preventScroll:true});return 'canvas';}if(document.body){if(!document.body.hasAttribute('tabindex'))document.body.tabIndex=-1;document.body.focus({preventScroll:true});return 'body';}return 'page';})()`,\n      returnByValue: true\n    });\n    log(`${label}: Bloxd game surface focused.`);\n  } catch (error) {\n    log(`${label}: focus helper failed (${errorText(error)}); continuing with page focus.`, "warn");\n  }\n  await delay(80);\n'''
new_press_prefix = '''async function focusGameSurface(label: string) {\n  await debuggerCommand("Page.bringToFront");\n  try {\n    await debuggerCommand("Runtime.evaluate", {\n      expression: `(function(){const cs=[...document.querySelectorAll('canvas')].filter(c=>c.offsetWidth>0&&c.offsetHeight>0);const c=cs.sort((a,b)=>(b.offsetWidth*b.offsetHeight)-(a.offsetWidth*a.offsetHeight))[0];if(c){if(!c.hasAttribute('tabindex'))c.tabIndex=-1;c.focus({preventScroll:true});return 'canvas';}if(document.body){if(!document.body.hasAttribute('tabindex'))document.body.tabIndex=-1;document.body.focus({preventScroll:true});return 'body';}return 'page';})()`,\n      returnByValue: true\n    });\n    log(`${label}: Bloxd game surface focused.`);\n  } catch (error) {\n    log(`${label}: focus helper failed (${errorText(error)}); continuing with page focus.`, "warn");\n  }\n  await delay(50);\n}\n\nasync function pressEBurst(count: number, label: string) {\n  log(`${label}: attempting E ×${count}.`);\n  await focusGameSurface(label);\n'''
text = replace_once(text, old_press_prefix, new_press_prefix, "focus helper refactor")
# Final-lock scheduling replaces continuous Ready probing on the trusted path.
old_precision_schedule = '''  // Bloxd displays whole seconds, so a visible `2s` is an interval rather than\n  // an exact 2.000-second boundary. Start the cheap watcher 1.5s early so a\n  // real Ready is observed promptly instead of waiting for the local timer to 0.\n  const precisionLeadMs = settings.precisionWindowSec * 1000 + 1_500;\n  const precisionAt = Math.max(now + 50, predictedReadyAt - precisionLeadMs);\n  void scheduleOffscreenWake("boost-precision", precisionAt);\n'''
new_precision_schedule = '''  // v0.3.7 does not OCR-loop across the Ready boundary. Wake early enough for\n  // two authoritative countdown reads, lock the boundary, then black out OCR\n  // and cover the transition with scheduled E presses.\n  const finalLockLeadMs = Math.max(6_000, (settings.precisionWindowSec + 2) * 1000);\n  const precisionAt = Math.max(now + 50, predictedReadyAt - finalLockLeadMs);\n  void scheduleOffscreenWake("boost-precision", precisionAt);\n'''
text = replace_once(text, old_precision_schedule, new_precision_schedule, "final lock scheduling")
# Reset boundary state when a new cooldown cycle begins.
text = replace_once(
    text,
    '  boostStateEpoch += 1;\n\n  // applyBoostObservation owns cooldown authority.',
    '  boostStateEpoch += 1;\n  resetBoundaryState();\n\n  // applyBoostObservation owns cooldown authority.',
    "cooldown boundary reset"
)
# Replace the old repeated precision OCR watcher with two-sample lock + scheduled boundary input.
pattern = r'function enterPrecisionWindow\(\) \{.*?\n\}\n\nasync function beginBoostCycle\(\) \{'
replacement = '''function enterPrecisionWindow() {\n  if (precisionWindowActive || !settings.autoBoost || connectedTabId === undefined || boostFault || predictedReadyAt === undefined) return;\n  precisionWindowActive = true;\n  finalLockSample = undefined;\n  finalLockAttempts = 0;\n  finalLockConfirmed = false;\n  boundaryWakeAt = undefined;\n  void cancelOffscreenWake("boost-sync");\n  void cancelOffscreenWake("counter");\n  nextCooldownSyncAt = 0;\n  setPowerState("precision");\n  const remaining = Math.max(0, (predictedReadyAt - Date.now()) / 1000);\n  log(`Final timing lock started at ${remaining.toFixed(2)}s predicted remaining. Counter OCR is blacked out until activation verification.`, "info", {\n    category: "timer", event: "boundary.lock_started", details: { remainingSeconds: remaining }\n  });\n  void scheduleOffscreenWake("boost-precision", Date.now() + 50);\n}\n\nfunction scheduleBoundaryBurst() {\n  if (!settings.autoBoost || connectedTabId === undefined || boostFault || predictedReadyAt === undefined || !finalLockConfirmed) return;\n  void cancelOffscreenWake("boost-sync");\n  void cancelOffscreenWake("boost-precision");\n  void cancelOffscreenWake("counter");\n  boundaryWakeAt = Math.max(Date.now() + 25, predictedReadyAt - 1_300);\n  setPowerState("precision");\n  log(`Final timing lock accepted. OCR/counter blackout armed; boundary input wake in ${Math.max(0, boundaryWakeAt - Date.now())}ms.`, "info", {\n    category: "timer", event: "boundary.armed", details: { predictedReadyAt, boundaryWakeAt, uncertaintySec: cooldownUncertaintySec }\n  });\n  void scheduleOffscreenWake("boost-boundary", boundaryWakeAt);\n  // Chrome alarm is only a coarse fallback if the offscreen wake is lost.\n  void chrome.alarms.clear(BOOST_WAKE).then(() => {\n    chrome.alarms.create(BOOST_WAKE, { when: Math.max(Date.now() + 1000, predictedReadyAt! + 250) });\n  });\n}\n\nasync function precisionBoostTick() {\n  if (!precisionWindowActive || !settings.autoBoost || connectedTabId === undefined || boostFault || boostCycle || predictedReadyAt === undefined) return;\n  try {\n    const observed = await readBoost("boost-critical", { noProfileFallback: true });\n    if (observed.state === "ready") {\n      precisionWindowActive = false;\n      finalLockConfirmed = false;\n      log("Actual Ready appeared during final timing lock; taking the direct activation path immediately.", "info", { category: "chopping", event: "boundary.ready_early" });\n      await beginBoostCycle();\n      return;\n    }\n    if (observed.state === "active") {\n      precisionWindowActive = false;\n      resetBoundaryState();\n      scheduleActiveCheck();\n      return;\n    }\n    if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined && lastBoostCaptureAt !== undefined) {\n      const sample = { seconds: observed.cooldownSeconds, captureAt: lastBoostCaptureAt };\n      finalLockAttempts += 1;\n      if (!finalLockSample) {\n        finalLockSample = sample;\n        log(`Final timing lock sample 1: ${sample.seconds}s. Taking the confirming sample in 0.45s.`, "debug", {\n          category: "timer", event: "boundary.lock_sample", details: { sample: 1, seconds: sample.seconds, captureAt: sample.captureAt }\n        });\n        void scheduleOffscreenWake("boost-precision", Date.now() + 450);\n        return;\n      }\n\n      if (finalLockSamplesAgree(finalLockSample, sample)) {\n        const firstReadyAt = cooldownReadyEstimateMs(finalLockSample);\n        const secondReadyAt = cooldownReadyEstimateMs(sample);\n        predictedReadyAt = Math.round((firstReadyAt + secondReadyAt) / 2);\n        boostCooldownReadyAt = predictedReadyAt;\n        const disagreementMs = Math.abs(firstReadyAt - secondReadyAt);\n        cooldownUncertaintySec = Math.max(0.5, Math.min(1, 0.5 + disagreementMs / 2000));\n        finalLockConfirmed = true;\n        finalLockSample = undefined;\n        log(`Final timing lock confirmed from two countdown reads; Ready boundary ${new Date(predictedReadyAt).toLocaleTimeString()} with ≤±${cooldownUncertaintySec.toFixed(2)}s modeled uncertainty.`, "info", {\n          category: "timer", event: "boundary.lock_confirmed", details: { predictedReadyAt, disagreementMs, attempts: finalLockAttempts }\n        });\n        scheduleBoundaryBurst();\n        return;\n      }\n\n      rejectedOcrCount += 1;\n      log(`Final timing lock samples disagreed (${finalLockSample.seconds}s → ${sample.seconds}s); the newer sample replaces the older candidate.`, "warn", {\n        category: "timer", event: "boundary.lock_rejected", details: { firstSeconds: finalLockSample.seconds, secondSeconds: sample.seconds }\n      });\n      finalLockSample = sample;\n      const remainingMs = predictedReadyAt - Date.now();\n      if (finalLockAttempts < 4 && remainingMs > 1_800) {\n        void scheduleOffscreenWake("boost-precision", Date.now() + 350);\n        return;\n      }\n    }\n\n    // If the strict timer lock cannot be established, do not blind-fire a\n    // boundary burst. Fall back to rapid actual-state confirmation. This path\n    // is intentionally less deterministic but remains fail-closed.\n    finalLockConfirmed = false;\n    const remainingMs = predictedReadyAt - Date.now();\n    if (remainingMs > -1_000) {\n      const retryMs = fastRecognizerReady && boostMicroCrop ? 180 : 350;\n      log(`Final timing lock is not trustworthy; using rapid Ready-confirmation fallback in ${retryMs}ms.`, "warn", {\n        category: "timer", event: "boundary.fallback_ready_ocr", details: { remainingMs, retryMs }\n      });\n      void scheduleOffscreenWake("boost-precision", Date.now() + retryMs);\n      return;\n    }\n    precisionWindowActive = false;\n    log("Final timing lock expired without a trustworthy boundary. No blind E was sent; retrying a safe state read.", "warn", { category: "timer", event: "boundary.lock_failed" });\n    scheduleRecheck(0.15);\n  } catch (error) {\n    finalLockConfirmed = false;\n    log(`Final timing lock read failed: ${errorText(error)}. No blind boundary input was armed.`, "warn", { category: "timer", event: "boundary.lock_error" });\n    if (predictedReadyAt - Date.now() > -1_000) void scheduleOffscreenWake("boost-precision", Date.now() + 350);\n    else scheduleRecheck(0.15);\n  }\n}\n\nasync function runBoundaryActivation() {\n  if (!settings.autoBoost || boostFault || connectedTabId === undefined || boostCycle || boundaryBurstRunning || !finalLockConfirmed || predictedReadyAt === undefined) return;\n  const boundary = predictedReadyAt;\n  boundaryBurstRunning = true;\n  boundaryWakeAt = undefined;\n  boostCycle = { retryUsed: false, confirmed: false, ambiguousReads: 0, readyConfirmReads: 0 };\n  setPowerState("activating");\n  boostStateEpoch += 1;\n  pendingTransitionConfirm = undefined;\n  quickTransitionConfirm = false;\n  void cancelOffscreenWake("boost-sync");\n  void cancelOffscreenWake("boost-precision");\n  void cancelOffscreenWake("counter");\n  void chrome.alarms.clear(BOOST_WAKE);\n\n  try {\n    await focusGameSurface("Boundary boost input");\n    let sent = 0;\n    for (let index = 0; index < BOUNDARY_E_OFFSETS_MS.length; index += 1) {\n      const offsetMs = BOUNDARY_E_OFFSETS_MS[index];\n      const targetAt = boundary + offsetMs;\n      const lateBy = Date.now() - targetAt;\n      if (lateBy > 140 && index < BOUNDARY_E_OFFSETS_MS.length - 1) {\n        log(`Boundary E ${index + 1}/${BOUNDARY_E_OFFSETS_MS.length} skipped because its target was already ${lateBy}ms stale.`, "debug", {\n          category: "input", event: "input.boundary_skipped", details: { index: index + 1, offsetMs, lateByMs: lateBy }\n        });\n        continue;\n      }\n      const waitMs = targetAt - Date.now();\n      if (waitMs > 0) await delay(waitMs);\n      const dispatchAt = Date.now();\n      await keyE();\n      sent += 1;\n      log(`Boundary E ${index + 1}/${BOUNDARY_E_OFFSETS_MS.length} sent at ${dispatchAt - boundary >= 0 ? "+" : ""}${dispatchAt - boundary}ms vs predicted Ready.`, "debug", {\n        category: "input", event: "input.boundary_e", details: { index: index + 1, offsetMs, dispatchOffsetMs: dispatchAt - boundary }\n      });\n    }\n    if (sent === 0) {\n      const dispatchAt = Date.now();\n      await keyE();\n      sent = 1;\n      log("Boundary wake arrived after all planned slots; sent one immediate recovery E instead of replaying stale taps.", "warn", {\n        category: "input", event: "input.boundary_late", details: { dispatchOffsetMs: dispatchAt - boundary }\n      });\n    }\n    boundaryBurstRunning = false;\n    precisionWindowActive = false;\n    finalLockConfirmed = false;\n    log(`Boundary activation window completed with ${sent} E press${sent === 1 ? "" : "es"}. One verification read follows in 0.45s.`, "info", {\n      category: "input", event: "input.boundary_complete", details: { sent, predictedReadyAt: boundary }\n    });\n    scheduleVerify(0.45);\n  } catch (error) {\n    boundaryBurstRunning = false;\n    precisionWindowActive = false;\n    finalLockConfirmed = false;\n    boostCycle = undefined;\n    boostFault = `Could not send boundary E input: ${errorText(error)}`;\n    setPowerState("fault");\n    scheduleCounter(1_000);\n    log(boostFault, "error", { category: "input", event: "input.boundary_fault" });\n  }\n}\n\nasync function beginBoostCycle() {'''
text = regex_once(text, pattern, replacement, "replace precision watcher")
# Direct Ready path must cancel a pending boundary window first.
text = replace_once(
    text,
    '    precisionWindowActive = false;\n    void cancelOffscreenWake("boost-sync");\n    void cancelOffscreenWake("boost-precision");',
    '    precisionWindowActive = false;\n    finalLockConfirmed = false;\n    boundaryBurstRunning = false;\n    boundaryWakeAt = undefined;\n    void cancelOffscreenWake("boost-sync");\n    void cancelOffscreenWake("boost-precision");\n    void cancelOffscreenWake("boost-boundary");',
    "direct Ready cancels boundary"
)
# Resume counter sampling once activation has actually been confirmed.
text = replace_once(
    text,
    '    if (boostCycle) boostCycle.confirmed = true;\n    queueUiBroadcast();',
    '    if (boostCycle) boostCycle.confirmed = true;\n    scheduleCounter(1_000);\n    queueUiBroadcast();',
    "resume counter after boost success"
)
# Current sidebar snapshot must remain the last full read, not a synthetic live overlay.
old_live_snapshot = '''  const liveSnapshot = currentSnapshot ? { ...currentSnapshot } : undefined;\n  if (liveSnapshot && liveChoppingSkill.state !== "unknown") {\n    liveSnapshot.chopping = { ...(liveSnapshot.chopping || {}), skill: liveChoppingSkill };\n  }\n'''
new_live_snapshot = '  const liveSnapshot = currentSnapshot ? { ...currentSnapshot } : undefined;\n'
text = replace_once(text, old_live_snapshot, new_live_snapshot, "preserve full snapshot")
# Handle the dedicated boundary wake before generic boost state reads.
old_wake_case = '''        if (!settings.autoBoost || connectedTabId === undefined || boostFault) return { ok: true, status: status() };\n        if (command.id === "boost-precision") {\n          if (!precisionWindowActive) enterPrecisionWindow();\n          else await precisionBoostTick();\n        } else if (command.id === "boost-verify") {\n'''
new_wake_case = '''        if (!settings.autoBoost || connectedTabId === undefined || boostFault) return { ok: true, status: status() };\n        if (command.id === "boost-boundary") {\n          await runBoundaryActivation();\n        } else if (command.id === "boost-precision") {\n          if (!precisionWindowActive) enterPrecisionWindow();\n          else await precisionBoostTick();\n        } else if (command.id === "boost-verify") {\n'''
text = replace_once(text, old_wake_case, new_wake_case, "boundary wake handler")
# Coarse alarm only rescues a lost offscreen boundary wake; it must not start OCR in parallel.
old_alarm = '''chrome.alarms.onAlarm.addListener(alarm => {\n  if (alarm.name !== BOOST_WAKE) return;\n  boostWakeAt = undefined;\n  if (precisionWindowActive) {\n    log("Cooldown wake alarm fired while precision watcher is already active; duplicate OCR skipped.");\n    return;\n  }\n  log("Cooldown wake alarm fired; checking Chopping state now.");\n  void ensureLoaded().then(wakeBoost);\n});\n'''
new_alarm = '''chrome.alarms.onAlarm.addListener(alarm => {\n  if (alarm.name !== BOOST_WAKE) return;\n  boostWakeAt = undefined;\n  if (boundaryBurstRunning || boostCycle) return;\n  if (finalLockConfirmed && predictedReadyAt !== undefined) {\n    log("Boundary fallback alarm fired; invoking the already-locked input window without starting OCR.", "warn", { category: "timer", event: "boundary.alarm_fallback" });\n    void ensureLoaded().then(runBoundaryActivation);\n    return;\n  }\n  if (precisionWindowActive) {\n    log("Cooldown wake alarm fired while final timing lock is active; duplicate OCR skipped.");\n    return;\n  }\n  log("Cooldown wake alarm fired without a final lock; checking Chopping state now.");\n  void ensureLoaded().then(wakeBoost);\n});\n'''
text = replace_once(text, old_alarm, new_alarm, "boundary alarm fallback")
write(path, text)

# ---------------- tests: reliability ----------------
path = "src/extension/reliability.test.ts"
text = read(path)
text = replace_once(
    text,
    '  PriorityOcrQueue,\n',
    '  BOUNDARY_E_OFFSETS_MS,\n  PriorityOcrQueue,\n',
    "test import boundary offsets"
)
text = replace_once(
    text,
    '  cooldownSyncDelayMs,\n',
    '  cooldownSyncDelayMs,\n  finalLockSamplesAgree,\n',
    "test import final lock"
)
append = '''\n\ndescribe("v0.3.7 final boundary lock", () => {\n  it("requires tighter agreement than ordinary cooldown recovery", () => {\n    const first = { seconds: 7, captureAt: 100_000 };\n    const good = { seconds: 6, captureAt: 101_000 };\n    const tooFar = { seconds: 7, captureAt: 101_000 };\n    expect(finalLockSamplesAgree(first, good)).toBe(true);\n    expect(finalLockSamplesAgree(first, tooFar)).toBe(false);\n  });\n\n  it("covers a two-second Ready uncertainty window with no gap above 400ms", () => {\n    expect(BOUNDARY_E_OFFSETS_MS[0]).toBe(-1000);\n    expect(BOUNDARY_E_OFFSETS_MS.at(-1)).toBe(1000);\n    for (let index = 1; index < BOUNDARY_E_OFFSETS_MS.length; index += 1) {\n      expect(BOUNDARY_E_OFFSETS_MS[index] - BOUNDARY_E_OFFSETS_MS[index - 1]).toBeLessThanOrEqual(400);\n    }\n  });\n});\n'''
if 'describe("v0.3.7 final boundary lock"' in text:
    raise SystemExit("reliability tests already patched")
text += append
write(path, text)

# ---------------- tests: calibration ----------------
path = "src/extension/ocrCalibration.test.ts"
text = read(path)
needle = '''    expect(Math.abs(ready.width - cooldown.width)).toBeLessThan(0.03);\n  });\n'''
replacement = '''    expect(Math.abs(ready.width - cooldown.width)).toBeLessThan(0.03);\n    expect(ready.x).toBeCloseTo(active.x, 6);\n    expect(ready.x).toBeCloseTo(cooldown.x, 6);\n    expect(ready.y).toBeCloseTo(active.y, 6);\n    expect(ready.y).toBeCloseTo(cooldown.y, 6);\n  });\n\n  it("anchors the Chopping value crop to Skill: rather than the changing state token", () => {\n    const movedReady = fixture.replace("bbox 275 115 350 140'>Ready", "bbox 285 115 365 140'>Ready");\n    const a = findBoostStateRect(parseHocrWords(fixture), 400, 240)!;\n    const b = findBoostStateRect(parseHocrWords(movedReady), 400, 240)!;\n    expect(a).toEqual(b);\n  });\n'''
text = replace_once(text, needle, replacement, "Skill anchor tests")
write(path, text)

# ---------------- Live UI wording ----------------
path = "src/views/LiveExtension.tsx"
text = read(path)
text = replace_once(text, '<Section title="Current sidebar read">', '<Section title="Last full sidebar snapshot">', "snapshot section label")
text = replace_once(
    text,
    '<span><strong>Auto-use Chopping skill</strong><small>Chopping Ready → E ×5 → fast verify. If Ready is confirmed twice, one backup E ×3 burst is sent. Neighboring Digging/Gold Ready states cannot trigger E.</small></span>',
    '<span><strong>Auto-use Chopping skill</strong><small>Trusted cooldowns use a six-tap scheduled boundary window around predicted Ready, with OCR/counter work blacked out at the transition. If timing cannot be locked safely, it falls back to actual Ready confirmation. One backup E ×3 remains the only retry.</small></span>',
    "Chopping behavior copy"
)
text = text.replace('v0.3.5 low-overhead mode:', 'v0.3.7 low-overhead mode:')
write(path, text)

# ---------------- version bump ----------------
for file in ["package.json", "extension/public/manifest.json"]:
    data = json.loads(read(file))
    data["version"] = "0.3.7"
    write(file, json.dumps(data, indent=2) + "\n")

# ---------------- README ----------------
path = "README.md"
text = read(path)
text = text.replace("v0.3.6", "v0.3.7")
anchor = "Chopping cooldown: sleep between scheduled tiny reads"
if anchor in text and "scheduled six-tap boundary" not in text:
    text = text.replace(anchor, anchor + "; the final trusted boundary uses a scheduled six-tap E window with OCR/counter blackout")
write(path, text)

# ---------------- audit ----------------
path = "scripts/audit-extension.mjs"
text = read(path)
text = text.replace('"0.3.6"', '"0.3.7"').replace('expected 0.3.6', 'expected 0.3.7').replace('v0.3.6', 'v0.3.7')
# Replace the v0.3.6 precision assertions with v0.3.7 boundary invariants.
old_audit = '''expect(background.includes("precisionLeadMs"), "precision watcher does not start ahead of integer countdown zero");\nexpect(background.includes('cancelOffscreenWake("boost-sync")'), "normal cooldown sync is not cancelled when precision owns the boundary");\nexpect(background.includes("fastRecognizerReady"), "background does not track whether fast Ready/Active matching is actually trained");\nexpect(background.includes("noProfileFallback: true"), "precision reads can still trigger multi-profile fallback hunting");\nexpect(background.includes("micro.miss_deferred"), "single micro-crop misses still immediately trigger larger fallback work");\nexpect(background.includes("boost.profile_recovery_deferred"), "multi-profile recovery is not staged after transient misses");\nexpect(background.includes("await delay(25);"), "E key down/up still has no deliberate hold interval");\nexpect(background.includes("metadata.retry"), "missing Phase metadata has no one-time connection retry");\n\nexpect(background.includes("fastOnly"), "precision fast-only path is missing");\nexpect(background.includes("precisionProbePlan"), "bounded precision probe scheduler is missing");\n'''
new_audit = '''expect(background.includes("boundary.lock_confirmed"), "strict two-read final timing lock is missing");\nexpect(background.includes("finalLockSamplesAgree"), "final boundary lock is not using the stricter agreement rule");\nexpect(background.includes('scheduleOffscreenWake("boost-boundary"'), "dedicated boundary input wake is missing");\nexpect(background.includes("BOUNDARY_E_OFFSETS_MS"), "scheduled boundary E coverage is missing");\nexpect(background.includes('cancelOffscreenWake("counter")'), "counter blackout is missing near the activation boundary");\nexpect(background.includes("boundaryBurstRunning || Boolean(boostCycle) || nearReady"), "counter can still start during the critical input/verification window");\nexpect(background.includes("noProfileFallback: true"), "final lock reads can still trigger multi-profile fallback hunting");\nexpect(background.includes("micro.miss_deferred"), "single micro-crop misses still immediately trigger larger fallback work");\nexpect(background.includes("boost.profile_recovery_deferred"), "multi-profile recovery is not staged after transient misses");\nexpect(background.includes("await delay(25);"), "E key down/up still has no deliberate hold interval");\nexpect(background.includes("metadata.retry"), "missing Phase metadata has no one-time connection retry");\n\nconst boundaryStart = background.indexOf("async function runBoundaryActivation()");\nconst boundaryEnd = background.indexOf("async function beginBoostCycle()", boundaryStart);\nexpect(boundaryStart >= 0 && boundaryEnd > boundaryStart, "boundary activation function could not be isolated");\nconst boundaryBlock = background.slice(boundaryStart, boundaryEnd);\nexpect(!boundaryBlock.includes("readBoost("), "boundary input window performs Chopping OCR");\nexpect(!boundaryBlock.includes("readCounter("), "boundary input window performs counter OCR");\nexpect(!boundaryBlock.includes("captureOcr("), "boundary input window performs screenshot/OCR capture");\n'''
text = replace_once(text, old_audit, new_audit, "v0.3.7 audit invariants")
old_cal_audit = '''expect(calibration.includes("normalizedStateCellRect"), "stable Chopping Skill-cell crop helper is missing");\nexpect(calibration.includes("imageWidth * 0.42"), "Chopping state-cell width is not fixed across Ready/Active/cooldown token widths");\nexpect(!calibration.includes("wordWidth * 2.2"), "Chopping state crop still depends on current token width");\n'''
new_cal_audit = '''expect(calibration.includes("normalizedSkillValueRect"), "Skill:-anchored Chopping value crop helper is missing");\nexpect(calibration.includes("resemblesSkillAnchor"), "Chopping crop is not anchored to the stable Skill: label");\nexpect(calibration.includes("skillAnchor.x1"), "Chopping value crop does not start from the fixed Skill: anchor");\n'''
text = replace_once(text, old_cal_audit, new_cal_audit, "crop audit")
# v0.3.7 no longer relies on precisionProbePlan in the background normal path.
text = text.replace('expect(reliability.includes("fastRecognizerReady"), "precision planner is not gated on fast recognizer readiness");\nexpect(/fastOnly\\s*=\\s*options\\.hasMicroCrop\\s*&&\\s*options\\.fastRecognizerReady/.test(reliability), "fast-only probing can run before the matcher is trained");\n', 'expect(reliability.includes("FINAL_LOCK_AGREEMENT_MS = 1_000"), "final lock agreement is not capped at 1 second");\nexpect(reliability.includes("BOUNDARY_E_OFFSETS_MS"), "boundary E coverage constants are missing");\n')
# Require temp v0.3.7 helpers to be gone from the release commit.
needle = '  ".github/workflows/tune-v036-runtime.yml"\n]) {'
repl = '  ".github/workflows/tune-v036-runtime.yml",\n  "scripts/apply-v037-final.py",\n  ".github/workflows/apply-v037-final.yml"\n]) {'
text = replace_once(text, needle, repl, "audit temporary v037 files")
text = text.replace('console.log("Extension audit passed: v0.3.7 source, live-regression safeguards, passive monitor, low-overhead scheduling, build output and OCR assets are internally consistent.");', 'console.log("Extension audit passed: v0.3.7 strict boundary lock, OCR blackout, Skill-anchor crop, live-regression safeguards, passive monitor, build output and OCR assets are internally consistent.");')
write(path, text)

print("v0.3.7 deterministic migration applied")
