import fs from 'node:fs';

function edit(path, mutate) {
  const before = fs.readFileSync(path, 'utf8');
  const after = mutate(before);
  if (after !== before) fs.writeFileSync(path, after);
}

function replaceRequired(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`Patch target missing: ${label}`);
  return text.replace(from, to);
}

edit('extension/background-v3.ts', source => {
  let s = source;

  s = replaceRequired(s,
`  counterIntervalSec: 10,`,
`  counterIntervalSec: 5,`,
'default counter interval');

  s = replaceRequired(s,
`let boostMisses = 0;`,
`let boostMisses = 0;
let lastCounterReadAt = 0;
let lastBoostReadAt = 0;
let lastFullReadAt = 0;
let boostCooldownReadyAt: number | undefined;
let boostWakeAt: number | undefined;
let liveRefreshFlight: Promise<void> | null = null;`,
'live refresh timestamps');

  s = replaceRequired(s,
`  diagnostics = [{ at: new Date().toISOString(), level, message }, ...diagnostics].slice(0, 100);`,
`  diagnostics = [{ at: new Date().toISOString(), level, message }, ...diagnostics].slice(0, 300);`,
'diagnostic capacity');

  s = replaceRequired(s,
`    counterIntervalSec: Math.min(60, Math.max(5, Number(next.counterIntervalSec) || 10)),`,
`    counterIntervalSec: Math.min(60, Math.max(5, Number(next.counterIntervalSec) || 5)),`,
'counter sanitize fallback');

  s = replaceRequired(s,
`function applySnapshot(snapshot: SidebarSnapshot) {
  currentSnapshot = snapshot;
  if (snapshot.blocksMined !== undefined) updateCounter(snapshot.blocksMined);
  if (snapshot.chopping?.skill) choppingSkill = snapshot.chopping.skill;
}`,
`function skillText(skill: SkillStateSnapshot): string {
  if (skill.state === "cooldown") return `${'${'}skill.cooldownSeconds ?? "?"}s`;
  return skill.state;
}

function setChoppingSkill(skill: SkillStateSnapshot) {
  const previous = skillText(choppingSkill);
  const next = skillText(skill);
  choppingSkill = skill;
  lastBoostReadAt = Date.now();
  if (currentSnapshot) {
    currentSnapshot.chopping = { ...(currentSnapshot.chopping || {}), skill };
  }
  if (skill.state === "ready" || skill.state === "active") {
    boostCooldownReadyAt = undefined;
    boostWakeAt = undefined;
  }
  if (previous !== next) log(`Chopping state updated: ${'${'}previous} → ${'${'}next}.`);
}

function applySnapshot(snapshot: SidebarSnapshot) {
  currentSnapshot = snapshot;
  lastFullReadAt = Date.now();
  if (snapshot.blocksMined !== undefined) updateCounter(snapshot.blocksMined);
  if (snapshot.chopping?.skill) setChoppingSkill(snapshot.chopping.skill);
}`,
'live chopping snapshot helper');

  s = s.replaceAll('choppingSkill = skill;', 'setChoppingSkill(skill);');
  s = s.replaceAll('choppingSkill = await readBoost();', 'setChoppingSkill(await readBoost());');

  s = replaceRequired(s,
`function updateCounter(value: number) {
  const now = Date.now();
  if (lastCounter && value >= lastCounter.value && now > lastCounter.at) {
    const delta = value - lastCounter.value;
    rollingBps = delta / ((now - lastCounter.at) / 1000);
  }
  lastCounter = { value, at: now };
  if (currentSnapshot) currentSnapshot.blocksMined = value;
}`,
`function updateCounter(value: number) {
  const now = Date.now();
  const previous = lastCounter;
  if (previous && value >= previous.value && now > previous.at) {
    const delta = value - previous.value;
    rollingBps = delta / ((now - previous.at) / 1000);
  }
  lastCounter = { value, at: now };
  lastCounterReadAt = now;
  if (currentSnapshot) currentSnapshot.blocksMined = value;
  if (previous && value !== previous.value) {
    const delta = value - previous.value;
    log(`Blocks mined updated: ${'${'}previous.value.toLocaleString()} → ${'${'}value.toLocaleString()} (${'${'}delta >= 0 ? "+" : ""}${'${'}delta}).`);
  }
}`,
'live counter updates');

  s = replaceRequired(s,
`async function doubleE() {
  // The side panel can own keyboard focus after the user changes a toggle.
  // Bring the already-connected Bloxd target to the front before dispatching
  // trusted DevTools-protocol key input. This does not click or move the mouse.
  await debuggerCommand("Page.bringToFront");
  await delay(60);
  await keyE();
  await delay(settings.doubleTapGapMs);
  await keyE();
  log(`Focused Bloxd and sent E ×2 (${'${'}settings.doubleTapGapMs} ms gap).`);
}`,
`async function pressEBurst(count: number, label: string) {
  log(`${'${'}label}: attempting E ×${'${'}count}.`);
  await debuggerCommand("Page.bringToFront");
  try {
    await debuggerCommand("Runtime.evaluate", {
      expression: `(function(){const cs=[...document.querySelectorAll('canvas')].filter(c=>c.offsetWidth>0&&c.offsetHeight>0);const c=cs.sort((a,b)=>(b.offsetWidth*b.offsetHeight)-(a.offsetWidth*a.offsetHeight))[0];if(c){if(!c.hasAttribute('tabindex'))c.tabIndex=-1;c.focus({preventScroll:true});return 'canvas';}if(document.body){if(!document.body.hasAttribute('tabindex'))document.body.tabIndex=-1;document.body.focus({preventScroll:true});return 'body';}return 'page';})()`,
      returnByValue: true
    });
    log(`${'${'}label}: Bloxd game surface focused.`);
  } catch (error) {
    log(`${'${'}label}: focus helper failed (${errorText(error)}); continuing with page focus.`, "warn");
  }
  await delay(80);
  for (let i = 1; i <= count; i += 1) {
    log(`${'${'}label}: pressing E ${'${'}i}/${'${'}count}…`);
    await keyE();
    log(`${'${'}label}: E ${'${'}i}/${'${'}count} pressed.`);
    if (i < count) await delay(settings.doubleTapGapMs);
  }
  log(`${'${'}label}: E ×${'${'}count} completed.`);
}`,
'E burst input');

  s = replaceRequired(s,
`  boostCycle = { retryUsed: false, confirmed: false, ambiguousReads: 0 };
  try {
    await doubleE();
    scheduleVerify();`,
`  boostCycle = { retryUsed: false, confirmed: false, ambiguousReads: 0 };
  try {
    log("Chopping Ready confirmed. Starting primary E ×5 activation burst.");
    await pressEBurst(5, "Primary boost input");
    log(`Primary E ×5 finished. Verifying Chopping state in ${'${'}settings.verifyAfterPressSec}s.`);
    scheduleVerify();`,
