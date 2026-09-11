from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))

BG = "extension/background-v3.ts"

# UI status reads must be passive. Auto/manual connection recovery is already
# owned by startup/tab events and explicit Scan now.
replace_once(
    BG,
    '''      case "GET_STATUS":\n        await reconcileConnection();\n        return { ok: true, status: status() };\n''',
    '''      case "GET_STATUS":\n        return { ok: true, status: status() };\n'''
)

# Do not let a counter read begin just before the time-critical Chopping window.
replace_once(
    BG,
    '''async function counterWake() {\n  if (connectedTabId === undefined) return;\n  if (precisionWindowActive) {\n    log("Blocks counter wake deferred because Chopping is in the precision Ready window.", "debug", { category: "counter", event: "counter.deferred" });\n    scheduleCounter(1_000);\n    return;\n  }\n''',
    '''async function counterWake() {\n  if (connectedTabId === undefined) return;\n  const nearReady = settings.autoBoost && predictedReadyAt !== undefined\n    && predictedReadyAt - Date.now() <= settings.precisionWindowSec * 1000 + 1_000;\n  if (precisionWindowActive || nearReady) {\n    log("Blocks counter wake deferred because Chopping is near or inside the precision Ready window.", "debug", {\n      category: "counter", event: "counter.deferred", details: { precisionWindowActive, nearReady }\n    });\n    scheduleCounter(1_000);\n    return;\n  }\n'''
)

# The early readCounter guard should count/report rejected OCR too, not only the
# lower-level updateCounter guard.
replace_once(
    BG,
    '''    if (lastCounter && value < lastCounter.value) {\n      log(`Rejected counter OCR ${value.toLocaleString()} because Blocks mined cannot decrease from ${lastCounter.value.toLocaleString()} on the same connected island.`, "warn");\n      return undefined;\n    }\n''',
    '''    if (lastCounter && value < lastCounter.value) {\n      rejectedOcrCount += 1;\n      log(`Rejected counter OCR ${value.toLocaleString()} because Blocks mined cannot decrease from ${lastCounter.value.toLocaleString()} on the same connected island.`, "warn", {\n        category: "counter", event: "counter.rejected", details: { observed: value, previous: lastCounter.value }\n      });\n      return undefined;\n    }\n'''
)

# An implausibly early Ready already requested a confirmation. Confirm it quickly
# instead of waiting a generic boundary backoff.
replace_once(
    BG,
    '''  if (precisionWindowActive) void scheduleOffscreenWake("boost-precision", Date.now() + plan.nextDelayMs);\n}\n''',
    '''  if (precisionWindowActive) {\n    const nextDelayMs = quickTransitionConfirm ? Math.min(250, plan.nextDelayMs) : plan.nextDelayMs;\n    void scheduleOffscreenWake("boost-precision", Date.now() + nextDelayMs);\n  }\n}\n'''
)

# Remove an unused UI helper so the monitor source remains intentionally small.
MONITOR = "src/views/LiveMonitor.tsx"
replace_once(
    MONITOR,
    '''function median(values: number[]) {\n  if (!values.length) return undefined;\n  const sorted = [...values].sort((a, b) => a - b);\n  const mid = Math.floor(sorted.length / 2);\n  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;\n}\n\n''',
    ''''''
)

print("v0.3.5 hardening patch applied")
