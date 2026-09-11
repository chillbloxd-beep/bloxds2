from pathlib import Path

path = Path("scripts/apply-v036-background-fixes.py")
text = path.read_text()
old = '''replace_once(
    '  fastBoostHits = 0;\\n  cooldownUncertaintySec = 2;',
    '  fastBoostHits = 0;\\n  fastRecognizerReady = false;\\n  provisionalCooldown = undefined;\\n  cooldownRecoveryCandidate = undefined;\\n  cooldownRecoveryPending = false;\\n  cooldownUncertaintySec = 2;',
    "disconnect cooldown reset"
)'''
new = '''replace_once(
    '  lastAcceptedBoostCaptureAt = 0;\\n  cooldownUncertaintySec = 2;',
    '  lastAcceptedBoostCaptureAt = 0;\\n  fastRecognizerReady = false;\\n  provisionalCooldown = undefined;\\n  cooldownRecoveryCandidate = undefined;\\n  cooldownRecoveryPending = false;\\n  cooldownUncertaintySec = 2;',
    "disconnect cooldown reset"
)'''
if text.count(old) != 1:
    raise SystemExit(f"expected one reset-anchor block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
print("patch script reset anchor repaired")