'primary E x5');

  s = replaceRequired(s,
`        log("Chopping still Ready after 3s; sending the single E ×2 retry.", "warn");
        await doubleE();
        scheduleVerify();`,
`        log(`Chopping still Ready after ${'${'}settings.verifyAfterPressSec}s; starting backup E ×3 burst.`, "warn");
        await pressEBurst(3, "Backup boost input");
        log(`Backup E ×3 finished. Verifying again in ${'${'}settings.verifyAfterPressSec}s.`);
        scheduleVerify();`,
'backup E x3');

  s = replaceRequired(s,
`function scheduleCooldown(seconds: number) {
  boostTotals.cooldownsRead = [...boostTotals.cooldownsRead, seconds].slice(-100);
  const sleepFor = seconds + settings.cooldownSafetySec;
  log(`Cooldown read: ${'${'}seconds}s. Boost OCR sleeping for ${'${'}sleepFor}s.`);
  boostCycle = undefined;
  clearTimer(verifyTimer);
  clearTimer(activeTimer);
  clearTimer(recheckTimer);
  void chrome.alarms.clear(BOOST_WAKE).then(() => {
    chrome.alarms.create(BOOST_WAKE, { when: Date.now() + sleepFor * 1000 });
  });
}`,
`function scheduleCooldown(seconds: number) {
  boostTotals.cooldownsRead = [...boostTotals.cooldownsRead, seconds].slice(-100);
  const now = Date.now();
  const sleepFor = seconds + settings.cooldownSafetySec;
  boostCooldownReadyAt = now + seconds * 1000;
  boostWakeAt = now + sleepFor * 1000;
  setChoppingSkill({ state: "cooldown", cooldownSeconds: seconds, raw: choppingSkill.raw });
  log(`Cooldown read: ${'${'}seconds}s. Local countdown is live; boost OCR sleeps until ${'${'}new Date(boostWakeAt).toLocaleTimeString()}.`);
  boostCycle = undefined;
  clearTimer(verifyTimer);
  clearTimer(activeTimer);
  clearTimer(recheckTimer);
  void chrome.alarms.clear(BOOST_WAKE).then(() => {
    chrome.alarms.create(BOOST_WAKE, { when: boostWakeAt });
  });
}`,
'live cooldown countdown');

  s = replaceRequired(s,
`async function maybeArmBoostFromSnapshot() {
  if (!settings.autoBoost || boostFault || boostCycle || connectedTabId === undefined) return;
  const observed = choppingSkill;
  if (observed.state === "ready") await beginBoostCycle();
  else if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) scheduleCooldown(observed.cooldownSeconds);
  else if (observed.state === "active") scheduleActiveCheck();
  else {
    // v0.3.0 could stop here forever when the first OCR read was unknown.
    // Keep the watcher alive without sending any input until Chopping is
    // positively identified as Ready/Active/cooldown.
    log(`Auto Boost waiting for a clear Chopping state; rechecking in ${'${'}settings.readyRetrySec}s.`, "warn");
    scheduleRecheck();
  }
}`,
`async function maybeArmBoostFromSnapshot() {
  if (!settings.autoBoost || boostFault || boostCycle || connectedTabId === undefined) return;
  const observed = choppingSkill;
  if (observed.state === "ready") await beginBoostCycle();
  else if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) scheduleCooldown(observed.cooldownSeconds);
  else if (observed.state === "active") scheduleActiveCheck();
  else {
    log(`Auto Boost waiting for a clear Chopping state; rechecking in ${'${'}settings.readyRetrySec}s.`, "warn");
    scheduleRecheck();
  }
}

async function refreshLiveStateOnPoll() {
  if (connectedTabId === undefined) return;
  if (liveRefreshFlight) return liveRefreshFlight;
  const flight = (async () => {
    const now = Date.now();

    if (settings.liveCounter && now - lastCounterReadAt >= settings.counterIntervalSec * 1000) {
      try {
        const value = await readCounter();
        if (value === undefined) log("Live counter refresh did not get a number; it will retry automatically.", "warn");
      } catch (error) {
        log(`Live counter refresh: ${'${'}errorText(error)}`, "warn");
      }
    }

    const afterCounter = Date.now();
    const boostSleeping = boostWakeAt !== undefined && afterCounter < boostWakeAt;
    if (settings.autoBoost && !boostFault && !boostCycle && !boostSleeping && afterCounter - lastBoostReadAt >= 2000) {
      try {
        const observed = await readBoost();
        if (observed.state === "ready") await beginBoostCycle();
        else if (observed.state === "cooldown" && observed.cooldownSeconds !== undefined) scheduleCooldown(observed.cooldownSeconds);
        else if (observed.state === "active") scheduleActiveCheck();
        else scheduleRecheck();
      } catch (error) {
        log(`Live Chopping refresh: ${'${'}errorText(error)}`, "warn");
      }
    }

    // Keep the rest of the parsed sidebar reasonably fresh while the side
    // panel is open. Counter + Chopping stay much fresher through tiny crops.
    if (Date.now() - lastFullReadAt >= 15_000 && !boostCycle) {
      void readFullSnapshot(false)
        .then(snapshot => log(`Full sidebar live refresh complete${'${'}snapshot.blocksMined !== undefined ? ` · ${'${'}snapshot.blocksMined.toLocaleString()} blocks` : ""}.`))
        .catch(error => log(`Full sidebar live refresh: ${'${'}errorText(error)}`, "warn"));
    }
  })();
  liveRefreshFlight = flight;
  try {
    await flight;
  } finally {
    if (liveRefreshFlight === flight) liveRefreshFlight = null;
  }
}`,
'poll-driven live state refresh');

  s = replaceRequired(s,
`function status(): LiveExtensionStatus {
  const now = Date.now();
  ocrReads = ocrReads.filter(at => now - at < 60_000);
  return {`,
`function status(): LiveExtensionStatus {
  const now = Date.now();
  ocrReads = ocrReads.filter(at => now - at < 60_000);
  let liveChoppingSkill = choppingSkill;
  if (choppingSkill.state === "cooldown" && boostCooldownReadyAt !== undefined) {
    liveChoppingSkill = {
      ...choppingSkill,
      cooldownSeconds: Math.max(0, Math.ceil((boostCooldownReadyAt - now) / 1000))
    };
  }
  const liveSnapshot = currentSnapshot ? { ...currentSnapshot } : undefined;
  if (liveSnapshot && liveChoppingSkill.state !== "unknown") {
    liveSnapshot.chopping = { ...(liveSnapshot.chopping || {}), skill: liveChoppingSkill };
  }
  return {`,
'dynamic cooldown status');

  s = replaceRequired(s,
`    choppingSkill,`,
`    choppingSkill: liveChoppingSkill,`,
'status live chopping field');

  s = replaceRequired(s,
`    currentSnapshot,
    diagnostics`,
`    currentSnapshot: liveSnapshot,
    diagnostics`,
'status live snapshot field');

  s = replaceRequired(s,
`      case "GET_STATUS":
        await reconcileConnection();
        return { ok: true, status: status() };`,
`      case "GET_STATUS":
        await reconcileConnection();
        await refreshLiveStateOnPoll();
        return { ok: true, status: status() };`,
'poll refresh command');

  s = replaceRequired(s,
`      case "TEST_E":
        if (connectedTabId === undefined) throw new Error("No One Block tab is connected.");
        if (settings.autoBoost) throw new Error("Turn Auto-use Chopping skill OFF before using Test E ×2.");
        log("Manual E ×2 input diagnostic requested.");
        await doubleE();
        return { ok: true, status: status() };`,
`      case "TEST_E":
        if (connectedTabId === undefined) throw new Error("No One Block tab is connected.");
        if (settings.autoBoost) throw new Error("Turn Auto-use Chopping skill OFF before using Test E ×5.");
        log("Manual E ×5 input diagnostic requested.");
        await pressEBurst(5, "Manual input test");
        return { ok: true, status: status() };`,
'test E x5');

  s = replaceRequired(s,
`    void chrome.alarms.clear(BOOST_WAKE);`,
`    void chrome.alarms.clear(BOOST_WAKE);
    boostCooldownReadyAt = undefined;
    boostWakeAt = undefined;`,
'clear cooldown on boost off');

  s = replaceRequired(s,
`  counterMisses = 0;
  boostMisses = 0;
  if (tabId !== undefined) {`,
`  counterMisses = 0;
  boostMisses = 0;
  lastCounterReadAt = 0;
  lastBoostReadAt = 0;
  lastFullReadAt = 0;
  boostCooldownReadyAt = undefined;
  boostWakeAt = undefined;
  if (tabId !== undefined) {`,
'clear live timestamps on disconnect');

  s = replaceRequired(s,
`chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== BOOST_WAKE) return;
  void ensureLoaded().then(wakeBoost);
});`,
`chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== BOOST_WAKE) return;
  boostWakeAt = undefined;
  log("Cooldown wake alarm fired; checking Chopping state now.");
  void ensureLoaded().then(wakeBoost);
});`,
'cooldown wake logging');

  fs.writeFileSync('extension/background-v3.ts', s);
  return s;
});

