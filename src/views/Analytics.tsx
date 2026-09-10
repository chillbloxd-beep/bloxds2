import type { MiningSession } from "../types";
import { combinedThroughput, formatInteger, formatRate, mean, median } from "../lib/math";
import { DurationBucketBars, DurationScatter, PhaseBars, SpeedTrend } from "../components/Charts";
import { Metric, PageHead, Section } from "../components/UI";

export function Analytics({sessions}:{sessions:MiningSession[]}) {
  const rates=sessions.map(s=>s.averageBps);
  const totalBlocks=sessions.reduce((a,b)=>a+b.blocksMined,0);
  const active=sessions.filter(s=>s.miningType==="active").map(s=>s.averageBps);
  const afk=sessions.filter(s=>s.miningType==="afk").map(s=>s.averageBps);

  return <>
    <PageHead eyebrow="PERSONAL DATA" title="Analytics" subtitle="Measured trends from your own complete runs. Correlation is shown as observation, not assumed causation." />
    <div className="metric-strip">
      <Metric label="Combined throughput" value={formatRate(combinedThroughput(sessions))} suffix=" b/s"/>
      <Metric label="Median run" value={formatRate(median(rates))} suffix=" b/s"/>
      <Metric label="Mean run" value={formatRate(mean(rates))} suffix=" b/s"/>
      <Metric label="Blocks measured" value={formatInteger(totalBlocks)}/>
    </div>
    <Section title="Speed over sessions" caption="Each point is one complete run."><div className="chart-panel"><SpeedTrend sessions={sessions}/></div></Section>
    <Section title="Duration vs. mining speed" caption="Use this to inspect whether your longer sessions tend to run slower or faster."><div className="chart-panel"><DurationScatter sessions={sessions}/></div></Section>
    <div className="two-col">
      <Section title="Speed by run length"><DurationBucketBars sessions={sessions}/></Section>
      <Section title="Speed by phase"><PhaseBars sessions={sessions}/></Section>
    </div>
    <Section title="Active vs AFK">
      <div className="compare-pair">
        <Metric label={`Active · ${active.length} runs`} value={formatRate(mean(active))} suffix=" b/s"/>
        <Metric label={`AFK · ${afk.length} runs`} value={formatRate(mean(afk))} suffix=" b/s"/>
      </div>
    </Section>
  </>;
}
