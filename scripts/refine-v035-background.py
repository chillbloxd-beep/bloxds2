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
    start_i = text.find(start)
    if start_i < 0:
        raise SystemExit(f"{label}: start marker not found")
    end_i = text.find(end, start_i)
    if end_i < 0:
        raise SystemExit(f"{label}: end marker not found")
    text = text[:start_i] + replacement.rstrip() + "\n\n" + text[end_i:]


replace_once(
    'let fullReadFlight: Promise<SidebarSnapshot> | null = null;\nconst ocrQueue = new PriorityOcrQueue();',
    'let fullReadFlight: Promise<SidebarSnapshot> | null = null;\nlet offscreenCreateFlight: Promise<void> | null = null;\nconst ocrQueue = new PriorityOcrQueue();',
    'offscreen creation state'
)

replace_between(
    'async function ensureOffscreen()',
    'async function directDebuggerCommand',
    '''async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (offscreenCreateFlight) return offscreenCreateFlight;

  const flight = (async () => {
    if (await chrome.offscreen.hasDocument()) return;
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
        justification: "Process only small captured One Block sidebar regions locally for OCR."
      });
    } catch (error) {
      // Multiple scheduler/control calls can race while the offscreen document
      // is starting. Treat a document that now exists as success; otherwise
      // surface the real creation error.
      if (!(await chrome.offscreen.hasDocument())) throw error;
    }
  })();
  offscreenCreateFlight = flight;
  try {
    await flight;
  } finally {
    if (offscreenCreateFlight === flight) offscreenCreateFlight = null;
  }
}
''',
    'offscreen single flight'
)

replace_once(
    '    microRect?: RelativeOcrRect;\n    preferFast?: boolean;\n    forceViewport?: boolean;',
    '    microRect?: RelativeOcrRect;\n    preferFast?: boolean;\n    fastOnly?: boolean;\n    forceViewport?: boolean;',
    'capture options fast only'
)

replace_once(
    '      inputScope: options.microRect ? "micro" : "base",\n      preferFast: Boolean(options.preferFast && options.microRect)\n    };',
    '      inputScope: options.microRect ? "micro" : "base",\n      preferFast: Boolean(options.preferFast && options.microRect),\n      fastOnly: Boolean(options.fastOnly && options.microRect)\n    };',
    'OCR fast only request'
)

replace_once(
    '        await closeOffscreen();\n      }\n      throw error;',
    '        await closeOffscreen();\n        if (settings.autoBoost && predictedReadyAt !== undefined) scheduleCooldownMonitoring();\n      }\n      throw error;',
    'OCR watchdog rearm'
)

replace_once(
    '    const accepted = updateCounter(snapshot.blocksMined, sampleAt);\n    if (!accepted && lastCounter) snapshot.blocksMined = lastCounter.value;',
    '    const accepted = updateCounter(snapshot.blocksMined, sampleAt);\n    if (!accepted) {\n      snapshot.blocksMined = undefined;\n      log("Full sidebar counter contradicted the last accepted monotonic counter; the snapshot is not allowed to silently reuse an older value.", "warn");\n    }',
    'full snapshot fail closed'
)

