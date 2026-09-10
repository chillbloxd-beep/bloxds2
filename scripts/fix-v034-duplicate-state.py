from pathlib import Path
p=Path('extension/background-v3.ts')
s=p.read_text()
block='''let predictedReadyAt: number | undefined;\nlet lastBoostCaptureAt: number | undefined;\nlet boostDriftSeconds: number | undefined;\nlet lastCooldownSyncAt = 0;\nlet precisionTimer: number | undefined;\nlet precisionWindowActive = false;\nlet dumbModeArmed = false;\nlet dumbBaseline: { value: number; at: number } | undefined;\nlet dumbArmSnapshot: SidebarSnapshot | undefined;\n'''
if s.count(block) != 2:
    raise RuntimeError(f'Expected state block twice, found {s.count(block)}')
first=s.find(block)
second=s.find(block, first+len(block))
s=s[:second]+s[second+len(block):]
p.write_text(s)
