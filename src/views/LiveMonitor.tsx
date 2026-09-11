import { useEffect, useMemo, useState } from "react";
import type { BackgroundCommand, BackgroundResponse, DiagnosticCategory, LiveExtensionStatus, UiStateMessage } from "../extension/types";
import type { SkillStateSnapshot } from "../types";

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

function formatRate6(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "0.00000";
  return value.toPrecision(6);
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const categories: Array<"all" | DiagnosticCategory> = ["all", "chopping", "ocr", "timer", "input", "counter", "session", "system"];

type Density = "mini" | "monitor" | "diagnostic";

export function LiveMonitor() {
  const [status, setStatus] = useState<LiveExtensionStatus | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [density, setDensity] = useState<Density>(() => (localStorage.getItem("oba.monitor.density") as Density) || "mini");
  const [filter, setFilter] = useState<"all" | DiagnosticCategory>("all");

  async function refresh() {
    try {
      const response = await command({ target: "background", type: "GET_STATUS" });
      if (response.status) setStatus(response.status);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  useEffect(() => {
    void refresh();
    const listener = (message: unknown) => {
      const event = message as UiStateMessage;
      if (event?.target === "ui" && event.type === "STATE_UPDATE") setStatus(event.status);
    };
    chrome.runtime.onMessage.addListener(listener);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const healthPoll = window.setInterval(() => void refresh(), 15_000);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      window.clearInterval(clock);
      window.clearInterval(healthPoll);
    };
  }, []);

  function changeDensity(next: Density) {
    setDensity(next);
    localStorage.setItem("oba.monitor.density", next);
  }

  const runBlocks = useMemo(() => {
    if (!status?.sessionActive || status.sessionStartBlocks === undefined || status.blocksMined === undefined) return undefined;
    return Math.max(0, status.blocksMined - status.sessionStartBlocks);
  }, [status?.sessionActive, status?.sessionStartBlocks, status?.blocksMined]);

  const elapsed = status?.sessionStartedAt ? formatDuration(now - new Date(status.sessionStartedAt).getTime()) : "—";
  const predictedLeft = status?.predictedReadyAt === undefined ? undefined : Math.max(0, (status.predictedReadyAt - now) / 1000);
  const lastSyncAge = status?.lastAuthoritativeSyncAt === undefined ? undefined : Math.max(0, (now - status.lastAuthoritativeSyncAt) / 1000);
  const filteredLogs = (status?.diagnostics || []).filter(entry => filter === "all" || entry.category === filter).slice(0, 120);

  async function copyDiagnostics() {
    if (!status) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      status: {
        connected: status.connected,
        lobby: status.lobby,
        phase: status.phase,
        blocksMined: status.blocksMined,
        rollingBps: status.rollingBps,
        choppingSkill: status.choppingSkill,
        powerState: status.powerState,
        health: status.health,
        healthReason: status.healthReason,
        predictedReadyAt: status.predictedReadyAt,
        boostDriftSeconds: status.boostDriftSeconds,
        cooldownUncertaintySec: status.cooldownUncertaintySec,
        lastAuthoritativeSyncAt: status.lastAuthoritativeSyncAt,
        lastRecognitionMethod: status.lastRecognitionMethod,
        lastOcrMs: status.lastOcrMs,
        lastQueueWaitMs: status.lastQueueWaitMs,
        lastCaptureMs: status.lastCaptureMs,
        readyToE1LatencyLastMs: status.readyToE1LatencyLastMs,
        readyToE1LatencyMedianMs: status.readyToE1LatencyMedianMs,
        readyToE1LatencyWorstMs: status.readyToE1LatencyWorstMs,
        rejectedOcrCount: status.rejectedOcrCount,
        successfulActivations: status.successfulActivations,
        activationRetries: status.activationRetries,
        failedActivations: status.failedActivations
      },
      diagnostics: status.diagnostics
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }

  if (!status) {
    return <main className="monitor-root"><div className="monitor-card loading-card">Loading OneBlock state…{error && <small>{error}</small>}</div></main>;
  }

  return <main className={`monitor-root density-${density}`}>
    <header className="monitor-topbar">
      <div>
        <span className={`live-dot ${status.connected ? "online" : ""}`} />
        <strong>ONEBLOCK MONITOR</strong>
      </div>
      <div className="density-switch" aria-label="Monitor density">
        <button className={density === "mini" ? "active" : ""} onClick={() => changeDensity("mini")}>Mini</button>
        <button className={density === "monitor" ? "active" : ""} onClick={() => changeDensity("monitor")}>Monitor</button>
        <button className={density === "diagnostic" ? "active" : ""} onClick={() => changeDensity("diagnostic")}>Diag</button>
      </div>
    </header>

    {error && <div className="monitor-alert">{error}</div>}

    <section className="monitor-card identity-row">
      <span>{status.connected ? `Connected${status.lobby ? ` · Lobby ${status.lobby}` : ""}` : "Disconnected"}</span>
      <span>{status.phase || "Unknown phase"} · {status.settings.mode.toUpperCase()}</span>
    </section>

    <section className={`monitor-card chopping-card state-${status.choppingSkill.state}`}>
      <span className="eyebrow">CHOPPING</span>
      <strong className="chopping-value">{skillLabel(status.choppingSkill)}</strong>
      <div className="chopping-subline">
        <span>{status.settings.autoBoost ? "Automation armed" : "Automation off"}</span>
        <span>{status.powerState.replace("-", " ")}</span>
      </div>
      {predictedLeft !== undefined && <div className="prediction-row"><span>Predicted Ready</span><strong>{predictedLeft.toFixed(1)}s</strong></div>}
    </section>

    <section className="monitor-card metrics-grid primary-metrics">
      <div><span>Blocks mined</span><strong>{status.blocksMined?.toLocaleString() ?? "—"}</strong></div>
      <div><span>Rolling speed</span><strong>{formatRate6(status.rollingBps)} <small>b/s</small></strong></div>
      <div><span>This run</span><strong>{runBlocks?.toLocaleString() ?? "—"}</strong></div>
      <div><span>Elapsed</span><strong>{elapsed}</strong></div>
    </section>

    <section className={`monitor-card health-card health-${status.health}`}>
      <div><span className="eyebrow">SYSTEM HEALTH</span><strong>{status.health.toUpperCase()}</strong></div>
      <small>{status.healthReason || "Runtime state is within configured reliability limits."}</small>
    </section>

    {density !== "mini" && <>
      <section className="monitor-card metrics-grid detail-metrics">
        <div><span>Timer drift</span><strong>{status.boostDriftSeconds === undefined ? "—" : `${status.boostDriftSeconds >= 0 ? "+" : ""}${status.boostDriftSeconds.toFixed(2)}s`}</strong></div>
        <div><span>Uncertainty</span><strong>{status.cooldownUncertaintySec === undefined ? "—" : `±${status.cooldownUncertaintySec.toFixed(2)}s`}</strong></div>
        <div><span>Last real sync</span><strong>{lastSyncAge === undefined ? "—" : `${lastSyncAge.toFixed(1)}s ago`}</strong></div>
        <div><span>Recognizer</span><strong>{status.lastRecognitionMethod || "—"}</strong></div>
        <div><span>OCR latency</span><strong>{status.lastOcrMs === undefined ? "—" : `${status.lastOcrMs}ms`}</strong></div>
        <div><span>Queue / capture</span><strong>{status.lastQueueWaitMs ?? 0} / {status.lastCaptureMs ?? 0}ms</strong></div>
      </section>

      <section className="monitor-card metrics-grid detail-metrics">
        <div><span>Activations</span><strong>{status.successfulActivations}</strong></div>
        <div><span>First try</span><strong>{status.firstTryActivations}</strong></div>
        <div><span>Backup success</span><strong>{status.backupSuccessfulActivations}</strong></div>
        <div><span>Failures</span><strong>{status.failedActivations}</strong></div>
        <div><span>Rejected readings</span><strong>{status.rejectedOcrCount}</strong></div>
        <div><span>Fast matches</span><strong>{status.fastBoostHits ?? 0}</strong></div>
      </section>

      <section className="monitor-card latency-card">
        <div className="section-title"><span>READY → E1</span></div>
        <div className="latency-grid">
          <div><span>Last</span><strong>{status.readyToE1LatencyLastMs === undefined ? "—" : `${status.readyToE1LatencyLastMs}ms`}</strong></div>
          <div><span>Median</span><strong>{status.readyToE1LatencyMedianMs === undefined ? "—" : `${status.readyToE1LatencyMedianMs.toFixed(0)}ms`}</strong></div>
          <div><span>Worst</span><strong>{status.readyToE1LatencyWorstMs === undefined ? "—" : `${status.readyToE1LatencyWorstMs}ms`}</strong></div>
        </div>
      </section>
    </>}

    {density === "diagnostic" && <section className="monitor-card logs-card">
      <div className="section-title log-title">
        <span>DETAILED LOGS</span>
        <select value={filter} onChange={event => setFilter(event.target.value as "all" | DiagnosticCategory)}>
          {categories.map(category => <option key={category} value={category}>{category}</option>)}
        </select>
      </div>
      <div className="monitor-log-list">
        {filteredLogs.length ? filteredLogs.map((entry, index) => <div key={`${entry.at}-${index}`} className={`log-row ${entry.level}`}>
          <time>{new Date(entry.at).toLocaleTimeString([], { hour12: false })}</time>
          <span className="log-category">{entry.category}</span>
          <span className="log-message">{entry.message}</span>
          {entry.details && <small>{Object.entries(entry.details).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${String(value)}`).join(" · ")}</small>}
        </div>) : <div className="empty-log">No matching events yet.</div>}
      </div>
    </section>}

    <footer className="monitor-footer">
      <button onClick={() => void copyDiagnostics()}>Copy diagnostics</button>
      <button className="danger" onClick={() => void command({ target: "background", type: "EMERGENCY_STOP" }).then(response => response.status && setStatus(response.status)).catch(reason => setError(String(reason)))}>Emergency stop</button>
    </footer>
  </main>;
}
