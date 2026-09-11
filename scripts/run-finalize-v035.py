from pathlib import Path

root = Path(__file__).resolve().parents[1]
source_path = root / "scripts/finalize-v035.py"
source = source_path.read_text()
old = '''replace_once(\n    BG,\n    '''  clearShortTimers();\\n  void chrome.alarms.clear(BOOST_WAKE);\\n''',\n    '''  clearShortTimers();\\n  void cancelOffscreenWake("counter");\\n  void chrome.alarms.clear(BOOST_WAKE);\\n'''\n)'''
new = '''text = read(BG)\nmarker = "async function disconnect(reason = \\\"Disconnected\\\")"\nstart = text.index(marker)\nprefix, tail = text[:start], text[start:]\nold_disconnect = "  clearShortTimers();\\n  void chrome.alarms.clear(BOOST_WAKE);\\n"\nif tail.count(old_disconnect) < 1:\n    raise RuntimeError("disconnect counter-cancel insertion point missing")\ntail = tail.replace(old_disconnect, "  clearShortTimers();\\n  void cancelOffscreenWake(\\\"counter\\\");\\n  void chrome.alarms.clear(BOOST_WAKE);\\n", 1)\nwrite(BG, prefix + tail)'''
if source.count(old) != 1:
    raise RuntimeError(f"expected one finalizer block to patch, found {source.count(old)}")
patched = source.replace(old, new, 1)
exec(compile(patched, str(source_path), "exec"), {"__name__": "__main__", "__file__": str(source_path)})
