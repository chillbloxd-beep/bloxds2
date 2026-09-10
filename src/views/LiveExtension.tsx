import { useEffect, useMemo, useState } from "react";
import type { AppSettings, MiningSession, MiningType, SkillStateSnapshot } from "../types";
import type { BackgroundCommand, BackgroundResponse, ExtensionSettings, LiveExtensionStatus } from "../extension/types";
import { Badge, Metric, PageHead, Section } from "../components/UI";
import { formatDuration, formatInteger, formatRate } from "../lib/math";

async function command<T = unknown>(message: BackgroundCommand): Promise<BackgroundResponse<T>> {
  const response = await chrome.runtime.sendMessage(message) as BackgroundResponse<T>;
  if (!response?.ok) throw new Error(response?.error || "Extension command failed.");
  return response;
}

function skillLabel(skill?: SkillStateSnapshot) {
  if (!skill || skill.state === "unknown") return "Unknown";
  if (skill.state === "ready") return "Ready";
  if (skill.state === "active") return "Active";
  return `${skill.cooldownSeconds ?? "?"}s`;
}

function skillTone(skill?: SkillStateSnapshot): "good" | "warn" | "neutral" {
  if (skill?.state === "ready") return "good";
  if (skill?.state === "active" || skill?.state === "cooldown") return "warn";
  return "neutral";
}

function elapsed(startedAt?: string) {
  if (!startedAt) return "—";
  return formatDuration(Math.max(0, Date.now() - new Date(startedAt).getTime()), true);
}

