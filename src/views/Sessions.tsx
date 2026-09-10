import { Fragment, useMemo, useState } from "react";
import type { MiningSession } from "../types";
import { formatDuration, formatInteger } from "../lib/math";
import { Badge, PageHead } from "../components/UI";

export function Sessions({sessions,onDelete}:{sessions:MiningSession[];onDelete:(id:string)=>Promise<void>}) {
  const [type,setType]=useState("all");
  const [phase,setPhase]=useState("all");
  const [status,setStatus]=useState("");
  const [expanded,setExpanded]=useState<string | null>(null);
  const phases=[...new Set(sessions.map(s=>s.phase))];
  const filtered=useMemo(()=>sessions.filter(s=>(type==="all"||s.miningType===type)&&(phase==="all"||s.phase===phase)),[sessions,type,phase]);

  async function removeRun(session: MiningSession) {
    const message=session.communityOptIn&&session.cloudStatus==="synced"
      ? "Delete this session locally and withdraw its anonymous community record?"
      : "Delete this local session?";
    if(!confirm(message)) return;
    setStatus("");
    try {
      await onDelete(session.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete the session. Nothing was removed locally.");
    }
  }

  return <>
    <PageHead eyebrow="HISTORY" title="Sessions" subtitle="Every saved run keeps its raw counters and elapsed time. Extension runs can also keep full before/after sidebar OCR snapshots." />
    <div className="filter-row">
      <select value={type} onChange={e=>setType(e.target.value)}><option value="all">All run types</option><option value="active">Active</option><option value="afk">AFK</option></select>
      <select value={phase} onChange={e=>setPhase(e.target.value)}><option value="all">All phases</option>{phases.map(p=><option key={p}>{p}</option>)}</select>
      <span>{filtered.length} run{filtered.length===1?"":"s"}</span>
    </div>

    {status && <div className="callout warn"><strong>Session not deleted.</strong><p>{status}</p></div>}

    <div className="table-shell">
      <table className="data-table">
        <thead><tr><th>Date</th><th>Phase</th><th>Type</th><th className="num">Blocks</th><th className="num">Duration</th><th className="num">Rate</th><th>Cloud</th><th/></tr></thead>
        <tbody>{filtered.map(s=><Fragment key={s.id}>
          <tr>
            <td><strong>{new Date(s.createdAt).toLocaleDateString()}</strong><small>{new Date(s.createdAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</small></td>
            <td>{s.phase}</td><td><Badge>{s.miningType}</Badge></td>
            <td className="num mono">{formatInteger(s.blocksMined)}</td>
            <td className="num mono">{formatDuration(s.durationMs,true)}</td>
            <td className="num mono"><strong>{s.averageBps.toFixed(5)}</strong><small>b/s</small></td>
            <td>{s.communityOptIn?<Badge tone={s.cloudStatus==="synced"?"good":s.cloudStatus==="failed"?"warn":"neutral"}>{s.cloudStatus??"local"}</Badge>:<span className="muted-text">Private</span>}</td>
            <td><div className="row-actions">{(s.sidebarBefore||s.sidebarAfter||s.boostStats)&&<button className="quiet-button" onClick={()=>setExpanded(expanded===s.id?null:s.id)}>{expanded===s.id?"Hide":"Details"}</button>}<button className="quiet-button danger" onClick={()=>void removeRun(s)}>Delete</button></div></td>
          </tr>
          {expanded===s.id && <tr className="session-detail-row"><td colSpan={8}>
            <div className="session-detail-meta">
              <span><b>Source</b> {s.source}</span>
              {s.lobby&&<span><b>Lobby</b> {s.lobby}</span>}
              {s.extensionConnectionMode&&<span><b>Extension mode</b> {s.extensionConnectionMode}</span>}
              {s.boostStats&&<span><b>Boosts</b> {s.boostStats.successfulActivations} successful · {s.boostStats.activationRetries} retries · {s.boostStats.failedActivations} failed</span>}
            </div>
            {(s.sidebarBefore||s.sidebarAfter)&&<div className="snapshot-grid">
              <div><h4>Sidebar before run</h4><pre>{s.sidebarBefore?.rawText||"No snapshot"}</pre></div>
              <div><h4>Sidebar after run</h4><pre>{s.sidebarAfter?.rawText||"No snapshot"}</pre></div>
            </div>}
          </td></tr>}
        </Fragment>)}</tbody>
      </table>
      {!filtered.length && <div className="empty-table">No sessions match these filters.</div>}
    </div>
  </>;
}
