import type { MiningSession } from "../types";
import { durationBucket, formatRate, mean } from "../lib/math";

function bounds(values: number[], fallback = 1) {
  if (!values.length) return { min: 0, max: fallback };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.15, max * 0.03, 0.02);
  return { min: Math.max(0, min - pad), max: max + pad };
}

export function SpeedTrend({ sessions }: { sessions: MiningSession[] }) {
  const data = [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (data.length < 2) return <EmptyChart text="Log at least two sessions to show a trend." />;
  const width = 820, height = 290, l = 52, r = 18, t = 20, b = 36;
  const ys = data.map(d => d.averageBps);
  const yb = bounds(ys);
  const x = (i: number) => l + (i / Math.max(1, data.length - 1)) * (width - l - r);
  const y = (v: number) => t + (1 - (v - yb.min) / (yb.max - yb.min)) * (height - t - b);
  const path = data.map((d, i) => `${i ? "L" : "M"} ${x(i)} ${y(d.averageBps)}`).join(" ");

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Mining speed across sessions">
      {[0, .25, .5, .75, 1].map(p => {
        const yy = t + p * (height - t - b);
        const val = yb.max - p * (yb.max - yb.min);
        return <g key={p}>
          <line className="chart-grid" x1={l} x2={width-r} y1={yy} y2={yy}/>
          <text className="chart-axis" x={l-8} y={yy+4} textAnchor="end">{val.toFixed(2)}</text>
        </g>;
      })}
      <path className="chart-line" d={path}/>
      {data.map((d, i) => <circle key={d.id} className="chart-dot" cx={x(i)} cy={y(d.averageBps)} r="3.5"><title>{`${new Date(d.createdAt).toLocaleDateString()} · ${d.averageBps.toFixed(3)} b/s`}</title></circle>)}
      <text className="chart-axis" x={l} y={height-8}>Older</text>
      <text className="chart-axis" x={width-r} y={height-8} textAnchor="end">Latest</text>
    </svg>
  );
}

export function DurationScatter({ sessions }: { sessions: MiningSession[] }) {
  if (sessions.length < 2) return <EmptyChart text="Log at least two sessions to compare duration and speed." />;
  const width=820, height=290, l=58, r=18, t=18, b=40;
  const xs=sessions.map(s=>s.durationMs/60000), ys=sessions.map(s=>s.averageBps);
  const xb=bounds(xs, 10), yb=bounds(ys, 1);
  const x=(v:number)=>l+((v-xb.min)/(xb.max-xb.min))*(width-l-r);
  const y=(v:number)=>t+(1-(v-yb.min)/(yb.max-yb.min))*(height-t-b);
  return <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Session duration versus mining speed">
    {[0,.25,.5,.75,1].map(p=>{
      const yy=t+p*(height-t-b), val=yb.max-p*(yb.max-yb.min);
      return <g key={p}><line className="chart-grid" x1={l} x2={width-r} y1={yy} y2={yy}/><text className="chart-axis" x={l-8} y={yy+4} textAnchor="end">{val.toFixed(2)}</text></g>;
    })}
    {sessions.map(s=><circle key={s.id} className={`chart-dot ${s.miningType==="afk"?"chart-dot-muted":""}`} cx={x(s.durationMs/60000)} cy={y(s.averageBps)} r="5"><title>{`${Math.round(s.durationMs/60000)} min · ${s.averageBps.toFixed(3)} b/s · ${s.phase}`}</title></circle>)}
    <text className="chart-axis" x={l} y={height-8}>{Math.round(xb.min)}m</text>
    <text className="chart-axis" x={width-r} y={height-8} textAnchor="end">{Math.round(xb.max)}m</text>
  </svg>;
}

export function DurationBucketBars({ sessions }: { sessions: MiningSession[] }) {
  const buckets = ["<5m","5–15m","15–30m","30–60m","1–3h","3–6h","6h+"];
  const rows = buckets.map(bucket => {
    const values = sessions.filter(s => durationBucket(s.durationMs) === bucket).map(s => s.averageBps);
    return { bucket, avg: mean(values), count: values.length };
  }).filter(r => r.count > 0);
  if (!rows.length) return <EmptyChart text="Duration buckets appear after sessions are logged." />;
  const max=Math.max(...rows.map(r=>r.avg ?? 0),1);
  return <div className="bar-list">
    {rows.map(r=><div className="bar-row" key={r.bucket}>
      <div className="bar-label">{r.bucket}<small>{r.count} run{r.count===1?"":"s"}</small></div>
      <div className="bar-track"><i style={{width:`${((r.avg??0)/max)*100}%`}} /></div>
      <strong>{formatRate(r.avg)} <span>b/s</span></strong>
    </div>)}
  </div>;
}

export function PhaseBars({ sessions }: { sessions: MiningSession[] }) {
  const phases=[...new Set(sessions.map(s=>s.phase))].map(phase=>{
    const vals=sessions.filter(s=>s.phase===phase).map(s=>s.averageBps);
    return {phase, avg:mean(vals)??0, count:vals.length};
  }).sort((a,b)=>b.avg-a.avg);
  if (!phases.length) return <EmptyChart text="Phase comparison appears after sessions are logged." />;
  const max=Math.max(...phases.map(x=>x.avg),1);
  return <div className="bar-list">
    {phases.map(r=><div className="bar-row" key={r.phase}>
      <div className="bar-label">{r.phase}<small>{r.count} run{r.count===1?"":"s"}</small></div>
      <div className="bar-track"><i style={{width:`${(r.avg/max)*100}%`}} /></div>
      <strong>{r.avg.toFixed(3)} <span>b/s</span></strong>
    </div>)}
  </div>;
}

export function EmptyChart({ text }: { text: string }) {
  return <div className="empty-chart"><div className="empty-trace"/><p>{text}</p></div>;
}
