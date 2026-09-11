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

# Background: make the learned micro-crop an optimization, not a latency trap.
path = "extension/background-v3.ts"
text = read(path)
text = replace_once(
    text,
    'let boostMisses = 0;\nlet lastCounterReadAt = 0;',
    'let boostMisses = 0;\nlet boostMicroFailureStreak = 0;\nlet boostMicroBypassUntil = 0;\nlet lastCounterReadAt = 0;',
    "micro fallback state"
)
text = replace_once(
    text,
    '''function invalidateMicroCrops() {
  boostMicroCrop = undefined;
  counterMicroCrop = undefined;
}
''',
    '''function invalidateMicroCrops() {
  boostMicroCrop = undefined;
  counterMicroCrop = undefined;
  boostMicroFailureStreak = 0;
  boostMicroBypassUntil = 0;
}
''',
    "micro reset"
)
text = replace_once(
    text,
    '    const stored = !forceBase && boostMicroCrop?.key === key ? boostMicroCrop : undefined;',
    '    const microAllowed = Date.now() >= boostMicroBypassUntil;\n    const stored = !forceBase && microAllowed && boostMicroCrop?.key === key ? boostMicroCrop : undefined;',
    "micro bypass selection"
)
old = '''    if (response.usedMicro && skill.state === "unknown") {
      if (options.fastOnly) return skill;
      const critical = workClass === "boost-critical";
      // A single ordinary sync miss is not enough reason to throw away a
      // calibrated micro crop and launch a larger capture. v0.3.5 did that on
      // every miss and the live clip showed visible renderer stalls around
      // fallback activity. Keep the crop for one later sync; critical reads may
      // still use one same-profile base fallback immediately.
      if (!critical && boostMisses < 2) {
        log("Chopping micro-crop was unclear once; keeping calibration and deferring broad fallback.", "debug", {
          category: "ocr", event: "micro.miss_deferred"
        });
        return skill;
      }
      boostMicroCrop = undefined;
      boostMisses = 0;
      log("Chopping micro-crop remained unclear; retrying the safe same-profile Chopping crop once.", "warn", { category: "ocr", event: "micro.fallback" });
      response = await captureOcr("boost", profile, {
        workClass,
        generation,
        boostEpoch: requestedBoostEpoch
      });
      skill = response.choppingSkill || { state: "unknown" as const };
      if (!response.usedMicro && response.microRect && skill.state !== "unknown") {
        boostMicroCrop = { key: response.calibrationKey, rect: response.microRect };
      }
    }
'''
new = '''    if (response.usedMicro && skill.state === "unknown") {
      if (options.fastOnly) return skill;
      boostMicroFailureStreak += 1;
      boostMicroCrop = undefined;
      if (boostMicroFailureStreak >= 2) {
        boostMicroBypassUntil = Date.now() + 60_000;
        log("Chopping micro-crop failed twice; bypassing micro OCR for 60s and using one same-profile Chopping read per scheduled sync.", "warn", {
          category: "ocr", event: "micro.bypass", details: { bypassMs: 60_000, failureStreak: boostMicroFailureStreak }
        });
      } else {
        log("Chopping micro-crop was unclear; retrying the safe same-profile Chopping crop immediately instead of waiting for another sync.", "debug", {
          category: "ocr", event: "micro.immediate_fallback", details: { failureStreak: boostMicroFailureStreak }
        });
      }
      response = await captureOcr("boost", profile, {
        workClass,
        generation,
        boostEpoch: requestedBoostEpoch
      });
      skill = response.choppingSkill || { state: "unknown" as const };
      if (!response.usedMicro && response.microRect && skill.state !== "unknown") {
        boostMicroCrop = { key: response.calibrationKey, rect: response.microRect };
      }
    } else if (response.usedMicro && skill.state !== "unknown") {
      boostMicroFailureStreak = 0;
    }
'''
text = replace_once(text, old, new, "immediate same-profile fallback")
old = '''    if (boostMisses < 2) {
      boostMisses += 1;
      log(`Chopping OCR miss ${boostMisses}/2 on the active profile; deferring multi-profile recovery to avoid a renderer spike.`, "debug", {
        category: "ocr", event: "boost.profile_recovery_deferred"
      });
      return skill;
    }
'''
new = '''    const criticalProfileRecovery = workClass === "boost-critical";
    if (!criticalProfileRecovery && boostMisses < 1) {
      boostMisses += 1;
      log("Chopping same-profile OCR missed once; deferring multi-profile recovery for one normal sync to avoid a renderer spike.", "debug", {
        category: "ocr", event: "boost.profile_recovery_deferred"
      });
      return skill;
    }
'''
text = replace_once(text, old, new, "profile recovery policy")
write(path, text)

