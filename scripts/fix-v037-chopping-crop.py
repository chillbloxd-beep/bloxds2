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

# Fix the recurring Chopping crop itself: include the stable `Skill:` anchor plus
# its value so Tesseract receives context instead of a fragile value-only sliver.
path = "src/extension/ocrCalibration.ts"
text = read(path)
old = '''/**
 * Chopping's changing value (`Ready`, `Active`, `153s`, ...) is not a stable
 * calibration anchor. The literal `Skill:` label immediately to its left is.
 * Anchor the recurring micro-crop to that fixed word and capture only the value
 * cell to its right. This keeps geometry stable across the whole cooldown cycle
 * and gives the single-word OCR path more vertical breathing room.
 */
function normalizedSkillValueRect(
  skillAnchor: HocrWord,
  imageWidth: number,
  imageHeight: number
): RelativeOcrRect | undefined {
  if (imageWidth <= 0 || imageHeight <= 0) return undefined;
  const wordHeight = Math.max(1, skillAnchor.y1 - skillAnchor.y0);
  const left = Math.max(0, Math.min(imageWidth - 1, skillAnchor.x1 + wordHeight * 0.12));
  const targetWidth = Math.min(imageWidth - left, imageWidth * 0.34);
  const targetHeight = Math.min(imageHeight, Math.max(imageHeight * 0.28, wordHeight * 2.8));
  const centerY = (skillAnchor.y0 + skillAnchor.y1) / 2;
  const top = Math.max(0, Math.min(imageHeight - targetHeight, centerY - targetHeight / 2));
  return {
    x: left / imageWidth,
    y: top / imageHeight,
    width: targetWidth / imageWidth,
    height: targetHeight / imageHeight
  };
}
'''
new = '''/**
 * Chopping's changing value (`Ready`, `Active`, `153s`, ...) is not a stable
 * calibration anchor. The literal `Skill:` label immediately to its left is.
 * Capture the stable label AND its value as one small line. The extra context
 * costs little compared with the base Chopping crop but is substantially more
 * robust than OCRing a value-only sliver at different UI scales.
 */
function normalizedSkillCellRect(
  skillAnchor: HocrWord,
  imageWidth: number,
  imageHeight: number
): RelativeOcrRect | undefined {
  if (imageWidth <= 0 || imageHeight <= 0) return undefined;
  const wordHeight = Math.max(1, skillAnchor.y1 - skillAnchor.y0);
  const left = Math.max(0, skillAnchor.x0 - wordHeight * 0.25);
  const targetWidth = Math.min(imageWidth - left, imageWidth * 0.50);
  const targetHeight = Math.min(imageHeight, Math.max(imageHeight * 0.30, wordHeight * 3.0));
  const centerY = (skillAnchor.y0 + skillAnchor.y1) / 2;
  const top = Math.max(0, Math.min(imageHeight - targetHeight, centerY - targetHeight / 2));
  return {
    x: left / imageWidth,
    y: top / imageHeight,
    width: targetWidth / imageWidth,
    height: targetHeight / imageHeight
  };
}
'''
text = replace_once(text, old, new, "Skill-cell crop helper")
text = replace_once(text, "return normalizedSkillValueRect(skillAnchor, imageWidth, imageHeight);", "return normalizedSkillCellRect(skillAnchor, imageWidth, imageHeight);", "Skill-cell crop call")
write(path, text)

# A micro boost crop now contains `Skill:` plus the state, so use SINGLE_LINE and
# include the anchor characters in the whitelist.
path = "src/extension/offscreen.ts"
text = read(path)
old = '''  if (micro && mode === "boost") {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_WORD,
      preserve_interword_spaces: "0",
      tessedit_char_whitelist: "ReadyACTIVEactive0123456789sSOoIl|"
    });
    return;
  }
'''
new = '''  if (micro && mode === "boost") {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      preserve_interword_spaces: "1",
      tessedit_char_whitelist: "SkillskillReadyACTIVEactive0123456789sSOoIl|:="
    });
    return;
  }
'''
text = replace_once(text, old, new, "boost micro OCR parameters")
write(path, text)

