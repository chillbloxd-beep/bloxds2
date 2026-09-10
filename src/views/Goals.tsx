import { useState } from "react";
import type { Goal, MiningSession } from "../types";
import { buildPrediction, durationForBlocks, formatDuration, formatInteger } from "../lib/math";
import { PageHead, Section } from "../components/UI";

export function Goals({sessions,goals,onSave,onDelete}:{sessions:MiningSession[];goals:Goal[];onSave:(g:Goal)=>Promise<void>;onDelete:(id:string)=>Promise<void>}) {
  const [name,setName]=useState("10 million blocks");
  const [current,setCurrent]=useState(1569771);
  const [target,setTarget]=useState(10000000);
  const pred=buildPrediction(sessions,{});
  async function add() {
    if(target<=current) return;
    await onSave({id:crypto.randomUUID(),name,currentBlocks:current,targetBlocks:target,createdAt:new Date().toISOString()});
  }
  return <>
    <PageHead eyebrow="PROGRESSION" title="Goals" subtitle="Turn large block targets into measurable remaining work and realistic time requirements." />
    <div className="form-layout">
      <section className="form-panel">
        <label>Goal name<input value={name} onChange={e=>setName(e.target.value)}/></label>
        <div className="form-grid two">
          <label>Current blocks<input type="number" value={current} onChange={e=>setCurrent(Number(e.target.value))}/></label>
          <label>Target blocks<input type="number" value={target} onChange={e=>setTarget(Number(e.target.value))}/></label>
        </div>
        <button className="primary-button wide" onClick={add}>Save goal</button>
      </section>
      <aside className="result-panel">
        <span>REMAINING</span><strong className="preview-rate">{formatInteger(Math.max(0,target-current))}</strong><b>blocks</b>
        {pred && <div className="preview-list"><div><span>At your median rate</span><strong>{formatDuration(durationForBlocks(Math.max(0,target-current),pred.rate))}</strong></div><div><span>Planning rate</span><strong>{pred.rate.toFixed(3)} b/s</strong></div></div>}
      </aside>
    </div>
    <Section title="Saved goals">
      {goals.length ? <div className="goals-list">{goals.map(g=>{
        const remain=Math.max(0,g.targetBlocks-g.currentBlocks), pct=Math.min(100,(g.currentBlocks/g.targetBlocks)*100);
        return <div className="goal-card" key={g.id}><div className="goal-top"><div><strong>{g.name}</strong><span>{formatInteger(g.currentBlocks)} → {formatInteger(g.targetBlocks)}</span></div><button className="quiet-button danger" onClick={()=>onDelete(g.id)}>Delete</button></div><div className="goal-progress"><i style={{width:`${pct}%`}}/></div><div className="goal-bottom"><span>{pct.toFixed(1)}%</span><strong>{formatInteger(remain)} remaining</strong></div></div>;
      })}</div> : <div className="empty-inline">No goals saved yet.</div>}
    </Section>
  </>;
}