# Test the final lock away from an exact threshold edge.
path = "src/extension/reliability.test.ts"
text = read(path)
text = replace_once(text, '    const tooFar = { seconds: 7, captureAt: 101_000 };', '    const tooFar = { seconds: 4, captureAt: 101_000 };', "final-lock fixture")
write(path, text)

# Prove the learned recurring crop physically contains `Skill:` and the value.
path = "src/extension/ocrCalibration.test.ts"
text = read(path)
needle = '''    expect(Math.abs(ready.width - cooldown.width)).toBeLessThan(0.03);
    expect(ready.x).toBeCloseTo(active.x, 6);
'''
replacement = '''    expect(Math.abs(ready.width - cooldown.width)).toBeLessThan(0.03);
    expect(ready.x).toBeLessThanOrEqual(220 / 400);
    expect(ready.x + ready.width).toBeGreaterThanOrEqual(350 / 400);
    expect(ready.x).toBeCloseTo(active.x, 6);
'''
text = replace_once(text, needle, replacement, "Skill-cell coverage assertions")
write(path, text)

# Harden the release audit around the newly reported real-world crop failure.
path = "scripts/audit-extension.mjs"
text = read(path)
text = replace_once(
    text,
    'expect(background.includes("micro.miss_deferred"), "single micro-crop misses still immediately trigger larger fallback work");\n',
    'expect(background.includes("micro.immediate_fallback"), "a failed Chopping micro-crop does not immediately retry the safe same-profile crop");\nexpect(background.includes("micro.bypass"), "repeated Chopping micro-crop failures do not enter temporary bypass mode");\n',
    "audit immediate fallback"
)
text = replace_once(
    text,
    'expect(background.includes("if (!critical && boostMisses < 2)") && background.includes("if (boostMisses < 2)"), "ordinary Chopping misses are not staged before both same-profile and multi-profile recovery");',
    'expect(background.includes("boostMicroBypassUntil") && background.includes("criticalProfileRecovery"), "Chopping fallback does not adapt after repeated micro failures");',
    "audit adaptive fallback"
)
text = replace_once(
    text,
    'expect(calibration.includes("normalizedSkillValueRect"), "Skill:-anchored Chopping value crop helper is missing");\nexpect(calibration.includes("resemblesSkillAnchor"), "Chopping crop is not anchored to the stable Skill: label");\nexpect(calibration.includes("skillAnchor.x1"), "Chopping value crop does not start from the fixed Skill: anchor");',
    'expect(calibration.includes("normalizedSkillCellRect"), "Skill:-anchored Chopping cell crop helper is missing");\nexpect(calibration.includes("resemblesSkillAnchor"), "Chopping crop is not anchored to the stable Skill: label");\nexpect(calibration.includes("skillAnchor.x0"), "Chopping cell crop does not include the fixed Skill: anchor");',
    "audit Skill-cell crop"
)
text = replace_once(
    text,
    'expect(offscreen.includes(\'tessedit_char_whitelist: ""\'), "full OCR does not clear the restrictive micro whitelist");',
    'expect(offscreen.includes(\'tessedit_char_whitelist: ""\'), "full OCR does not clear the restrictive micro whitelist");\nexpect(offscreen.includes("PSM.SINGLE_LINE"), "Chopping micro OCR is not configured as one stable Skill/value line");\nexpect(offscreen.includes("SkillskillReady"), "Chopping micro whitelist does not include the Skill anchor text");',
    "audit micro OCR mode"
)
text = replace_once(
    text,
    '  ".github/workflows/apply-v037-final.yml"\n]) {',
    '  ".github/workflows/apply-v037-final.yml",\n  "scripts/finish-v037-chopping-fallback.py",\n  ".github/workflows/finish-v037-chopping-fallback.yml"\n]) {',
    "audit migration helpers"
)
write(path, text)

print("v0.3.7 Chopping fallback patch applied")
