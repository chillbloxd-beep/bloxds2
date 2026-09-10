import { useEffect, useState } from "react";
import type { CommunitySummary, MiningSession } from "../types";
import { BLOXD_PHASES } from "../data/bloxd";
import { fetchCommunitySummary } from "../lib/api";
import { formatDuration, formatInteger, formatRate } from "../lib/math";
import { Metric, PageHead, Section } from "../components/UI";

export function Community({sessions}:{sessions:MiningSession[]}) {
  const [phase,setPhase]=useState("");
  const [type,setType]=useState("");
  const [bucket,setBucket]=useState("");
  const [data,setData]=useState<CommunitySummary|null>(null);
  const [state,setState]=useState<"loading"|"ready"|"error">("loading");

  useEffect(()=>{
    let live=true; setState("loading");
    fetchCommunitySummary({game:"bloxd",phase:phase||undefined,miningType:type||undefined,durationBucket:bucket||undefined})
      .then(d=>{if(live){setData(d);setState("ready")}})
      .catch(()=>{if(live){setData(null);setState("error")}});
    return()=>{live=false};
  },[phase,type,bucket]);

  return <>
    <PageHead eyebrow="ANONYMOUS AGGREGATES" title="Community" subtitle="Comparable run statistics from players who explicitly opt in. No videos are stored." />
    <div className="filter-row">
      <select value={phase} onChange={e=>setPhase(e.target.value)}><option value="">All phases</option>{BLOXD_PHASES.map(p=><option key={p}>{p}</option>)}</select>
      <select value={type} onChange={e=>setType(e.target.value)}><option value="">Active + AFK</option><option value="active">Active only</option><option value="afk">AFK only</option></select>
      <select value={bucket} onChange={e=>setBucket(e.target.value)}><option value="">All durations</option>{["<5m","5–15m","15–30m","30–60m","1–3h","3–6h","6h+"].map(b=><option key={b}>{b}</option>)}</select>
    </div>

    {state==="error" && <div className="callout"><strong>Community cloud is not connected in this build environment.</strong><p>Personal/local features still work. Deploy the included Cloudflare Worker + D1 migration to activate shared averages.</p></div>}
    {state==="loading" && <div className="loading-line">Loading community aggregate…</div>}
    {state==="ready" && data && <>
      <div className="community-headline">
        <div><span>COMBINED THROUGHPUT</span><strong>{formatRate(data.combinedThroughput)}</strong><b>blocks / second</b></div>
        <div className="community-sample"><span>{formatInteger(data.runs)} runs</span><span>{formatInteger(data.players)} contributors</span><span>{formatInteger(data.totalBlocks)} blocks</span></div>
      </div>
      <div className="metric-strip">
        <Metric label="Median run" value={formatRate(data.medianSessionRate)} suffix=" b/s"/>
        <Metric label="Mean run" value={formatRate(data.meanSessionRate)} suffix=" b/s"/>
        <Metric label="P25 – P75" value={data.p25!=null&&data.p75!=null?`${data.p25.toFixed(3)} – ${data.p75.toFixed(3)}`:"—"} suffix=" b/s"/>
        <Metric label="Measured time" value={formatDuration(data.totalDurationMs)}/>
      </div>
      <div className="two-col">
        <Section title="Full-run statistics">
          <div className="definition-list">
            <div><span>Average blocks / run</span><strong>{data.averageBlocksPerRun==null?"—":formatInteger(data.averageBlocksPerRun)}</strong></div>
            <div><span>Median blocks / run</span><strong>{data.medianBlocksPerRun==null?"—":formatInteger(data.medianBlocksPerRun)}</strong></div>
            <div><span>Average duration</span><strong>{data.averageDurationMs==null?"—":formatDuration(data.averageDurationMs)}</strong></div>
            <div><span>Median duration</span><strong>{data.medianDurationMs==null?"—":formatDuration(data.medianDurationMs)}</strong></div>
          </div>
        </Section>
        <Section title="Distribution">
          <div className="definition-list">
            <div><span>10th percentile</span><strong>{formatRate(data.p10)} b/s</strong></div>
            <div><span>25th percentile</span><strong>{formatRate(data.p25)} b/s</strong></div>
            <div><span>75th percentile</span><strong>{formatRate(data.p75)} b/s</strong></div>
            <div><span>90th percentile</span><strong>{formatRate(data.p90)} b/s</strong></div>
            <div><span>Excluded statistical outliers</span><strong>{formatInteger(data.excludedOutliers)}</strong></div>
          </div>
        </Section>
      </div>
    </>}
    <div className="privacy-note">Your local runs: {sessions.length}. Community statistics only use runs explicitly submitted with community opt-in.</div>
  </>;
}
