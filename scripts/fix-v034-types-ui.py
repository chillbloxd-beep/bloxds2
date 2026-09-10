from pathlib import Path


def req(text, old, new, label):
    if old not in text:
        if new in text:
            return text
        raise RuntimeError(f"Missing target: {label}")
    return text.replace(old, new, 1)

p = Path('src/types.ts')
s = p.read_text()
s = req(s, '  extensionConnectionMode?: "manual" | "auto";', '  extensionConnectionMode?: "manual" | "auto" | "dumb";', 'session connection mode')
p.write_text(s)

p = Path('src/views/LiveExtension.tsx')
s = p.read_text()
s = req(s, 'import { formatDuration, formatInteger, formatRate } from "../lib/math";', 'import { formatDuration, formatInteger } from "../lib/math";', 'unused formatRate import')
s = req(s, ': settings?.mode === "auto" ? "Waiting for One Block" : "Disconnected";', ': settings?.mode === "auto" || settings?.mode === "dumb" ? "Waiting for One Block" : "Disconnected";', 'dumb connection text')
s = s.replace('Chopping Ready → E ×5 → wait 3s → verify. If still Ready, one backup E ×3 burst is sent.', 'Chopping Ready → E ×5 → fast verify. If Ready is confirmed twice, one backup E ×3 burst is sent.')
p.write_text(s)

p = Path('extension/background-v3.ts')
s = p.read_text()
s = req(s,
'  if (snapshot.chopping?.skill) setChoppingSkill(snapshot.chopping.skill);',
'  if (snapshot.chopping?.skill) {\n    lastBoostCaptureAt = sampleAt;\n    applyBoostObservation(snapshot.chopping.skill, sampleAt);\n  }',
'full snapshot boost timestamp')
s = req(s,
'  if (settings.mode !== "dumb" || activeSession || connectedTabId === undefined) return;',
'  if (settings.mode !== "dumb" || activeSession || connectedTabId === undefined || dumbModeArmed) return;',
'dumb arm duplicate guard')
s = req(s,
'  dumbArmSnapshot = currentSnapshot ? { ...currentSnapshot, blocksMined: counter } : { blocksMined: counter };',
'  dumbArmSnapshot = currentSnapshot ? { ...currentSnapshot, blocksMined: counter } : { capturedAt: new Date().toISOString(), rawText: "", lines: [], blocksMined: counter };',
'dumb snapshot required fields')
s = req(s,
'    const startSnapshot: SidebarSnapshot = { ...(dumbArmSnapshot || currentSnapshot || {}), blocksMined: previous.value };',
'    const baseSnapshot: SidebarSnapshot = dumbArmSnapshot || currentSnapshot || { capturedAt: new Date(previous.at).toISOString(), rawText: "", lines: [] };\n    const startSnapshot: SidebarSnapshot = { ...baseSnapshot, blocksMined: previous.value };',
'dumb start snapshot required fields')
s = req(s,
'chrome.alarms.onAlarm.addListener(alarm => {\n  if (alarm.name !== BOOST_WAKE) return;\n  boostWakeAt = undefined;\n  log("Cooldown wake alarm fired; checking Chopping state now.");\n  void ensureLoaded().then(wakeBoost);\n});',
'chrome.alarms.onAlarm.addListener(alarm => {\n  if (alarm.name !== BOOST_WAKE) return;\n  boostWakeAt = undefined;\n  if (precisionWindowActive) {\n    log("Cooldown wake alarm fired while precision watcher is already active; duplicate OCR skipped.");\n    return;\n  }\n  log("Cooldown wake alarm fired; checking Chopping state now.");\n  void ensureLoaded().then(wakeBoost);\n});',
'alarm precision guard')
p.write_text(s)
