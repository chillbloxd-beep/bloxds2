from pathlib import Path

root = Path(__file__).resolve().parents[1]
source_path = root / "scripts/finalize-v035.py"
source = source_path.read_text()

# Patch 1: the original finalizer intentionally used exact-match guards, but this
# sequence exists in multiple lifecycle handlers. Anchor it to disconnect().
start_marker = "replace_once(\n    BG,\n    '''  clearShortTimers();\\n  void chrome.alarms.clear(BOOST_WAKE);\\n''',"
end_marker = "\n\nreplace_once(\n    BG,\n    '''  dumbArmSnapshot"
start = source.find(start_marker)
if start < 0:
    raise RuntimeError("ambiguous clearShortTimers finalizer block was not found")
end = source.find(end_marker, start)
if end < 0:
    raise RuntimeError("end of ambiguous clearShortTimers finalizer block was not found")
replacement = """text = read(BG)
marker = 'async function disconnect(reason = "Disconnected")'
start = text.index(marker)
prefix, tail = text[:start], text[start:]
old_disconnect = '  clearShortTimers();\\n  void chrome.alarms.clear(BOOST_WAKE);\\n'
if old_disconnect not in tail:
    raise RuntimeError('disconnect counter-cancel insertion point missing')
tail = tail.replace(old_disconnect, '  clearShortTimers();\\n  void cancelOffscreenWake(\"counter\");\\n  void chrome.alarms.clear(BOOST_WAKE);\\n', 1)
write(BG, prefix + tail)"""
source = source[:start] + replacement + source[end:]

# Patch 2: the same cooldown-clear sequence exists in setChoppingSkill() and the
# settings-off path. The power-state update belongs only to setSettings().
start_marker = "replace_once(\n    BG,\n    '''    boostCooldownReadyAt = undefined;\\n    boostWakeAt = undefined;\\n  }\\n''',"
end_marker = "\n\nreplace_once(\n    BG,\n    '''  scheduleCounter();"
start = source.find(start_marker)
if start < 0:
    raise RuntimeError("ambiguous autoBoost-off finalizer block was not found")
end = source.find(end_marker, start)
if end < 0:
    raise RuntimeError("end of ambiguous autoBoost-off finalizer block was not found")
replacement = """text = read(BG)
marker = '  if (!settings.autoBoost) {'
start = text.index(marker)
prefix, tail = text[:start], text[start:]
old_auto = '    boostCooldownReadyAt = undefined;\\n    boostWakeAt = undefined;\\n  }\\n'
if old_auto not in tail:
    raise RuntimeError('autoBoost-off power-state insertion point missing')
tail = tail.replace(old_auto, '    boostCooldownReadyAt = undefined;\\n    boostWakeAt = undefined;\\n    setPowerState(\"idle\");\\n  }\\n', 1)
write(BG, prefix + tail)"""
source = source[:start] + replacement + source[end:]

exec(compile(source, str(source_path), "exec"), {"__name__": "__main__", "__file__": str(source_path)})
