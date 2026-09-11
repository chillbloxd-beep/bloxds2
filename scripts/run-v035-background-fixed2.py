from pathlib import Path

source_path = Path("scripts/apply-v035-background.py")
source = source_path.read_text()

initial_old = '''replace_once(
    '        setChoppingSkill(await readBoost());',
    '        setChoppingSkill(await readBoost("boost-critical"));',
    "initial boost read"
)'''
initial_new = '''if '        setChoppingSkill(await readBoost());' not in text:
    raise SystemExit("initial boost read: source call not found")
text = text.replace('        setChoppingSkill(await readBoost());', '        setChoppingSkill(await readBoost("boost-critical"));', 1)'''
if source.count(initial_old) != 1:
    raise SystemExit(f"initial patch target count was {source.count(initial_old)}")
source = source.replace(initial_old, initial_new, 1)

old_block = '''  connectedTabId = undefined;\\n  connectedUrl = undefined;\\n  activeOcrProfile = undefined;\\n  lastViewport = undefined;\\n  clearShortTimers();'''
new_block = '''  connectionEpoch += 1;\\n  boostStateEpoch += 1;\\n  connectedTabId = undefined;\\n  connectedUrl = undefined;\\n  activeOcrProfile = undefined;\\n  lastViewport = undefined;\\n  viewportCheckedAt = 0;\\n  invalidateMicroCrops();\\n  clearShortTimers();'''

first_old = f'''replace_once(\n    '{old_block}',\n    '{new_block}',\n    "tab removed reset"\n)'''
first_new = f'''if '{old_block}' not in text:\n    raise SystemExit("tab removed reset: source block not found")\ntext = text.replace('{old_block}', '{new_block}', 1)'''
if source.count(first_old) != 1:
    raise SystemExit(f"tab reset migration block count was {source.count(first_old)}")
source = source.replace(first_old, first_new, 1)

second_old = f'''# Same block appears again in debugger detach after the first replacement.\nreplace_once(\n    '{old_block}',\n    '{new_block}',\n    "debugger detach reset"\n)'''
second_new = f'''# Same block appears again in debugger detach after the first replacement.\nif '{old_block}' not in text:\n    raise SystemExit("debugger detach reset: source block not found")\ntext = text.replace('{old_block}', '{new_block}', 1)'''
if source.count(second_old) != 1:
    raise SystemExit(f"debugger reset migration block count was {source.count(second_old)}")
source = source.replace(second_old, second_new, 1)

exec(compile(source, str(source_path), "exec"), {"__name__": "__main__"})