edit('src/views/LiveExtension.tsx', source => {
  let s = source;
  s = replaceRequired(s,
`    const statusTimer = window.setInterval(() => void refresh(), 2500);`,
`    const statusTimer = window.setInterval(() => void refresh(), 1000);`,
'one-second status poll');

  s = replaceRequired(s,
`<small>Chopping Ready → E ×2 → wait 3s → verify. Neighboring Digging/Gold Ready states cannot trigger E.</small>`,
`<small>Chopping Ready → E ×5 → wait 3s → verify. If still Ready, one backup E ×3 burst is sent. Neighboring Digging/Gold Ready states cannot trigger E.</small>`,
'boost UI description');

  s = replaceRequired(s,
`<button className="quiet-button" disabled={busy || !status.connected || settings.autoBoost} onClick={() => void run(() => command({ target: "background", type: "TEST_E" }))}>Test E ×2</button>`,
`<button className="quiet-button" disabled={busy || !status.connected || settings.autoBoost} onClick={() => void run(() => command({ target: "background", type: "TEST_E" }))}>Test E ×5</button>`,
'input test label');

  s = replaceRequired(s,
`<p className="microcopy">Input diagnostic only: turn Auto-use Chopping skill off, stand in-game with the skill Ready, then press Test E ×2. If Mega Chop activates, debugger keyboard input is working and any remaining issue is OCR/state detection.</p>`,
`<p className="microcopy">Input diagnostic only: turn Auto-use Chopping skill off, stand in-game with the skill Ready, then press Test E ×5. The Action Log records the focus attempt and every E press individually.</p>`,
'input test copy');

  s = replaceRequired(s,
`    <Section title="Diagnostics">`,
`    <div className="floating-action-log">
      <div className="floating-action-log-head"><strong>Action Log</strong><span>LIVE · newest first</span></div>
      <div className="floating-action-log-body">{status.diagnostics.length ? status.diagnostics.slice(0, 40).map((entry, index) => <div key={\`action-${'${'}entry.at}-${'${'}index}\`} className={entry.level}><time>{new Date(entry.at).toLocaleTimeString()}</time><span>{entry.message}</span></div>) : <span className="muted-text">Waiting for extension actions…</span>}</div>
    </div>

    <Section title="Diagnostics">`,
'floating action log');

  fs.writeFileSync('src/views/LiveExtension.tsx', s);
  return s;
});

