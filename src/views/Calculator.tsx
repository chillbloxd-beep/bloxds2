import { useMemo, useState } from "react";
import type { AppSettings, MiningSession, MiningType } from "../types";
import { BLOXD_PHASES } from "../data/bloxd";
import { blocksForDuration, buildPrediction, durationForBlocks, formatDuration, formatInteger } from "../lib/math";
import { PageHead } from "../components/UI";

type Mode="blocksToTime"|"counter"|"timeToBlocks"|"sleep";

export function Calculator({sessions,settings}:{sessions:MiningSession[];settings:AppSettings}) {
  const [mode,setMode]=useState<Mode>("blocksToTime");
  const [blocks,setBlocks]=useState(50000);
  const [current,setCurrent]=useState(1569771);
  const [target,setTarget]=useState(2000000);
  const [hours,setHours]=useState(8);
  const [phase,setPhase]=useState("Dungeon");
  const [type,setType]=useState<MiningType>("afk");

  const prediction=useMemo(()=>buildPrediction(sessions,{phase,miningType:type}),[sessions,phase,type]);
  const manual=settings.manualBaseline && settings.manualBaseline>0 ? settings.manualBaseline : null;
  const fallback=prediction?.rate ?? manual;
  const low=prediction?.low ?? manual;
  const high=prediction?.high ?? manual;

  const targetBlocks=mode==="counter"?Math.max(0,target-current):blocks;
  const resultMs=fallback?durationForBlocks(targetBlocks,fallback):null;
  const resultBlocks=fallback?blocksForDuration(hours*3600000,fallback):null;

  return <>
    <PageHead eyebrow="PREDICTION" title="Calculator" subtitle="Predictions prefer your comparable recorded runs. No universal mining speed is assumed." />
    <div className="tabs">
      <button className={mode==="blocksToTime"?"active":""} onClick={()=>setMode("blocksToTime")}>Blocks → time</button>
      <button className={mode==="counter"?"active":""} onClick={()=>setMode("counter")}>Counter target</button>
      <button className={mode==="timeToBlocks"?"active":""} onClick={()=>setMode("timeToBlocks")}>Time → blocks</button>
      <button className={mode==="sleep"?"active":""} onClick={()=>setMode("sleep")}>Sleep / AFK</button>
    </div>

    <div className="form-layout">
      <section className="form-panel">
        <div className="form-grid two">
          <label>Phase<select value={phase} onChange={e=>setPhase(e.target.value)}>{BLOXD_PHASES.map(p=><option key={p}>{p}</option>)}</select></label>
          <label>Session type<select value={type} onChange={e=>setType(e.target.value as MiningType)}><option value="active">Active</option><option value="afk">AFK</option></select></label>
        </div>

        {mode==="blocksToTime" && <label>Blocks to mine<input className="big-input" type="number" min="1" value={blocks} onChange={e=>setBlocks(Number(e.target.value))}/></label>}
        {mode==="counter" && <div className="form-grid two"><label>Current counter<input type="number" value={current} onChange={e=>setCurrent(Number(e.target.value))}/></label><label>Target counter<input type="number" value={target} onChange={e=>setTarget(Number(e.target.value))}/></label></div>}
        {(mode==="timeToBlocks"||mode==="sleep") && <label>{mode==="sleep"?"AFK duration":"Available time"}<div className="input-suffix"><input className="big-input" type="number" min=".01" step=".5" value={hours} onChange={e=>setHours(Number(e.target.value))}/><span>hours</span></div></label>}

        {!fallback && <div className="callout warn"><strong>No personal prediction data yet.</strong><p>Log sessions or set a manual baseline in Settings. The calculator will not silently assume another player's speed.</p></div>}
      </section>

      <aside className="result-panel">
        <span>{mode==="timeToBlocks"||mode==="sleep"?"EXPECTED OUTPUT":"ESTIMATED COMPLETION"}</span>
        {fallback ? (mode==="timeToBlocks"||mode==="sleep" ? <>
          <strong className="preview-rate">{formatInteger(resultBlocks??0)}</strong><b>blocks</b>
          <div className="preview-list">
            <div><span>Likely range</span><strong>{low&&high?`${formatInteger(blocksForDuration(hours*3600000,low))} – ${formatInteger(blocksForDuration(hours*3600000,high))}`:"—"}</strong></div>
            <div><span>Planning rate</span><strong>{fallback.toFixed(3)} b/s</strong></div>
          </div>
        </> : <>
          <strong className="preview-rate">{formatDuration(resultMs??0)}</strong><b>{formatInteger(targetBlocks)} blocks</b>
          <div className="preview-list">
            <div><span>Likely range</span><strong>{low&&high?`${formatDuration(durationForBlocks(targetBlocks,high))} – ${formatDuration(durationForBlocks(targetBlocks,low))}`:"—"}</strong></div>
            <div><span>Planning rate</span><strong>{fallback.toFixed(3)} b/s</strong></div>
          </div>
        </>) : <div className="preview-empty">Waiting for your first measurement.</div>}
        {prediction && <div className="source-note"><span>SOURCE</span><strong>{prediction.source}</strong><p>{prediction.sampleSize} recorded run{prediction.sampleSize===1?"":"s"} · median planning rate with interquartile range.</p></div>}
        {!prediction && manual && <div className="source-note"><span>SOURCE</span><strong>Manual baseline</strong><p>Set in Settings. No statistical range is available yet.</p></div>}
      </aside>
    </div>
  </>;
}
