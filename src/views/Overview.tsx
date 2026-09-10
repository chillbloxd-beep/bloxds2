import type { Goal, MiningSession } from "../types";
import type { ViewName } from "../components/AppShell";
import { combinedThroughput, formatDuration, formatInteger, formatRate, median } from "../lib/math";
import { Metric, PageHead, Section } from "../components/UI";
import { SpeedTrend } from "../components/Charts";

export function Overview({ sessions, goals, onNavigate }: { sessions: MiningSession[]; goals: Goal[]; onNavigate: (v: ViewName)=>void }) {
  if (!sessions.length) {
    return <div className="first-run">
      <div className="first-copy">
        <div className="eyebrow">ONEBLOCK ANALYTICS</div>
        <h1>Mining performance,<br/>measured.</h1>
        <p>Track complete OneBlock runs, compare sustained performance and predict future block progress from real data.</p>
        <button className="primary-button" onClick={() => onNavigate("log")}>Log your first run</button>
      </div>
      <div className="demo-panel">
        <span>DEMO MEASUREMENT</span>
        <strong>2.690</strong>
        <b>blocks / second</b>
        <div className="demo-rule"/>
        <p>6,060 blocks · 37:32.569<br/>Example measured session</p>
      </div>
    </div>;
  }

  const latest = sessions[0];
  const rates=sessions.map(s=>s.averageBps);
  const sustained=combinedThroughput(sessions);
  const best=Math.max(...rates);
  const med=median(rates);
  const totalBlocks=sessions.reduce((a,b)=>a+b.blocksMined,0);
  const totalMs=sessions.reduce((a,b)=>a+b.durationMs,0);

  return <>
    <PageHead eyebrow="PERSONAL PERFORMANCE" title="Overview" subtitle="Your measured OneBlock performance, based only on saved sessions." action={<button className="primary-button" onClick={() => onNavigate("log")}>Log run</button>} />
    <div className="headline-measure">
      <div><span>SUSTAINED RATE</span><strong>{formatRate(sustained)}</strong><b>blocks / second</b><p>Across {sessions.length} recorded run{sessions.length===1?"":"s"} · {formatInteger(totalBlocks)} blocks</p></div>
      <div className="headline-meta">
        <Metric label="Best observed" value={formatRate(best)} suffix=" b/s"/>
        <Metric label="Personal median" value={formatRate(med)} suffix=" b/s"/>
        <Metric label="Tracked blocks" value={formatInteger(totalBlocks)}/>
        <Metric label="Tracked time" value={formatDuration(totalMs)}/>
      </div>
    </div>

    <Section title="Performance history" caption="Average blocks per second across your recorded sessions.">
      <div className="chart-panel"><SpeedTrend sessions={sessions}/></div>
    </Section>

    <div className="two-col">
      <Section title="Latest run">
        <div className="run-summary">
          <div><span>Phase</span><strong>{latest.phase}</strong></div>
          <div><span>Blocks</span><strong>{formatInteger(latest.blocksMined)}</strong></div>
          <div><span>Duration</span><strong>{formatDuration(latest.durationMs, true)}</strong></div>
          <div><span>Rate</span><strong>{latest.averageBps.toFixed(5)} b/s</strong></div>
        </div>
      </Section>
      <Section title="Goals">
        {goals.length ? goals.slice(0,3).map(g => {
          const remaining=Math.max(0,g.targetBlocks-g.currentBlocks);
          return <div className="goal-row" key={g.id}><div><strong>{g.name}</strong><span>{formatInteger(remaining)} blocks remaining</span></div><div className="goal-progress"><i style={{width:`${Math.min(100,(g.currentBlocks/g.targetBlocks)*100)}%`}}/></div></div>;
        }) : <div className="empty-inline">No goals yet. Set a milestone to track long-term progress.</div>}
      </Section>
    </div>
  </>;
}
