from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

# 1) Give the boundary path one full second of scheduler/focus headroom before
# the first planned E slot. This changes no E offsets and adds no OCR work.
path = "src/extension/reliability.ts"
text = read(path)
text = replace_once(
    text,
    'export const BOUNDARY_E_OFFSETS_MS = [-1000, -600, -200, 200, 600, 1000] as const;\nexport const FINAL_LOCK_AGREEMENT_MS = 1_000;',
    'export const BOUNDARY_E_OFFSETS_MS = [-1000, -600, -200, 200, 600, 1000] as const;\nexport const BOUNDARY_WAKE_LEAD_MS = 2_000;\nexport const FINAL_LOCK_AGREEMENT_MS = 1_000;',
    "boundary wake lead constant",
)
write(path, text)

path = "extension/background-v3.ts"
text = read(path)
text = replace_once(
    text,
    'import { BOUNDARY_E_OFFSETS_MS, OcrDeadlineError, PriorityOcrQueue, cooldownReadyEstimateMs, cooldownSamplesAgree, cooldownSyncDelayMs, finalLockSamplesAgree, isStaleObservation, transitionVerdict, type OcrWorkClass } from "../src/extension/reliability";',
    'import { BOUNDARY_E_OFFSETS_MS, BOUNDARY_WAKE_LEAD_MS, OcrDeadlineError, PriorityOcrQueue, cooldownReadyEstimateMs, cooldownSamplesAgree, cooldownSyncDelayMs, finalLockSamplesAgree, isStaleObservation, transitionVerdict, type OcrWorkClass } from "../src/extension/reliability";',
    "background boundary lead import",
)
text = replace_once(
    text,
    'boundaryWakeAt = Math.max(Date.now() + 25, predictedReadyAt - 1_300);',
    'boundaryWakeAt = Math.max(Date.now() + 25, predictedReadyAt - BOUNDARY_WAKE_LEAD_MS);',
    "boundary wake lead use",
)
write(path, text)

# 2) Strengthen the tests so they prove the final lock is stricter than the
# ordinary recovery quorum, and prove pre-focus has >=1s before the first E slot.
path = "src/extension/reliability.test.ts"
text = read(path)
text = replace_once(
    text,
    '  BOUNDARY_E_OFFSETS_MS,\n  PriorityOcrQueue,',
    '  BOUNDARY_E_OFFSETS_MS,\n  BOUNDARY_WAKE_LEAD_MS,\n  PriorityOcrQueue,',
    "test boundary lead import",
)
text = replace_once(
    text,
    '    expect(finalLockSamplesAgree(first, good)).toBe(true);\n    expect(finalLockSamplesAgree(first, tooFar)).toBe(false);',
    '    expect(finalLockSamplesAgree(first, good)).toBe(true);\n    expect(cooldownSamplesAgree(first, tooFar)).toBe(true);\n    expect(finalLockSamplesAgree(first, tooFar)).toBe(false);',
    "test strict lock comparison",
)
text = replace_once(
    text,
    '    expect(BOUNDARY_E_OFFSETS_MS[0]).toBe(-1000);\n    expect(BOUNDARY_E_OFFSETS_MS.at(-1)).toBe(1000);',
    '    expect(BOUNDARY_E_OFFSETS_MS[0]).toBe(-1000);\n    expect(BOUNDARY_E_OFFSETS_MS.at(-1)).toBe(1000);\n    expect(BOUNDARY_WAKE_LEAD_MS - Math.abs(BOUNDARY_E_OFFSETS_MS[0])).toBeGreaterThanOrEqual(1000);',
    "test focus headroom",
)
write(path, text)

# 3) Make the user-facing text match the actual v0.3.7 architecture. The
# trusted path is timer-locked/scheduled; actual Ready OCR is the safe fallback.
path = "src/views/LiveExtension.tsx"
text = read(path)
old = '      <p className="microcopy">v0.3.7 low-overhead mode: full sidebar OCR remains limited to connect/start/end/manual refresh. After a numeric Chopping cooldown is confirmed, the watcher sleeps between scheduled tiny synchronizations. Near predicted Ready it pauses counter OCR and prefers the learned fast state matcher; Tesseract remains a guarded fallback at the transition boundary. E is never triggered by the local timer alone. The optional Live Monitor is passive and opens only when you press its button.</p>'
new = '      <p className="microcopy">v0.3.7 low-overhead mode: full sidebar OCR remains limited to connect/start/end/manual refresh. After a numeric Chopping cooldown is confirmed, the watcher sleeps between scheduled tiny synchronizations. Near predicted Ready it takes two strict final-lock countdown reads. If they agree, counter/OCR work is blacked out and six scheduled E presses cover the modeled Ready boundary; if they do not agree, the extension falls back to fresh actual-Ready confirmation instead of blind input. The optional Live Monitor is passive and opens only when you press its button.</p>'
text = replace_once(text, old, new, "Live v0.3.7 timing copy")
write(path, text)