# The real bug observed by the user: a failed micro crop intentionally waited
# for later syncs before falling back, so Chopping could stay stale for seconds.
# Make the micro crop opportunistic. Fall back to the SAME profile immediately,
# and temporarily bypass micro OCR if it proves unreliable repeatedly.
path = "extension/background-v3.ts"
text = read(path)
text = replace_once(
    text,
    'let boostMisses = 0;\nlet lastCounterReadAt = 0;',
    'let boostMisses = 0;\nlet boostMicroFailureStreak = 0;\nlet boostMicroBypassUntil = 0;\nlet lastCounterReadAt = 0;',
    "micro failure state"
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
    "micro invalidation reset"
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
text = replace_once(text, old, new, "immediate same-profile micro fallback")
text = replace_once(
    text,
    '''    if (boostMisses < 2) {
      boostMisses += 1;
      log(`Chopping OCR miss ${boostMisses}/2 on the active profile; deferring multi-profile recovery to avoid a renderer spike.`, "debug", {
        category: "ocr", event: "boost.profile_recovery_deferred"
      });
      return skill;
    }
''',
    '''    const criticalProfileRecovery = workClass === "boost-critical";
    if (!criticalProfileRecovery && boostMisses < 1) {
      boostMisses += 1;
      log("Chopping same-profile OCR missed once; deferring multi-profile recovery for one normal sync to avoid a renderer spike.", "debug", {
        category: "ocr", event: "boost.profile_recovery_deferred"
      });
      return skill;
    }
''',
    "profile recovery delay"
)
write(path, text)

# Make the boundary-agreement test unambiguous: ordinary recovery accepts a 2s
# difference while the strict final lock rejects it.
path = "src/extension/reliability.test.ts"
text = read(path)
text = replace_once(text, '    const tooFar = { seconds: 7, captureAt: 101_000 };', '    const tooFar = { seconds: 4, captureAt: 101_000 };', "final-lock test fixture")
write(path, text)

# Strengthen crop tests so we prove the recurring rectangle contains both the
# Skill anchor and the varying state value.
path = "src/extension/ocrCalibration.test.ts"
text = read(path)
needle = '''    expect(Math.abs(ready.width - cooldown.width)).toBeLessThan(0.03);
  });
'''
replacement = '''    expect(Math.abs(ready.width - cooldown.width)).toBeLessThan(0.03);
    expect(ready.x).toBeLessThanOrEqual(220 / 400);
    expect(ready.x + ready.width).toBeGreaterThanOrEqual(350 / 400);
  });
'''
text = replace_once(text, needle, replacement, "Skill-cell crop assertions")
write(path, text)

# Update the release audit to reject the exact slow-fallback behaviour reported
# by the user and to enforce the more robust Skill-cell OCR mode.
path = "scripts/audit-extension.mjs"
text = read(path)
text = replace_once(
    text,
    'expect(background.includes("micro.miss_deferred"), "single micro-crop misses still immediately trigger larger fallback work");\n',
    'expect(background.includes("micro.immediate_fallback"), "a failed Chopping micro-crop does not immediately retry the safe same-profile crop");\nexpect(background.includes("micro.bypass"), "repeated Chopping micro-crop failures do not enter temporary bypass mode");\n',
    "audit micro fallback"
)
text = replace_once(
    text,
    'expect(background.includes("if (!critical && boostMisses < 2)") && background.includes("if (boostMisses < 2)"), "ordinary Chopping misses are not staged before both same-profile and multi-profile recovery");',
    'expect(background.includes("boostMicroBypassUntil") && background.includes("criticalProfileRecovery"), "Chopping fallback does not adapt after repeated micro failures");',
    "audit fallback strategy"
)
text = replace_once(
    text,
    'expect(calibration.includes("normalizedSkillValueRect"), "Skill:-anchored Chopping value crop helper is missing");\nexpect(calibration.includes("resemblesSkillAnchor"), "Chopping crop is not anchored to the stable Skill: label");\nexpect(calibration.includes("skillAnchor.x1"), "Chopping value crop does not start from the fixed Skill: anchor");',
    'expect(calibration.includes("normalizedSkillCellRect"), "Skill:-anchored Chopping cell crop helper is missing");\nexpect(calibration.includes("resemblesSkillAnchor"), "Chopping crop is not anchored to the stable Skill: label");\nexpect(calibration.includes("skillAnchor.x0"), "Chopping cell crop does not include the fixed Skill: anchor");',
    "audit Skill-cell geometry"
)
text = replace_once(
    text,
    'expect(offscreen.includes(\'tessedit_char_whitelist: ""\'), "full OCR does not clear the restrictive micro whitelist");',
    'expect(offscreen.includes(\'tessedit_char_whitelist: ""\'), "full OCR does not clear the restrictive micro whitelist");\nexpect(offscreen.includes("PSM.SINGLE_LINE"), "Chopping micro OCR is not configured as a stable Skill/value line");\nexpect(offscreen.includes("SkillskillReady"), "Chopping micro whitelist does not include the Skill anchor text");',
    "audit micro OCR parameters"
)
# Ensure temporary migration files themselves are rejected if they somehow leak into the release.
text = replace_once(
    text,
    '  ".github/workflows/apply-v037-final.yml"\n]) {',
    '  ".github/workflows/apply-v037-final.yml",\n  "scripts/fix-v037-chopping-crop.py",\n  ".github/workflows/fix-v037-chopping-crop.yml"\n]) {',
    "audit temporary files"
)
write(path, text)

print("v0.3.7 Chopping OCR fast-fallback fix applied")