edit('src/styles.css', source => {
  if (source.includes('.floating-action-log{')) return source;
  return source + `\n/* OneBlock extension live action log */\n.floating-action-log{position:fixed;right:14px;bottom:14px;width:min(430px,calc(100vw - 28px));max-height:245px;z-index:80;border:1px solid var(--line-strong);border-radius:8px;background:color-mix(in srgb,var(--surface) 96%,transparent);box-shadow:0 12px 36px rgba(0,0,0,.14);overflow:hidden;backdrop-filter:blur(4px)}\n.floating-action-log-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 11px;border-bottom:1px solid var(--line);background:var(--surface-2)}\n.floating-action-log-head strong{font-size:11px;letter-spacing:.02em}.floating-action-log-head span{font-size:8px;letter-spacing:.1em;color:var(--muted)}\n.floating-action-log-body{max-height:190px;overflow:auto;padding:4px 9px;background:var(--surface)}\n.floating-action-log-body>div{display:grid;grid-template-columns:78px 1fr;gap:8px;padding:5px 0;border-bottom:1px solid var(--line);font-size:9px;line-height:1.35}\n.floating-action-log-body time{color:var(--muted);font-variant-numeric:tabular-nums}.floating-action-log-body .warn span{color:var(--warn)}.floating-action-log-body .error span{color:var(--bad)}\n@media(max-width:700px){.floating-action-log{right:8px;bottom:8px;width:calc(100vw - 16px);max-height:205px}.floating-action-log-body{max-height:150px}}\n`;
});

