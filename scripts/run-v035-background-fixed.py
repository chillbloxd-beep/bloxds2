from pathlib import Path

source_path = Path("scripts/apply-v035-background.py")
source = source_path.read_text()
old = '''replace_once(
    '        setChoppingSkill(await readBoost());',
    '        setChoppingSkill(await readBoost("boost-critical"));',
    "initial boost read"
)'''
new = '''if '        setChoppingSkill(await readBoost());' not in text:
    raise SystemExit("initial boost read: source call not found")
text = text.replace('        setChoppingSkill(await readBoost());', '        setChoppingSkill(await readBoost("boost-critical"));', 1)'''
if source.count(old) != 1:
    raise SystemExit(f"Could not patch migration runner safely; found {source.count(old)} target blocks")
corrected = source.replace(old, new, 1)
exec(compile(corrected, str(source_path), "exec"), {"__name__": "__main__"})
