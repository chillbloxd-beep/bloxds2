from pathlib import Path
p=Path('src/views/LiveExtension.tsx')
s=p.read_text()
block='''function formatRate6(value?: number) {\n  if (value === undefined || !Number.isFinite(value)) return "—";\n  if (value === 0) return "0.00000";\n  return value.toPrecision(6);\n}\n\n'''
if s.count(block) != 2:
    raise RuntimeError(f'Expected duplicate formatRate6 blocks, found {s.count(block)}')
first=s.find(block)
second=s.find(block, first+len(block))
s=s[:second]+s[second+len(block):]
p.write_text(s)
