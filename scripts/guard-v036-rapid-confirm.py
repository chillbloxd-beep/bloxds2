from pathlib import Path

path = Path("extension/background-v3.ts")
text = path.read_text()
old = '''function scheduleRecheck(seconds = settings.readyRetrySec) {
  const actualSeconds = quickTransitionConfirm ? Math.min(seconds, 0.15) : seconds;
  // Do not clear quickTransitionConfirm here. The wake handler needs to know
  // that this is the second observation of an unexpectedly early Ready/Active.
  void scheduleOffscreenWake("boost-sync", Date.now() + actualSeconds * 1000);
}'''
new = '''function scheduleRecheck(seconds = settings.readyRetrySec) {
  let actualSeconds = seconds;
  if (quickTransitionConfirm && pendingTransitionConfirm) {
    const candidateAgeMs = Math.max(0, Date.now() - pendingTransitionConfirm.captureAt);
    if (candidateAgeMs <= 750) {
      actualSeconds = Math.min(seconds, 0.15);
    } else {
      // Do not let an unclear second read create an endless 150ms OCR loop.
      // Once the candidate is stale, return to the normal fail-closed cadence.
      quickTransitionConfirm = false;
      pendingTransitionConfirm = undefined;
      log("Rapid transition candidate expired before confirmation; returning to normal retry cadence.", "debug", {
        category: "chopping", event: "transition.confirm_schedule_expired", details: { candidateAgeMs }
      });
    }
  }
  // Keep a live candidate across the short wake so readBoost can compare the
  // second observation against the first one.
  void scheduleOffscreenWake("boost-sync", Date.now() + actualSeconds * 1000);
}'''
if text.count(old) != 1:
    raise SystemExit(f"scheduleRecheck anchor expected once, found {text.count(old)}")
text = text.replace(old, new, 1)
old2 = '''    log(`Cooldown wake did not read Ready; checking again in ${settings.readyRetrySec}s.`, "warn");
    scheduleRecheck();'''
new2 = '''    const retrySec = quickTransitionConfirm && pendingTransitionConfirm ? 0.15 : settings.readyRetrySec;
    log(`Cooldown wake did not read an accepted Ready; checking again in ${retrySec}s.`, "warn");
    scheduleRecheck();'''
if text.count(old2) != 1:
    raise SystemExit(f"wakeBoost retry log anchor expected once, found {text.count(old2)}")
text = text.replace(old2, new2, 1)
path.write_text(text)
print("rapid-confirm expiry guard applied")