replace_once(
    '    const value = response.blocksMined;\n    if (value === undefined) return undefined;\n    if (lastCounter && value < lastCounter.value) {',
    '''    let value = response.blocksMined;
    if (value === undefined) return undefined;
    if (lastCounter && value > lastCounter.value) {
      const elapsedSec = Math.max(0.05, (response.captureAt - lastCounter.at) / 1000);
      const delta = value - lastCounter.value;
      const expectedDelta = rollingBps !== undefined && rollingBps > 0 ? rollingBps * elapsedSec : 0;
      const confirmationThreshold = expectedDelta > 0
        ? Math.max(250, expectedDelta * 8 + 50)
        : Math.max(500, elapsedSec * 50);
      if (delta >= confirmationThreshold) {
        log(`Counter jump ${delta.toLocaleString()} over ${elapsedSec.toFixed(1)}s is unusual relative to recent samples; confirming with a fresh base crop before accepting it.`, "warn");
        const confirmation = await captureOcr("counter", profile, {
          workClass: "counter",
          generation
        });
        const confirmed = confirmation.blocksMined;
        if (confirmed === undefined || confirmed < value || confirmed < lastCounter.value) {
          log(`Counter jump rejected because the independent confirmation disagreed (${value.toLocaleString()} vs ${confirmed?.toLocaleString() ?? "unreadable"}).`, "warn");
          counterMicroCrop = undefined;
          return undefined;
        }
        value = confirmed;
        response = confirmation;
        if (confirmation.microRect) counterMicroCrop = { key: confirmation.calibrationKey, rect: confirmation.microRect };
        log(`Counter jump independently confirmed at ${value.toLocaleString()}.`);
      }
    }
    if (lastCounter && value < lastCounter.value) {''',
    'counter spike confirmation'
)

replace_once(
    'async function readBoost(workClass: OcrWorkClass = "boost-sync"): Promise<SkillStateSnapshot> {',
    'async function readBoost(workClass: OcrWorkClass = "boost-sync", options: { fastOnly?: boolean } = {}): Promise<SkillStateSnapshot> {',
    'boost options'
)

replace_once(
    '      microRect: stored?.rect,\n      preferFast: workClass === "boost-critical"\n    });',
    '      microRect: stored?.rect,\n      preferFast: workClass === "boost-critical",\n      fastOnly: Boolean(options.fastOnly && stored?.rect)\n    });',
    'boost capture fast only'
)

replace_once(
    '    if (response.recognitionMethod === "fast-template") fastBoostHits += 1;',
    '    if (response.fastMatchedLabel) fastBoostHits += 1;',
    'fast hit accounting'
)

replace_once(
    '    let skill = response.choppingSkill || { state: "unknown" as const };\n    if (!response.usedMicro && response.microRect && skill.state !== "unknown") {',
    '''    let skill = response.choppingSkill || { state: "unknown" as const };
    if (options.fastOnly && response.fastAttempted && skill.state === "unknown") {
      lastBoostCaptureAt = response.captureAt;
      return skill;
    }
    if (!response.usedMicro && response.microRect && skill.state !== "unknown") {''',
    'fast only miss handling'
)

replace_once(
    '    let skill = await attempt(profiles[0]);\n    if (skill.state !== "unknown") return skill;\n\n    boostMisses += 1;',
    '    let skill = await attempt(profiles[0]);\n    if (skill.state !== "unknown" || options.fastOnly) return skill;\n\n    boostMisses += 1;',
    'fast only no fallback profiles'
)

replace_once(
    '  const precisionAt = Math.max(now + 50, predictedReadyAt - settings.precisionWindowSec * 1000);',
    '  const precisionLeadMs = precisionWindowActive ? 900 : settings.precisionWindowSec * 1000;\n  const precisionAt = Math.max(now + 50, predictedReadyAt - precisionLeadMs);',
    'precision monitor timing'
)

