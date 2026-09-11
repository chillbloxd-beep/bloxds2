from pathlib import Path

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

# Keep an unclear calibrated crop through two ordinary sync misses before any
# multi-profile recovery. This reduces capture spikes without weakening the
# critical final-lock path, which can still use one same-profile base read.
path = "extension/background-v3.ts"
text = read(path)
text = replace_once(
    text,
    '''    if (boostMisses < 1) {\n      boostMisses += 1;\n      log("Chopping OCR missed the active crop once; deferring multi-profile recovery to avoid a transient renderer spike.", "debug", {''',
    '''    if (boostMisses < 2) {\n      boostMisses += 1;\n      log(`Chopping OCR miss ${boostMisses}/2 on the active profile; deferring multi-profile recovery to avoid a renderer spike.`, "debug", {''',
    "stage multi-profile recovery for two misses"
)

# If final-lock OCR has already produced an unexpectedly-early Ready candidate,
# the second confirmation gets the shortest safe recheck. Do not let it fall
# through to the slower generic fallback cadence.
needle = '''    const observed = await readBoost("boost-critical", { noProfileFallback: true });\n    if (observed.state === "ready") {'''
replacement = '''    const observed = await readBoost("boost-critical", { noProfileFallback: true });\n    if (observed.state === "unknown" && quickTransitionConfirm && pendingTransitionConfirm?.state === "ready") {\n      log("Unexpected Ready candidate is awaiting its second fresh confirmation; rechecking in 0.10s.", "debug", {\n        category: "chopping", event: "boundary.rapid_ready_confirm"\n      });\n      void scheduleOffscreenWake("boost-precision", Date.now() + 100);\n      return;\n    }\n    if (observed.state === "ready") {'''
text = replace_once(text, needle, replacement, "rapid early-Ready confirmation")

# The boundary input loop itself should be as quiet as possible. Do not trigger
# UI broadcasts and log rendering between scheduled E dispatches. Record timing
# offsets in memory and emit one structured summary after the window finishes.
old = '''    await focusGameSurface("Boundary boost input");\n    let sent = 0;\n    for (let index = 0; index < BOUNDARY_E_OFFSETS_MS.length; index += 1) {\n      const offsetMs = BOUNDARY_E_OFFSETS_MS[index];\n      const targetAt = boundary + offsetMs;\n      const lateBy = Date.now() - targetAt;\n      if (lateBy > 140 && index < BOUNDARY_E_OFFSETS_MS.length - 1) {\n        log(`Boundary E ${index + 1}/${BOUNDARY_E_OFFSETS_MS.length} skipped because its target was already ${lateBy}ms stale.`, "debug", {\n          category: "input", event: "input.boundary_skipped", details: { index: index + 1, offsetMs, lateByMs: lateBy }\n        });\n        continue;\n      }\n      const waitMs = targetAt - Date.now();\n      if (waitMs > 0) await delay(waitMs);\n      const dispatchAt = Date.now();\n      await keyE();\n      sent += 1;\n      log(`Boundary E ${index + 1}/${BOUNDARY_E_OFFSETS_MS.length} sent at ${dispatchAt - boundary >= 0 ? "+" : ""}${dispatchAt - boundary}ms vs predicted Ready.`, "debug", {\n        category: "input", event: "input.boundary_e", details: { index: index + 1, offsetMs, dispatchOffsetMs: dispatchAt - boundary }\n      });\n    }\n    if (sent === 0) {\n      const dispatchAt = Date.now();\n      await keyE();\n      sent = 1;\n      log("Boundary wake arrived after all planned slots; sent one immediate recovery E instead of replaying stale taps.", "warn", {\n        category: "input", event: "input.boundary_late", details: { dispatchOffsetMs: dispatchAt - boundary }\n      });\n    }\n    boundaryBurstRunning = false;\n    precisionWindowActive = false;\n    finalLockConfirmed = false;\n    log(`Boundary activation window completed with ${sent} E press${sent === 1 ? "" : "es"}. One verification read follows in 0.45s.`, "info", {\n      category: "input", event: "input.boundary_complete", details: { sent, predictedReadyAt: boundary }\n    });'''
new = '''    await focusGameSurface("Boundary boost input");\n    let sent = 0;\n    let skipped = 0;\n    const dispatchOffsets: number[] = [];\n    for (let index = 0; index < BOUNDARY_E_OFFSETS_MS.length; index += 1) {\n      const offsetMs = BOUNDARY_E_OFFSETS_MS[index];\n      const targetAt = boundary + offsetMs;\n      const lateBy = Date.now() - targetAt;\n      if (lateBy > 140 && index < BOUNDARY_E_OFFSETS_MS.length - 1) {\n        skipped += 1;\n        continue;\n      }\n      const waitMs = targetAt - Date.now();\n      if (waitMs > 0) await delay(waitMs);\n      const dispatchAt = Date.now();\n      await keyE();\n      sent += 1;\n      dispatchOffsets.push(dispatchAt - boundary);\n    }\n    if (sent === 0) {\n      const dispatchAt = Date.now();\n      await keyE();\n      sent = 1;\n      dispatchOffsets.push(dispatchAt - boundary);\n    }\n    boundaryBurstRunning = false;\n    precisionWindowActive = false;\n    finalLockConfirmed = false;\n    const offsetSummary = dispatchOffsets.map(value => `${value >= 0 ? "+" : ""}${value}ms`).join(", ");\n    log(`Boundary activation window completed with ${sent} E press${sent === 1 ? "" : "es"}${skipped ? ` (${skipped} stale slot${skipped === 1 ? "" : "s"} skipped)` : ""}. Dispatch offsets: ${offsetSummary || "none"}. One verification read follows in 0.45s.`, "info", {\n      category: "input", event: "input.boundary_complete", details: {\n        sent, skipped, predictedReadyAt: boundary,\n        firstDispatchOffsetMs: dispatchOffsets[0],\n        lastDispatchOffsetMs: dispatchOffsets[dispatchOffsets.length - 1]\n      }\n    });'''
text = replace_once(text, old, new, "quiet boundary dispatch loop")
write(path, text)

# Harden the permanent release audit around the final fine-tuning decisions.
path = "scripts/audit-extension.mjs"
text = read(path)
anchor = '''expect(!boundaryBlock.includes("captureOcr("), "boundary input window performs screenshot/OCR capture");\n'''
extra = '''expect(!boundaryBlock.includes('event: "input.boundary_e"'), "boundary loop still logs/broadcasts every E dispatch");\nexpect(boundaryBlock.includes("dispatchOffsets"), "boundary loop does not retain dispatch timing for one post-window summary");\nexpect(background.includes('event: "boundary.rapid_ready_confirm"'), "unexpected early Ready does not get the 100ms final-lock confirmation path");\nexpect((background.match(/if \\(boostMisses < 2\\)/g) || []).length >= 2, "ordinary Chopping misses are not staged before both same-profile and multi-profile recovery");\n'''
text = replace_once(text, anchor, anchor + extra, "final hardening audit")
write(path, text)

print("v0.3.7 final timing hardening applied")
