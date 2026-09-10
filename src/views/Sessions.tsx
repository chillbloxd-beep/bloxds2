import { useMemo, useState } from "react";
import type { MiningSession } from "../types";
import { formatDuration, formatInteger } from "../lib/math";
import { Badge, PageHead } from "../components/UI";

export function Sessions({sessions,onDelete}:{sessions:MiningSession[];onDelete:(id:string)=>Promise<void>}) {
  const [type,setType]=useState("all");
  const [phase,setPhase]=useState("all");
  const phases=[...new Set(sessions.map(s=>s.phase))];
  const filtered=useMemo(()=>sessions.filter(s=>(type==="all"||s.miningType===type)&&(phase==="all"||s.phase===phase)),[sessions,type,phase]);

  return <>
    <PageHead eyebrow="HISTORY" title="Sessions" subtitle="Every saved run keeps its raw counters and elapsed time." />
    <div className="filter-row">
      <select value={type} onChange={e=>setType(e.target.value)}><option value="all">All run types</option><option value="active">Active</option><option value="afk">AFK</option></select>
      <select value={phase} onChange={e=>setPhase(e.target.value)}><option value="all">All phases</option>{phases.map(p=><option key={p}>{p}</option>)}</select>
      <span>{filtered.length} run{filtered.length===1?"":"s"}</span>
    </div>

    <div className="table-shell">
      <table className="data-table">
        <thead><tr><th>Date</th><th>Phase</th><th>Type</th><th className="num">Blocks</th><th className="num">Duration</th><th className="num">Rate</th><th>Cloud</th><th/></tr></thead>
        <tbody>{filtered.map(s=><tr key={s.id}>
          <td><strong>{new Date(s.createdAt).toLocaleDateString()}</strong><small>{new Date(s.createdAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</small></td>
          <td>{s.phase}</td><td><Badge>{s.miningType}</Badge></td>
          <td className="num mono">{formatInteger(s.blocksMined)}</td>
          <td className="num mono">{formatDuration(s.durationMs,true)}</td>
          <td className="num mono"><strong>{s.averageBps.toFixed(5)}</strong><small>b/s</small></td>
          <td>{s.communityOptIn?<Badge tone={s.cloudStatus==="synced"?"good":s.cloudStatus==="failed"?"warn":"neutral"}>{s.cloudStatus??"local"}</Badge>:<span className="muted-text">Private</span>}</td>
          <td><button className="quiet-button danger" onClick={()=>{if(confirm("Delete this local session?")) onDelete(s.id)}}>Delete</button></td>
        </tr>)}</tbody>
      </table>
      {!filtered.length && <div className="empty-table">No sessions match these filters.</div>}
    </div>
  </>;
}
