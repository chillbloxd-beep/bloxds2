from pathlib import Path


def replace_required(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise RuntimeError(f"Patch target missing: {label}")
    return text.replace(old, new, 1)

p = Path('extension/background-v3.ts')
s = p.read_text()

# Bound counter recovery to small crops only. Never escalate to a heavy full-panel
# OCR automatically while the user is mining.
s = replace_required(
    s,
    '  for (const profile of profiles.slice(1)) {\n',
    '  for (const profile of profiles.slice(1, 3)) {\n',
    'counter alternate profile limit'
)
s = replace_required(
    s,
    '  counterMisses = 0;\n  const snapshot = await readFullSnapshot(true);\n  return snapshot.blocksMined;\n}\n\nasync function readBoost()',
    '  counterMisses = 0;\n  log("Counter OCR missed all small crops; skipping automatic full-panel recalibration to protect game performance. Use Recalibrate OCR if this continues.", "warn");\n  return undefined;\n}\n\nasync function readBoost()',
    'counter full fallback removal'
)

# The second slice(1) occurrence belongs to Chopping. Limit it as well.
s = replace_required(
    s,
    '    for (const profile of profiles.slice(1)) {\n',
    '    for (const profile of profiles.slice(1, 3)) {\n',
    'boost alternate profile limit'
)
old_boost_fallback = '''    // A full read is the final recovery path. parseChoppingFromText fails\n    // closed, so neighboring Digging/Gold Ready states cannot trigger E.\n    const snapshot = await readFullSnapshot(true);\n    skill = snapshot.chopping?.skill || { state: "unknown" as const };\n    boostMisses = 0;\n'''
new_boost_fallback = '''    // Low-overhead mode deliberately does not escalate an unclear boost crop\n    // into full-sidebar OCR while mining. Keep the action fail-closed and retry\n    // later; explicit Recalibrate OCR remains available if the layout changed.\n    skill = { state: "unknown" as const };\n    boostMisses = 0;\n    log("Chopping OCR unclear across the small boost crops; no E sent and no full-panel OCR forced.", "warn");\n'''
s = replace_required(s, old_boost_fallback, new_boost_fallback, 'boost full fallback removal')

# Never stack a live counter OCR immediately before a Chopping OCR in the same
# UI poll. Boost has priority because it can trigger an action; counter waits for
# the next 2s status poll if a boost read was due.
old_refresh = '''async function refreshLiveStateOnPoll() {\n  if (connectedTabId === undefined) return;\n  if (liveRefreshFlight) return liveRefreshFlight;\n  const flight = (async () => {\n    const now = Date.now();\n\n    if (settings.liveCounter && now - lastCounterReadAt >= settings.counterIntervalSec * 1000) {\n      try {\n        const value = await readCounter();\n        if (value === undefined) log("Live counter refresh did not get a number; it will retry automatically.", "warn");\n      } catch (error) {\n        log(`Live counter refresh: ${errorText(error)}`, "warn");\n      }\n    }\n\n    const afterCounter = Date.now();\n    const boostSleeping = boostWakeAt !== undefined && afterCounter < boostWakeAt;\n    if (settings.autoBoost && !boostFault && !boostCycle && !boostSleeping && afterCounter - lastBoostReadAt >= 2000) {\n      try {\n        const observed = await readBoost();\n        if (observed.state === "ready") await beginBoostCycle();\n        else if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) scheduleCooldown(observed.cooldownSeconds);\n        else if (observed.state === "active") scheduleActiveCheck();\n        else scheduleRecheck();\n      } catch (error) {\n        log(`Live Chopping refresh: ${errorText(error)}`, "warn");\n      }\n    }\n\n    // Do not run periodic full-panel OCR while mining. Full sidebar snapshots are\n    // intentionally limited to connect, run start/end, and explicit Refresh/Recalibrate.\n    // Blocks mined and Chopping are kept current by their much smaller crops.\n  })();\n'''
new_refresh = '''async function refreshLiveStateOnPoll() {\n  if (connectedTabId === undefined) return;\n  if (liveRefreshFlight) return liveRefreshFlight;\n  const flight = (async () => {\n    const now = Date.now();\n    const boostSleeping = boostWakeAt !== undefined && now < boostWakeAt;\n    let boostReadRan = false;\n\n    if (settings.autoBoost && !boostFault && !boostCycle && !boostSleeping && now - lastBoostReadAt >= 2000) {\n      boostReadRan = true;\n      try {\n        const observed = await readBoost();\n        if (observed.state === "ready") await beginBoostCycle();\n        else if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) scheduleCooldown(observed.cooldownSeconds);\n        else if (observed.state === "active") scheduleActiveCheck();\n        else scheduleRecheck();\n      } catch (error) {\n        log(`Live Chopping refresh: ${errorText(error)}`, "warn");\n      }\n    }\n\n    const afterBoost = Date.now();\n    if (!boostReadRan && settings.liveCounter && afterBoost - lastCounterReadAt >= settings.counterIntervalSec * 1000) {\n      try {\n        const value = await readCounter();\n        if (value === undefined) log("Live counter refresh did not get a number; it will retry automatically.", "warn");\n      } catch (error) {\n        log(`Live counter refresh: ${errorText(error)}`, "warn");\n      }\n    }\n\n    // No automatic full-panel OCR while mining. Full sidebar snapshots are\n    // limited to connect, run start/end, and explicit Refresh/Recalibrate.\n  })();\n'''
s = replace_required(s, old_refresh, new_refresh, 'poll OCR prioritization')
p.write_text(s)

p = Path('src/views/LiveExtension.tsx')
s = p.read_text()
s = replace_required(
    s,
    'counterDelta === undefined ? "Waiting for counter sample" : `${formatInteger(counterDelta)} blocks since start`',
    'counterDelta === undefined ? "Waiting for counter sample" : counterDelta === 0 ? `Live counter sampling every ${settings.counterIntervalSec}s` : `${formatInteger(counterDelta)} blocks since start`',
    'run counter waiting copy'
)
p.write_text(s)