path = "README.md"
text = read(path)
old = 'The automation targets **Chopping** specifically. A local countdown never authorizes input by itself: only a fresh Chopping `Ready` observation can start the E sequence. The primary activation remains E ×5, followed by verification. If `Ready` is still observed, one additional confirmation is required before the single backup E ×3 burst. Unclear observations fail closed and send no key.'
new = 'The automation targets **Chopping** specifically. v0.3.7 has two guarded activation paths. For a trusted cooldown, two final countdown reads must predict the same Ready boundary within the strict lock tolerance before scheduled input is armed; OCR and counter work are then blacked out while six E presses span ±1 second around that modeled boundary. If the strict timing lock cannot be established, the extension falls back to fresh actual-`Ready` confirmation and the existing E ×5 path. After either path, activation is verified and only one backup E ×3 burst is allowed. Unclear or untrusted timing never arms the scheduled boundary path.'
text = replace_once(text, old, new, "README activation truth")
old = 'An unexpectedly early real `Ready` still requires confirmation, but the confirmation is scheduled immediately instead of falling back to the normal cooldown cadence. The precision watcher starts slightly ahead of the integer countdown boundary, and once precision owns the transition it cancels the normal cooldown-sync wake so two reads do not collide at the same boundary.'
new = 'An unexpectedly early real `Ready` still gets a rapid second confirmation and, once confirmed, bypasses the timer lock and activates immediately. On the normal trusted path, the final lock starts several seconds before predicted Ready, cancels ordinary cooldown/counter work, takes two authoritative countdown samples, and then sleeps through the transition except for the scheduled E events.'
text = replace_once(text, old, new, "README final lock description")
old = 'The learned Ready/Active fast path is used in fast-only mode only after Tesseract has confirmed at least one template for **both** states. Until then, precision uses bounded authoritative reads instead of issuing guaranteed fast-template misses. Chopping calibration now keeps a fixed, right-anchored Skill value cell across different token widths such as `149s`, `Ready` and `Active`.'
new = 'The learned Ready/Active matcher remains a guarded accelerator for state-confirmation fallback and verification; it is not required for the trusted scheduled boundary path. Chopping calibration is anchored to the stable `Skill:` label rather than the changing `149s` / `Ready` / `Active` token, so the recurring value crop does not move with text width.'
text = replace_once(text, old, new, "README matcher/crop description")
old = '- precision window: begins before integer zero, counter paused, normal sync wake cancelled, learned matching preferred'
new = '- final timing lock: begins several seconds before predicted Ready; two strict countdown reads must agree, then OCR/counter stays blacked out across the six-tap boundary window'
text = replace_once(text, old, new, "README performance bullet")
old = 'v0.3.7 does not add a new user-facing feature set. It targets the v0.3.5 live-test failures: bad first cooldown anchoring, stale-prediction lock-in, delayed early-Ready confirmation, integer-boundary latency, untrained fast-only probing, unstable Chopping micro-crops, overly eager broad fallback, occasional ineffective ultra-short E dispatch, and missing Phase retry at connection. These fixes must still pass a new real Bloxd/Chromebook acceptance recording before their real-world latency and performance impact can be called proven.'
new = 'v0.3.7 does not add a new user-facing feature set. It keeps the v0.3.6 cooldown-recovery safeguards and concentrates on the remaining live-test problems: delayed Ready→Active transition, OCR work at the exact boundary, unstable Chopping value crops, renderer disturbance from eager fallback, and input-scheduling headroom. The trusted path now uses a strict two-read final timer lock plus a six-tap scheduled boundary window; unsafe timing falls back to fresh Ready confirmation. These fixes must still pass a new real Bloxd/Chromebook acceptance recording before a ≤500 ms Ready→Active result or mining-performance impact can be called proven.'
text = replace_once(text, old, new, "README release summary")
write(path, text)

# 4) Extend the release audit so stale v0.3.6-era truth claims cannot return.
path = "scripts/audit-extension.mjs"
text = read(path)
text = replace_once(
    text,
    'expect(reliability.includes("BOUNDARY_E_OFFSETS_MS"), "boundary E coverage constants are missing");',
    'expect(reliability.includes("BOUNDARY_E_OFFSETS_MS"), "boundary E coverage constants are missing");\nexpect(reliability.includes("BOUNDARY_WAKE_LEAD_MS = 2_000"), "boundary wake does not reserve 1s of pre-focus headroom before the first E slot");',
    "audit boundary wake headroom",
)
text = replace_once(
    text,
    'expect(readme.includes("v0.3.7"), "README does not identify the v0.3.7 fix release");',
    'expect(readme.includes("v0.3.7"), "README does not identify the v0.3.7 fix release");\nexpect(!readme.includes("only a fresh Chopping `Ready` observation can start the E sequence"), "README still describes the pre-v0.3.7 OCR-trigger-only architecture");\nexpect(readme.includes("six E presses span ±1 second"), "README does not document the trusted scheduled boundary path accurately");\nexpect(live.includes("two strict final-lock countdown reads"), "Live UI does not describe the final timer lock accurately");\nexpect(!live.includes("E is never triggered by the local timer alone"), "Live UI still contains the pre-v0.3.7 timer claim");',
    "audit documentation truth",
)
write(path, text)

print("v0.3.7 release finalizer applied")
