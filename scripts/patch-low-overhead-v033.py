from pathlib import Path


def replace_required(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise RuntimeError(f"Patch target missing: {label}")
    return text.replace(old, new, 1)


# Background: eliminate duplicate timer-driven counter OCR, slow the live counter,
# and stop periodic full-panel OCR while mining. GET_STATUS remains the lightweight
# driver for due tiny reads while the side panel is open.
p = Path('extension/background-v3.ts')
s = p.read_text()
s = replace_required(s, '  counterIntervalSec: 5,', '  counterIntervalSec: 20,', 'default counter interval')
s = replace_required(
    s,
    '    counterIntervalSec: Math.min(60, Math.max(5, Number(next.counterIntervalSec) || 5)),',
    '    counterIntervalSec: Math.min(180, Math.max(10, Number(next.counterIntervalSec) || 20)),',
    'counter interval sanitizer'
)
old_schedule = '''function scheduleCounter() {\n  clearTimer(counterTimer);\n  counterTimer = undefined;\n  if (connectedTabId === undefined || !settings.liveCounter) return;\n  counterTimer = self.setTimeout(() => {\n    void (async () => {\n      try {\n        await readCounter();\n      } catch (error) {\n        log(`Counter OCR: ${errorText(error)}`, "warn");\n      } finally {\n        scheduleCounter();\n      }\n    })();\n  }, settings.counterIntervalSec * 1000);\n}\n'''
new_schedule = '''function scheduleCounter() {\n  // v0.3.3 low-overhead mode: do not run a second background OCR loop.\n  // The open side panel already polls cached status and only triggers a tiny\n  // counter crop when the configured interval is actually due. When the side\n  // panel is closed, no live counter OCR runs; start/end snapshots remain exact.\n  clearTimer(counterTimer);\n  counterTimer = undefined;\n}\n'''
s = replace_required(s, old_schedule, new_schedule, 'counter timer loop')
old_full = '''    if (Date.now() - lastFullReadAt >= 15_000 && !boostCycle && !boostSleeping) {\n      void readFullSnapshot(false)\n        .then(snapshot => log(`Full sidebar live refresh complete${snapshot.blocksMined !== undefined ? ` · ${snapshot.blocksMined.toLocaleString()} blocks` : ""}.`))\n        .catch(error => log(`Full sidebar live refresh: ${errorText(error)}`, "warn"));\n    }\n'''
new_full = '''    // Do not run periodic full-panel OCR while mining. Full sidebar snapshots are\n    // intentionally limited to connect, run start/end, and explicit Refresh/Recalibrate.\n    // Blocks mined and Chopping are kept current by their much smaller crops.\n'''
s = replace_required(s, old_full, new_full, 'periodic full OCR')
p.write_text(s)

# Side panel: cached status refresh every 2s, local elapsed clock still every 1s;
# expose wider low-overhead counter range and explain the behavior.
p = Path('src/views/LiveExtension.tsx')
s = p.read_text()
s = replace_required(
    s,
    '    const statusTimer = window.setInterval(() => void refresh(), 1000);',
    '    const statusTimer = window.setInterval(() => void refresh(), 2000);',
    'status poll interval'
)
s = replace_required(
    s,
    '<label className="field"><span>Counter interval (s)</span><input type="number" min="5" max="60" value={settings.counterIntervalSec}',
    '<label className="field"><span>Counter interval (s)</span><input type="number" min="10" max="180" value={settings.counterIntervalSec}',
    'counter input range'
)
s = replace_required(
    s,
    '<p className="microcopy">The boost watcher does not OCR each countdown second. After reading a cooldown such as 157s, it schedules its next boost check for 157s + the safety delay.</p>',
    '<p className="microcopy">Low-overhead mode: full sidebar OCR runs only on connect, run start/end, Refresh full panel, or Recalibrate. The live counter uses only a tiny crop at the interval above (20s default). Chopping uses its own tiny crop only around Ready / verification / cooldown transitions. During a known cooldown, boost OCR sleeps completely until the scheduled wake.</p>',
    'performance copy'
)
p.write_text(s)

# Version bump.
p = Path('package.json')
s = p.read_text()
s = replace_required(s, '"version": "0.3.2"', '"version": "0.3.3"', 'package version')
p.write_text(s)

p = Path('extension/public/manifest.json')
s = p.read_text()
s = replace_required(s, '"version": "0.3.2"', '"version": "0.3.3"', 'manifest version')
p.write_text(s)

# README performance note/version references when present.
p = Path('README.md')
s = p.read_text()
s = s.replace('v0.3.2', 'v0.3.3')
marker = '## Chrome extension'
if marker in s and 'low-overhead mining mode' not in s.lower():
    s += '\n\n### v0.3.3 low-overhead mining mode\n\nThe side panel no longer runs a duplicate background counter OCR loop or periodic full-sidebar OCR while mining. Full sidebar snapshots are limited to connect, run start/end, and explicit refresh/recalibration. Live Blocks mined uses a tiny crop every 20 seconds by default (configurable 10–180 seconds), while Chopping OCR runs only around actionable state transitions and sleeps through known cooldowns. UI status polling reads cached state between OCR events.\n'
p.write_text(s)
