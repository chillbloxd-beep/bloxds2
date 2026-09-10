import type { MiningSession } from "../types";

export function blocksBetween(start: number, end: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.trunc(end) - Math.trunc(start));
}

export function bps(blocks: number, durationMs: number): number {
  if (!(blocks >= 0) || !(durationMs > 0)) return 0;
  return blocks / (durationMs / 1000);
}

export function blocksPerHour(rate: number): number {
  return rate * 3600;
}

export function durationForBlocks(blocks: number, rate: number): number {
  if (!(blocks >= 0) || !(rate > 0)) return Infinity;
  return (blocks / rate) * 1000;
}

export function blocksForDuration(durationMs: number, rate: number): number {
  if (!(durationMs >= 0) || !(rate > 0)) return 0;
  return (durationMs / 1000) * rate;
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const low = Math.floor(idx);
  const high = Math.ceil(idx);
  if (low === high) return sorted[low];
  const weight = idx - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

export function median(values: number[]): number | null {
  return percentile(values, 0.5);
}

export function combinedThroughput(sessions: MiningSession[]): number | null {
  const blocks = sessions.reduce((s, x) => s + x.blocksMined, 0);
  const ms = sessions.reduce((s, x) => s + x.durationMs, 0);
  return ms > 0 ? bps(blocks, ms) : null;
}

export function formatInteger(value: number): string {
  return Math.round(value).toLocaleString();
}

export function formatRate(value: number | null | undefined, digits = 3): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export function formatDuration(ms: number, precise = false): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  let remaining = Math.round(ms);
  const days = Math.floor(remaining / 86_400_000);
  remaining %= 86_400_000;
  const hours = Math.floor(remaining / 3_600_000);
  remaining %= 3_600_000;
  const minutes = Math.floor(remaining / 60_000);
  remaining %= 60_000;
  const seconds = Math.floor(remaining / 1000);
  const millis = remaining % 1000;

  if (precise && days === 0) {
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return `${hh}:${mm}:${ss}.${String(millis).padStart(3, "0")}`;
  }

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  if (minutes || hours || days) parts.push(`${minutes}m`);
  if (!days && !hours) parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function parseDurationParts(hours: number, minutes: number, seconds: number): number {
  if ([hours, minutes, seconds].some(v => !Number.isFinite(v) || v < 0)) return 0;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

export function durationBucket(ms: number): string {
  const min = ms / 60000;
  if (min < 5) return "<5m";
  if (min < 15) return "5–15m";
  if (min < 30) return "15–30m";
  if (min < 60) return "30–60m";
  if (min < 180) return "1–3h";
  if (min < 360) return "3–6h";
  return "6h+";
}

export function buildPrediction(
  sessions: MiningSession[],
  opts: { phase?: string; miningType?: "active" | "afk" }
): {
  rate: number;
  low: number;
  high: number;
  source: string;
  sampleSize: number;
} | null {
  const valid = sessions.filter(s => s.averageBps > 0 && s.durationMs > 0);
  if (!valid.length) return null;

  const samePhaseAndType = valid.filter(s =>
    (!opts.phase || s.phase === opts.phase) &&
    (!opts.miningType || s.miningType === opts.miningType)
  );
  const sameType = valid.filter(s => !opts.miningType || s.miningType === opts.miningType);

  const chosen =
    samePhaseAndType.length >= 3 ? samePhaseAndType :
    sameType.length >= 3 ? sameType :
    valid;

  const rates = chosen.map(s => s.averageBps);
  const mid = median(rates)!;
  const low = percentile(rates, 0.25) ?? mid;
  const high = percentile(rates, 0.75) ?? mid;

  let source = "your recorded sessions";
  if (chosen === samePhaseAndType && opts.phase) source = `your ${opts.phase} ${opts.miningType ?? ""} sessions`.trim();
  else if (chosen === sameType && opts.miningType) source = `your ${opts.miningType} sessions`;

  return { rate: mid, low, high, source, sampleSize: chosen.length };
}
