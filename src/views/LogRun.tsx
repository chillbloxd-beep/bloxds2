import { useEffect, useState } from "react";
import type { AppSettings, MiningSession, MiningType, SessionSource } from "../types";
import { BLOXD_GAME_DATA_VERSION, BLOXD_PHASES } from "../data/bloxd";
import { blocksBetween, bps, blocksPerHour, formatDuration, formatInteger, parseDurationParts } from "../lib/math";
import { Badge, PageHead } from "../components/UI";

type Mode = "completed" | "live" | "afk";

const ACTIVE_KEY = "oneblock.activeRun";

type ActiveRun = {
  mode: "live" | "afk";
  startCounter: number;
  startedAtMs: number;
  phase: string;
  miningType: MiningType;
};

export function LogRun({ sessions: _sessions, settings, onSave }: {
  sessions: MiningSession[];
  settings: AppSettings;
  onSave: (s: MiningSession)=>Promise<void>;
}) {
  const [mode,setMode]=useState<Mode>("completed");
  const [phase,setPhase]=useState("Dungeon");
  const [miningType,setMiningType]=useState<MiningType>("active");
  const [start,setStart]=useState(1563711);
  const [end,setEnd]=useState(1569771);
  const [h,setH]=useState(0), [m,setM]=useState(37), [sec,setSec]=useState(32.569);
  const [community,setCommunity]=useState(settings.defaultCommunityOptIn);
  const [tool,setTool]=useState("");
  const [breakSpeed,setBreakSpeed]=useState("");
  const [momentum,setMomentum]=useState("");
  const [device,setDevice]=useState("");
  const [notes,setNotes]=useState("");
  const [active,setActive]=useState<ActiveRun|null>(null);
  const [now,setNow]=useState(Date.now());
  const [status,setStatus]=useState("");

  useEffect(()=>{
    const raw=localStorage.getItem(ACTIVE_KEY);
    if(raw) {
      try { setActive(JSON.parse(raw)); } catch {}
    }
  },[]);

  useEffect(()=>{
    if(!active) return;
    const id=setInterval(()=>setNow(Date.now()),1000);
    return ()=>clearInterval(id);
  },[active]);

  const durationMs=parseDurationParts(h,m,sec);
  const blocks=blocksBetween(start,end);
  const rate=bps(blocks,durationMs);

  async function saveManual() {
    if(end<=start || durationMs<=0) { setStatus("Enter an end counter above the start counter and a positive duration."); return; }
    const session=makeSession("manual", miningType, start, end, durationMs);
    await onSave(session);
    setStatus(`Saved ${formatInteger(session.blocksMined)} blocks at ${session.averageBps.toFixed(5)} b/s.`);
  }

  function makeSession(source: SessionSource, type: MiningType, a:number,b:number,ms:number, startedAt?: string): MiningSession {
    const blocks=blocksBetween(a,b);
    return {
      id: crypto.randomUUID(),
      game:"bloxd",
      gameDataVersion:BLOXD_GAME_DATA_VERSION,
      phase, miningType:type, startCounter:a, endCounter:b, blocksMined:blocks,
      durationMs:ms, averageBps:bps(blocks,ms), source, startedAt,
      createdAt:new Date().toISOString(), tool:tool||undefined, breakSpeed:breakSpeed||undefined,
      momentum:momentum||undefined, device:device||undefined, notes:notes||undefined,
      communityOptIn:community, cloudStatus:"local"
    };
  }

  function startTimer(kind:"live"|"afk") {
    const record: ActiveRun={mode:kind,startCounter:start,startedAtMs:Date.now(),phase,miningType:kind==="afk"?"afk":"active"};
    setActive(record); setNow(Date.now()); localStorage.setItem(ACTIVE_KEY,JSON.stringify(record));
    setStatus(`${kind==="afk"?"AFK":"Live"} run started. The absolute start time is saved locally.`);
  }

  async function finishTimer() {
    if(!active) return;
    if(end<=active.startCounter) { setStatus("End counter must be higher than the saved start counter."); return; }
    const ms=Date.now()-active.startedAtMs;
    const session: MiningSession={
      ...makeSession(active.mode==="afk"?"afk_timer":"live_timer", active.miningType, active.startCounter,end,ms,new Date(active.startedAtMs).toISOString()),
      phase:active.phase
    };
    await onSave(session);
    localStorage.removeItem(ACTIVE_KEY); setActive(null);
    setStatus(`Run finished: ${formatInteger(session.blocksMined)} blocks · ${formatDuration(ms)} · ${session.averageBps.toFixed(5)} b/s.`);
  }

  return <>
    <PageHead eyebrow="MEASUREMENT" title="Log a run" subtitle="Save complete sessions as counters + elapsed time. Derived rates are calculated automatically." />
    <div className="tabs">
      <button className={mode==="completed"?"active":""} onClick={()=>setMode("completed")}>Completed run</button>
      <button className={mode==="live"?"active":""} onClick={()=>setMode("live")}>Live run</button>
      <button className={mode==="afk"?"active":""} onClick={()=>setMode("afk")}>AFK / sleep</button>
    </div>

    <div className="form-layout">
      <section className="form-panel">
        <div className="form-grid two">
          <label>Game<select value="bloxd" disabled><option>Bloxd.io · One Block</option></select></label>
          <label>Phase<select value={phase} onChange={e=>setPhase(e.target.value)}>{BLOXD_PHASES.map(p=><option key={p}>{p}</option>)}</select></label>
        </div>

        {mode==="completed" && <>
          <div className="form-grid two">
            <label>Mining type<select value={miningType} onChange={e=>setMiningType(e.target.value as MiningType)}><option value="active">Active</option><option value="afk">AFK</option></select></label>
            <div/>
          </div>
          <div className="form-grid two">
            <label>Start counter<input type="number" value={start} onChange={e=>setStart(Number(e.target.value))}/></label>
            <label>End counter<input type="number" value={end} onChange={e=>setEnd(Number(e.target.value))}/></label>
          </div>
          <label>Elapsed time</label>
          <div className="duration-input">
            <input type="number" min="0" value={h} onChange={e=>setH(Number(e.target.value))}/><span>h</span>
            <input type="number" min="0" value={m} onChange={e=>setM(Number(e.target.value))}/><span>m</span>
            <input type="number" min="0" step=".001" value={sec} onChange={e=>setSec(Number(e.target.value))}/><span>s</span>
          </div>
        </>}

        {(mode==="live"||mode==="afk") && <>
          {!active ? <label>Starting counter<input type="number" value={start} onChange={e=>setStart(Number(e.target.value))}/></label> :
          <div className="active-run-strip"><div><span>RUNNING</span><strong>{formatDuration(now-active.startedAtMs)}</strong></div><div><span>START COUNTER</span><strong>{formatInteger(active.startCounter)}</strong></div></div>}
          {active && <label>Current / ending counter<input type="number" value={end} onChange={e=>setEnd(Number(e.target.value))}/></label>}
        </>}

        <details className="advanced-fields">
          <summary>Optional run metadata</summary>
          <div className="form-grid two">
            <label>Tool<input value={tool} onChange={e=>setTool(e.target.value)} placeholder="e.g. Moonstone Pickaxe"/></label>
            <label>Device<input value={device} onChange={e=>setDevice(e.target.value)} placeholder="e.g. Chromebook"/></label>
            <label>Break Speed<input value={breakSpeed} onChange={e=>setBreakSpeed(e.target.value)} placeholder="optional"/></label>
            <label>Momentum<input value={momentum} onChange={e=>setMomentum(e.target.value)} placeholder="optional"/></label>
          </div>
          <label>Notes<textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Anything that may have affected the run."/></label>
        </details>

        <label className="check-row"><input type="checkbox" checked={community} onChange={e=>setCommunity(e.target.checked)}/><span><b>Include anonymously in community statistics</b><small>Only numerical run data and selected metadata are submitted. No video.</small></span></label>

        {mode==="completed" ? <button className="primary-button wide" onClick={saveManual}>Save run</button> :
          !active ? <button className="primary-button wide" onClick={()=>startTimer(mode)}>Start {mode==="afk"?"AFK":"live"} run</button> :
          <button className="primary-button wide" onClick={finishTimer}>Finish run</button>}
        {status && <div className="status-line">{status}</div>}
      </section>

      <aside className="result-panel">
        <span>MEASUREMENT PREVIEW</span>
        {mode==="completed" ? <>
          <strong className="preview-rate">{rate>0?rate.toFixed(5):"—"}</strong><b>blocks / second</b>
          <div className="preview-list">
            <div><span>Blocks mined</span><strong>{formatInteger(blocks)}</strong></div>
            <div><span>Duration</span><strong>{formatDuration(durationMs,true)}</strong></div>
            <div><span>Blocks / minute</span><strong>{rate>0?(rate*60).toFixed(2):"—"}</strong></div>
            <div><span>Blocks / hour</span><strong>{rate>0?formatInteger(blocksPerHour(rate)):"—"}</strong></div>
          </div>
        </> : active ? <>
          <strong className="preview-rate">{formatDuration(now-active.startedAtMs)}</strong><b>elapsed wall time</b>
          <div className="preview-list"><div><span>Mode</span><strong>{active.mode==="afk"?"AFK":"Active"}</strong></div><div><span>Phase</span><strong>{active.phase}</strong></div></div>
        </> : <div className="preview-empty">Start a timer to record elapsed wall-clock time even if the tab is backgrounded.</div>}
        <div className="quality-note"><Badge>Local-first</Badge><p>Raw counters and elapsed time remain the source values. Rates are derived, never manually trusted.</p></div>
      </aside>
    </div>
  </>;
}
