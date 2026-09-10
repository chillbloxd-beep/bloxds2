import fs from "node:fs";

function replace(path, from, to) {
  const source = fs.readFileSync(path, "utf8");
  if (!source.includes(from)) throw new Error(`Expected text not found in ${path}: ${from.slice(0, 120)}`);
  fs.writeFileSync(path, source.replace(from, to));
}

replace("extension/background-v3.ts",
  "  boostMisses += 1;\n  if (boostMisses >= 2) {",
  "  boostMisses += 1;\n  // Bootstrap reliability: one unknown Chopping read immediately tries the\n  // alternate calibrated crops instead of leaving Auto Boost idle.\n  if (boostMisses >= 1) {"
);

replace("extension/background-v3.ts",
  "async function doubleE() {\n  await keyE();\n  await delay(settings.doubleTapGapMs);\n  await keyE();\n  log(`Sent E ×2 (${settings.doubleTapGapMs} ms gap).`);\n}",
  "async function doubleE() {\n  // The side panel can own keyboard focus after the user changes a toggle.\n  // Bring the already-connected Bloxd target to the front before dispatching\n  // trusted DevTools-protocol key input. This does not click or move the mouse.\n  await debuggerCommand(\"Page.bringToFront\");\n  await delay(60);\n  await keyE();\n  await delay(settings.doubleTapGapMs);\n  await keyE();\n  log(`Focused Bloxd and sent E ×2 (${settings.doubleTapGapMs} ms gap).`);\n}"
);

replace("extension/background-v3.ts",
  "    type: \"keyDown\",\n    key: \"e\",\n    code: \"KeyE\",\n    text: \"e\",\n    unmodifiedText: \"e\",",
  "    type: \"rawKeyDown\",\n    key: \"e\",\n    code: \"KeyE\",\n    autoRepeat: false,"
);

replace("extension/background-v3.ts",
  "  if (observed.state === \"ready\") await beginBoostCycle();\n  else if (observed.state === \"cooldown\" && observed.cooldownSeconds !== undefined) scheduleCooldown(observed.cooldownSeconds);\n  else if (observed.state === \"active\") scheduleActiveCheck();\n}",
  "  if (observed.state === \"ready\") await beginBoostCycle();\n  else if (observed.state === \"cooldown\" && observed.cooldownSeconds !== undefined) scheduleCooldown(observed.cooldownSeconds);\n  else if (observed.state === \"active\") scheduleActiveCheck();\n  else {\n    // v0.3.0 could stop here forever when the first OCR read was unknown.\n    // Keep the watcher alive without sending any input until Chopping is\n    // positively identified as Ready/Active/cooldown.\n    log(`Auto Boost waiting for a clear Chopping state; rechecking in ${settings.readyRetrySec}s.`, \"warn\");\n    scheduleRecheck();\n  }\n}"
);

replace("extension/background-v3.ts",
  "      case \"CLEAR_BOOST_FAULT\":\n        boostFault = undefined;",
  "      case \"TEST_E\":\n        if (connectedTabId === undefined) throw new Error(\"No One Block tab is connected.\");\n        if (settings.autoBoost) throw new Error(\"Turn Auto-use Chopping skill OFF before using Test E ×2.\");\n        log(\"Manual E ×2 input diagnostic requested.\");\n        await doubleE();\n        return { ok: true, status: status() };\n      case \"CLEAR_BOOST_FAULT\":\n        boostFault = undefined;"
);

replace("src/extension/types.ts",
  "  | { target: \"background\"; type: \"STOP_SESSION\" }\n  | { target: \"background\"; type: \"CLEAR_BOOST_FAULT\" }",
  "  | { target: \"background\"; type: \"STOP_SESSION\" }\n  | { target: \"background\"; type: \"TEST_E\" }\n  | { target: \"background\"; type: \"CLEAR_BOOST_FAULT\" }"
);

replace("src/views/LiveExtension.tsx",
  "        <label className=\"switch-row compact-switch\"><span><strong>Live counter OCR</strong><small>Samples only the Blocks mined region for rolling speed.</small></span><input type=\"checkbox\" checked={settings.liveCounter} onChange={event => void patch({ liveCounter: event.target.checked })} /></label>\n      </Section>",
  "        <label className=\"switch-row compact-switch\"><span><strong>Live counter OCR</strong><small>Samples only the Blocks mined region for rolling speed.</small></span><input type=\"checkbox\" checked={settings.liveCounter} onChange={event => void patch({ liveCounter: event.target.checked })} /></label>\n        <div className=\"mode-note\"><strong>Watcher:</strong> {settings.autoBoost ? (status.boostFault ? \"Paused by fault\" : status.choppingSkill.state === \"unknown\" ? \"Waiting for clear Chopping OCR; auto-rechecking\" : `Armed · ${skillLabel(status.choppingSkill)}`) : \"Off\"}</div>\n        <button className=\"quiet-button\" disabled={busy || !status.connected || settings.autoBoost} onClick={() => void run(() => command({ target: \"background\", type: \"TEST_E\" }))}>Test E ×2</button>\n        <p className=\"microcopy\">Input diagnostic only: turn Auto-use Chopping skill off, stand in-game with the skill Ready, then press Test E ×2. If Mega Chop activates, debugger keyboard input is working and any remaining issue is OCR/state detection.</p>\n      </Section>"
);

replace("extension/public/manifest.json", '"version": "0.3.0"', '"version": "0.3.1"');
replace("package.json", '"version": "0.3.0"', '"version": "0.3.1"');

fs.appendFileSync("README.md", `\n### v0.3.1 Auto Boost bootstrap fix\n\nAuto Boost now keeps rechecking when the first Chopping OCR state is unknown instead of remaining idle. The first unknown boost crop immediately tries alternate calibrated crops. E dispatch brings the connected Bloxd target to the front and uses raw key-down input, which is better suited to game keyboard handlers. A **Test E ×2** diagnostic (available while Auto Boost is off) separates OCR/state-detection failures from keyboard-input failures.\n`);

// Remove this one-shot patch machinery from the resulting branch commit.
for (const path of ["scripts/apply-auto-boost-fix.mjs", ".github/workflows/patch-auto-boost.yml"]) {
  if (fs.existsSync(path)) fs.rmSync(path);
}