edit('package.json', source => source.replace('"version": "0.3.1"', '"version": "0.3.2"'));
edit('extension/public/manifest.json', source => source
  .replace('"version": "0.3.1"', '"version": "0.3.2"')
  .replace('Adaptive local One Block OCR, run analytics and optional guarded Chopping skill automation for Bloxd.io.', 'Live local One Block OCR, run analytics and guarded Chopping skill automation with responsive state updates for Bloxd.io.'));

edit('README.md', source => {
  let s = source;
  s = s.replace('E → short gap → E', 'E ×5 primary burst');
  s = s.replace('`Ready` = send **one** additional E ×2 retry, then verify again.', '`Ready` = send **one** backup E ×3 burst, then verify again.');
  s = s.replace('still `Ready` after the single retry', 'still `Ready` after the single backup burst');
  s = s.replace('- counter OCR: small `Blocks mined` crop, default every 10 seconds while enabled', '- counter OCR: small `Blocks mined` crop, default every 5 seconds while enabled; side-panel status polling also drives recovery if a service-worker timer was suspended');
  if (!s.includes('v0.3.2 live refresh')) s += '\n\n### v0.3.2 live refresh\n\nThe extension side panel polls live state once per second. Counter OCR is due every 5 seconds by default, Chopping is re-read during actionable states, the visible cooldown decrements locally without OCRing every second, and the parsed full sidebar refreshes periodically while the panel is open. A floating Action Log mirrors the newest diagnostics, including each attempted E press.\n';
  return s;
});

console.log('v0.3.2 patch applied');
