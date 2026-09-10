import { useState } from "react";
import type { AppSettings, Goal, MiningSession } from "../types";
import { storage } from "../lib/storage";
import { PageHead, Section } from "../components/UI";

export function Settings({sessions,goals,settings,onSettings,onImported,exportPayload}:{sessions:MiningSession[];goals:Goal[];settings:AppSettings;onSettings:(s:AppSettings)=>Promise<void>;onImported:()=>Promise<void>;exportPayload:()=>unknown}) {
  const [baseline,setBaseline]=useState(settings.manualBaseline?.toString()??"");
  const [status,setStatus]=useState("");
  async function save() {
    const n=Number(baseline);
    await onSettings({...settings,manualBaseline:Number.isFinite(n)&&n>0?n:undefined});
    setStatus("Settings saved.");
  }
  function download() {
    const blob=new Blob([JSON.stringify(exportPayload(),null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="oneblock-analytics-backup.json"; a.click(); URL.revokeObjectURL(url);
  }
  async function importFile(file:File) {
    const data=JSON.parse(await file.text());
    if(data?.format!=="oneblock-analytics-backup"||data?.version!==1) throw new Error("Unsupported backup.");
    for(const s of data.sessions??[]) await storage.saveSession(s);
    for(const g of data.goals??[]) await storage.saveGoal(g);
    if(data.settings) await storage.saveSettings(data.settings);
    await onImported(); setStatus("Backup imported.");
  }
  return <>
    <PageHead eyebrow="PRODUCT" title="Settings" subtitle="Local data, prediction fallback and privacy defaults." />
    <div className="two-col">
      <Section title="Prediction fallback" caption="Used only when there are no suitable recorded sessions.">
        <label>Manual baseline (blocks / second)<input type="number" min=".001" step=".001" value={baseline} onChange={e=>setBaseline(e.target.value)} placeholder="No baseline"/></label>
        <p className="helper">The site never assumes the demo 2.690 rate is yours.</p>
        <button className="primary-button" onClick={save}>Save baseline</button>
      </Section>
      <Section title="Community privacy">
        <label className="check-row"><input type="checkbox" checked={settings.defaultCommunityOptIn} onChange={e=>onSettings({...settings,defaultCommunityOptIn:e.target.checked})}/><span><b>Default new runs to community opt-in</b><small>Individual runs can still be changed before saving.</small></span></label>
        <p className="helper">Community submissions contain counters, duration and selected run metadata. This build does not upload video.</p>
      </Section>
    </div>
    <Section title="Backup & portability">
      <div className="button-row"><button className="secondary-button" onClick={download}>Export JSON backup</button><label className="file-button">Import backup<input type="file" accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f) importFile(f).catch(err=>setStatus(err.message))}}/></label></div>
      <p className="helper">{sessions.length} sessions · {goals.length} goals stored locally in IndexedDB.</p>
    </Section>
    <Section title="Appearance">
      <div className="button-row"><button className={settings.theme==="light"?"secondary-button selected":"secondary-button"} onClick={()=>onSettings({...settings,theme:"light"})}>Light</button><button className={settings.theme==="dark"?"secondary-button selected":"secondary-button"} onClick={()=>onSettings({...settings,theme:"dark"})}>Dark</button></div>
    </Section>
    {status&&<div className="status-line">{status}</div>}
  </>;
}