replace_between(
    'function enterPrecisionWindow()',
    'async function beginBoostCycle()',
    '''function enterPrecisionWindow() {
  if (precisionWindowActive || !settings.autoBoost || connectedTabId === undefined || boostFault) return;
  precisionWindowActive = true;
  const remaining = predictedReadyAt ? Math.max(0, (predictedReadyAt - Date.now()) / 1000) : 0;
  log(`Precision window reserved at ${remaining.toFixed(2)}s predicted remaining. Counter OCR is paused; one authoritative sync runs now, then only cheap template probes run near Ready.`);
  // One real numeric sync at the start of the window is much cheaper than
  // repeatedly invoking Tesseract every few hundred milliseconds.
  void scheduleOffscreenWake("boost-sync", Date.now() + 50);
  if (predictedReadyAt !== undefined) {
    void scheduleOffscreenWake("boost-precision", Math.max(Date.now() + 100, predictedReadyAt - 900));
  }
}

async function precisionBoostTick() {
  if (!precisionWindowActive || !settings.autoBoost || connectedTabId === undefined || boostFault || boostCycle) return;
  const beforeRead = Date.now();
  if (predictedReadyAt !== undefined && beforeRead < predictedReadyAt - 900) {
    void scheduleOffscreenWake("boost-precision", predictedReadyAt - 900);
    return;
  }

  // Before the predicted transition, only compare the calibrated micro-crop
  // against Tesseract-confirmed Ready/Active templates. A miss returns Unknown
  // immediately and does not invoke Tesseract. At/after the predicted boundary
  // a normal micro Tesseract read is allowed as the authoritative fallback.
  const fastOnly = predictedReadyAt !== undefined && beforeRead < predictedReadyAt - 50;
  try {
    const observed = await readBoost("boost-critical", { fastOnly });
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

  if (!precisionWindowActive) return;
  const now = Date.now();
  if (predictedReadyAt !== undefined) {
    const untilReady = predictedReadyAt - now;
    if (untilReady > 900) {
      void scheduleOffscreenWake("boost-precision", predictedReadyAt - 900);
    } else if (untilReady > 50) {
      // Tiny image/template comparison only; 220ms bounds Ready recognition
      // latency without hammering Tesseract or the game renderer.
      void scheduleOffscreenWake("boost-precision", now + Math.min(220, Math.max(90, untilReady - 30)));
    } else {
      // Once the predicted boundary has arrived, let the next read use the
      // authoritative Tesseract fallback if the template is not conclusive.
      void scheduleOffscreenWake("boost-precision", now + 220);
    }
  } else {
    void scheduleOffscreenWake("boost-precision", now + 500);
  }
}
''',
    'precision low-overhead path'
)

replace_once(
    '      if (nextCooldownSyncAt > 0 && now >= nextCooldownSyncAt) {\n        await syncCooldown();\n        return;\n      }',
    '      if (nextCooldownSyncAt > 0 && now >= nextCooldownSyncAt + 2000) {\n        log("Scheduled cooldown sync is over 2s late; status poll is running the watchdog fallback.", "warn");\n        await syncCooldown();\n        return;\n      }',
    'poll sync watchdog only'
)

replace_once(
    'async function closeOffscreen() {\n  if (!(await chrome.offscreen.hasDocument())) return;\n  try { await chrome.offscreen.closeDocument(); } catch { /* already closed */ }\n}',
    '''async function closeOffscreen() {
  if (offscreenCreateFlight) {
    try { await offscreenCreateFlight; } catch { /* creation failure means nothing to close */ }
  }
  if (!(await chrome.offscreen.hasDocument())) return;
  try { await chrome.offscreen.closeDocument(); } catch { /* already closed */ }
}''',
    'close offscreen safely'
)

replace_once(
    '  const durationMs = endedAt - activeSession.startedAtMs;\n  const blocksMined = endCounter - startCounter;',
    '  const durationMs = endedAt - activeSession.startedAtMs;\n  if (!Number.isFinite(durationMs) || durationMs <= 0) {\n    throw new Error("The captured end time is not later than the session start. The run remains active; retry the final read.");\n  }\n  const blocksMined = endCounter - startCounter;',
    'duration validation'
)

replace_once(
    '  log(`Session finished: ${blocksMined.toLocaleString()} blocks at ${session.averageBps.toFixed(5)} b/s. Final sidebar snapshot saved.`);',
    '  log(`Session finished: ${blocksMined.toLocaleString()} blocks at ${session.averageBps.toPrecision(6)} b/s. Final sidebar snapshot saved.`);',
    'six significant figure log'
)

path.write_text(text)
print("Applied v0.3.5 background refinement")
