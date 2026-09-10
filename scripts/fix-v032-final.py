from pathlib import Path

p = Path('extension/background-v3.ts')
s = p.read_text()
s = s.replace('if (Date.now() - lastFullReadAt >= 15_000 && !boostCycle) {', 'if (Date.now() - lastFullReadAt >= 15_000 && !boostCycle && !boostSleeping) {')
s = s.replace('boostFault = "Input was not confirmed after the one allowed E ×2 retry.";', 'boostFault = "Input was not confirmed after the one allowed backup E ×3 burst.";')
s = s.replace('  await saveActiveSession();\n  log(`Session started at ${snapshot.blocksMined.toLocaleString()} blocks. Full sidebar snapshot saved.`);', '  await saveActiveSession();\n  lastCounterReadAt = 0; // Force a fresh small counter read on the next 1s UI poll.\n  log(`Session started at ${snapshot.blocksMined.toLocaleString()} blocks. Full sidebar snapshot saved; live counter refresh armed.`);')
p.write_text(s)

p = Path('src/views/LiveExtension.tsx')
s = p.read_text().replace('E double-tap gap (ms)', 'E burst gap (ms)')
p.write_text(s)
print('final v0.3.2 safeguards applied')