export function LiveExtension({
  appSettings,
  onSave
}: {
  appSettings: AppSettings;
  onSave: (session: MiningSession) => Promise<void>;
}) {
  const [status, setStatus] = useState<LiveExtensionStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [miningType, setMiningType] = useState<MiningType>("active");
  const [, forceClock] = useState(0);

  async function refresh() {
    try {
      const response = await command({ target: "background", type: "GET_STATUS" });
      if (response.status) setStatus(response.status);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  useEffect(() => {
    void refresh();
    const statusTimer = window.setInterval(() => void refresh(), 1000);
    const clockTimer = window.setInterval(() => forceClock(value => value + 1), 1000);
    return () => {
      window.clearInterval(statusTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  async function run(action: () => Promise<BackgroundResponse>) {
    setBusy(true);
    setError("");
    try {
      const response = await action();
      if (response.status) setStatus(response.status);
      return response;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function patch(patchValue: Partial<ExtensionSettings>) {
    await run(() => command({ target: "background", type: "SET_SETTINGS", patch: patchValue }));
  }

  async function finishSession() {
    const response = await run(() => command({ target: "background", type: "STOP_SESSION" }));
    if (!response?.session) return;
    await onSave({
      ...response.session,
      communityOptIn: appSettings.defaultCommunityOptIn,
      cloudStatus: "local"
    });
    await refresh();
  }

  const snapshot = status?.currentSnapshot;
  const settings = status?.settings;
  const connectionText = status?.connected
    ? `Connected${status.lobby ? ` · Lobby ${status.lobby}` : ""}`
    : settings?.mode === "auto" ? "Waiting for One Block" : "Disconnected";
  const counterDelta = useMemo(() => {
    if (!status?.sessionActive || status.sessionStartBlocks === undefined || status.blocksMined === undefined) return undefined;
    return Math.max(0, status.blocksMined - status.sessionStartBlocks);
  }, [status?.sessionActive, status?.sessionStartBlocks, status?.blocksMined]);

  if (!status || !settings) {
    return <><PageHead eyebrow="BLOXD CONNECTION" title="Live" subtitle="Loading extension state…" />{error && <div className="callout warn"><strong>Extension error</strong><p>{error}</p></div>}</>;
  }

  return <>
    <PageHead eyebrow="BLOXD CONNECTION" title="Live One Block" subtitle="Adaptive local OCR reads the right-side One Block panel. Any lobby is supported." />

    {error && <div className="callout warn"><strong>Action failed</strong><p>{error}</p></div>}
    {status.boostFault && <div className="callout warn"><strong>Auto boost paused</strong><p>{status.boostFault}</p><button className="quiet-button" onClick={() => void run(() => command({ target: "background", type: "CLEAR_BOOST_FAULT" }))}>Retry safely</button></div>}

    <div className="live-connection-bar">
      <div><span className={`connection-dot ${status.connected ? "online" : ""}`} /><strong>{connectionText}</strong><small>{status.url || "Open https://bloxd.io/play/oneBlock"}</small></div>
      <button className="quiet-button" disabled={busy} onClick={() => void run(() => command({ target: "background", type: "SCAN_NOW" }))}>Scan now</button>
    </div>

    <Section title="Extension mode">
      <div className="extension-setting-row">
        <div><strong>Connection mode</strong><small>Manual only runs when you switch it on. Auto detects One Block regardless of lobby.</small></div>
        <div className="segmented">
          <button className={settings.mode === "manual" ? "active" : ""} onClick={() => void patch({ mode: "manual" })}>Manual</button>
          <button className={settings.mode === "auto" ? "active" : ""} onClick={() => void patch({ mode: "auto" })}>Auto</button>
        </div>
      </div>
      {settings.mode === "manual" && <label className="switch-row"><span><strong>Extension enabled</strong><small>Off means no debugger connection, OCR, or automated input. Turn it on before Scan now.</small></span><input type="checkbox" checked={settings.manualEnabled} onChange={event => void patch({ manualEnabled: event.target.checked })} /></label>}
      {settings.mode === "auto" && <div className="mode-note">Auto detection is enabled. The extension connects when it sees <span className="mono">bloxd.io/play/oneBlock</span>; the <span className="mono">?lobby=</span> value does not affect detection.</div>}
    </Section>

    <div className="metric-strip extension-metrics">
      <Metric label="Blocks mined" value={status.blocksMined === undefined ? "—" : formatInteger(status.blocksMined)} />
      <Metric label="Rolling speed" value={formatRate(status.rollingBps)} suffix=" b/s" />
      <Metric label="Phase" value={status.phase || "—"} />
      <Metric label="Chopping" value={skillLabel(status.choppingSkill)} />
    </div>

    <div className="two-col">
      <Section title="Run capture">
        <div className="run-capture-state">
          <span>{status.sessionActive ? "RUNNING" : "READY"}</span>
          <strong>{status.sessionActive ? elapsed(status.sessionStartedAt) : "No active session"}</strong>
          {status.sessionActive && <small>{counterDelta === undefined ? "Waiting for counter sample" : `${formatInteger(counterDelta)} blocks since start`}</small>}
        </div>
        {!status.sessionActive ? <>
          <label className="field"><span>Run type</span><select value={miningType} onChange={event => setMiningType(event.target.value as MiningType)}><option value="active">Active</option><option value="afk">AFK</option></select></label>
          <button className="primary-button full" disabled={busy || !status.connected} onClick={() => void run(() => command({ target: "background", type: "START_SESSION", miningType }))}>Start run + capture sidebar</button>
        </> : <button className="primary-button full" disabled={busy || !status.connected} onClick={() => void finishSession()}>Finish run + capture sidebar</button>}
        <p className="microcopy">A complete right-sidebar OCR snapshot, including raw recognized text, is stored before and after extension-recorded runs. If the final read fails, the run stays active so you can recalibrate and retry. Raw snapshots stay local and are not sent to community statistics.</p>
      </Section>

      <Section title="Chopping boost">
        <div className="boost-state"><Badge tone={skillTone(status.choppingSkill)}>{skillLabel(status.choppingSkill)}</Badge><span>{settings.autoBoost ? "Automation on" : "Automation off"}</span></div>
        <label className="switch-row compact-switch"><span><strong>Auto-use Chopping skill</strong><small>Chopping Ready → E ×5 → wait 3s → verify. If still Ready, one backup E ×3 burst is sent. Neighboring Digging/Gold Ready states cannot trigger E.</small></span><input type="checkbox" checked={settings.autoBoost} onChange={event => void patch({ autoBoost: event.target.checked })} /></label>
        <label className="switch-row compact-switch"><span><strong>Live counter OCR</strong><small>Samples only the Blocks mined region for rolling speed.</small></span><input type="checkbox" checked={settings.liveCounter} onChange={event => void patch({ liveCounter: event.target.checked })} /></label>
        <div className="mode-note"><strong>Watcher:</strong> {settings.autoBoost ? (status.boostFault ? "Paused by fault" : status.choppingSkill.state === "unknown" ? "Waiting for clear Chopping OCR; auto-rechecking" : `Armed · ${skillLabel(status.choppingSkill)}`) : "Off"}</div>
        <button className="quiet-button" disabled={busy || !status.connected || settings.autoBoost} onClick={() => void run(() => command({ target: "background", type: "TEST_E" }))}>Test E ×5</button>
        <p className="microcopy">Input diagnostic only: turn Auto-use Chopping skill off, stand in-game with the skill Ready, then press Test E ×5. The Action Log records the focus attempt and every E press individually.</p>
      </Section>
    </div>

    <Section title="Current sidebar read">
      <div className="section-inline-action">
        <button className="quiet-button" disabled={busy || !status.connected} onClick={() => void run(() => command({ target: "background", type: "REFRESH_FULL" }))}>Refresh full panel</button>
        <button className="quiet-button" disabled={busy || !status.connected} onClick={() => void run(() => command({ target: "background", type: "RECALIBRATE_OCR" }))}>Recalibrate OCR</button>
      </div>
      <div className="sidebar-read-grid">
        <div><span>Banner</span><strong>{snapshot?.banner || "—"}</strong></div>
        <div><span>Owner</span><strong>{snapshot?.owner || "—"}</strong></div>
        <div><span>Phase</span><strong>{snapshot?.phase || "—"}</strong></div>
        <div><span>Mining</span><strong>{snapshot?.mining?.level ?? "—"} · {skillLabel(snapshot?.mining?.skill)}</strong></div>
        <div><span>Digging</span><strong>{snapshot?.digging?.level ?? "—"} · {skillLabel(snapshot?.digging?.skill)}</strong></div>
        <div><span>Chopping</span><strong>{snapshot?.chopping?.level ?? "—"} · {skillLabel(snapshot?.chopping?.skill)}</strong></div>
        <div><span>Farming</span><strong>{snapshot?.farmingLevel ?? "—"}</strong></div>
        <div><span>Gold</span><strong>{snapshot?.goldPercent === undefined ? "—" : `${snapshot.goldPercent}%`} · {skillLabel(snapshot?.goldSkill)}</strong></div>
      </div>
      {snapshot?.daily && <div className="mode-note"><strong>Daily:</strong> {snapshot.daily}</div>}
      <details className="raw-ocr"><summary>Raw OCR text</summary><pre>{snapshot?.rawText || "No full-panel read yet."}</pre></details>
    </Section>

    <Section title="Performance / timing">
      <div className="advanced-grid">
        <label className="field"><span>Counter interval (s)</span><input type="number" min="5" max="60" value={settings.counterIntervalSec} onChange={event => void patch({ counterIntervalSec: Number(event.target.value) })} /></label>
        <label className="field"><span>Verify after E (s)</span><input type="number" min="1" max="10" step="0.5" value={settings.verifyAfterPressSec} onChange={event => void patch({ verifyAfterPressSec: Number(event.target.value) })} /></label>
        <label className="field"><span>Active check (s)</span><input type="number" min="0.75" max="5" step="0.25" value={settings.activeCheckSec} onChange={event => void patch({ activeCheckSec: Number(event.target.value) })} /></label>
        <label className="field"><span>Cooldown safety (s)</span><input type="number" min="0" max="10" step="0.5" value={settings.cooldownSafetySec} onChange={event => void patch({ cooldownSafetySec: Number(event.target.value) })} /></label>
        <label className="field"><span>Not-ready recheck (s)</span><input type="number" min="1" max="10" step="0.5" value={settings.readyRetrySec} onChange={event => void patch({ readyRetrySec: Number(event.target.value) })} /></label>
        <label className="field"><span>E double-tap gap (ms)</span><input type="number" min="75" max="600" step="25" value={settings.doubleTapGapMs} onChange={event => void patch({ doubleTapGapMs: Number(event.target.value) })} /></label>
      </div>
      <p className="microcopy">The boost watcher does not OCR each countdown second. After reading a cooldown such as 157s, it schedules its next boost check for 157s + the safety delay.</p>
    </Section>

    <div className="floating-action-log">
      <div className="floating-action-log-head"><strong>Action Log</strong><span>LIVE · newest first</span></div>
      <div className="floating-action-log-body">{status.diagnostics.length ? status.diagnostics.slice(0, 40).map((entry, index) => <div key={`action-${entry.at}-${index}`} className={entry.level}><time>{new Date(entry.at).toLocaleTimeString()}</time><span>{entry.message}</span></div>) : <span className="muted-text">Waiting for extension actions…</span>}</div>
    </div>

    <Section title="Diagnostics">
      <div className="diagnostic-strip">
        <span>Last OCR <strong>{status.lastOcrMs === undefined ? "—" : `${status.lastOcrMs} ms`}</strong></span>
        <span>OCR confidence <strong>{status.lastOcrConfidence === undefined ? "—" : `${status.lastOcrConfidence.toFixed(0)}%`}</strong></span>
        <span>Reads/min <strong>{status.readsLastMinute}</strong></span>
        <span>Crop <strong>{status.ocrProfile || "un-calibrated"}</strong></span>
        <span>Viewport <strong>{status.viewportWidth && status.viewportHeight ? `${Math.round(status.viewportWidth)}×${Math.round(status.viewportHeight)}` : "—"}</strong></span>
      </div>
      <div className="diagnostic-log">{status.diagnostics.length ? status.diagnostics.slice(0, 24).map((entry, index) => <div key={`${entry.at}-${index}`} className={entry.level}><time>{new Date(entry.at).toLocaleTimeString()}</time><span>{entry.message}</span></div>) : <span className="muted-text">No diagnostic events yet.</span>}</div>
      <button className="quiet-button danger" onClick={() => void run(() => command({ target: "background", type: "EMERGENCY_STOP" }))}>Emergency stop</button>
    </Section>
  </>;
}
