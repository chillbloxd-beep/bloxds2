import { describe, expect, it } from "vitest";
import { blocksBetween, bps, combinedThroughput, durationBucket, durationForBlocks, median, percentile } from "./math";
import type { MiningSession } from "../types";

describe("mining math", () => {
  it("calculates the exact 6060-block delta", () => {
    expect(blocksBetween(1563711,1569771)).toBe(6060);
  });
  it("calculates measured rate", () => {
    expect(bps(6060,2252569)).toBeCloseTo(2.69026,4);
  });
  it("does not average combined throughput incorrectly", () => {
    const base=(blocks:number,durationMs:number,id:string):MiningSession=>({
      id,game:"bloxd",gameDataVersion:"x",phase:"Dungeon",miningType:"active",
      startCounter:0,endCounter:blocks,blocksMined:blocks,durationMs,averageBps:bps(blocks,durationMs),
      source:"manual",createdAt:new Date().toISOString(),communityOptIn:false
    });
    const result=combinedThroughput([base(100,20000,"a"),base(10000,5000000,"b")]);
    expect(result).toBeCloseTo(10100/5020,8);
  });
  it("calculates median and interpolated percentiles", () => {
    expect(median([1,2,3,4])).toBe(2.5);
    expect(percentile([1,2,3,4,5],.25)).toBe(2);
  });
  it("assigns duration buckets", () => {
    expect(durationBucket(4*60000)).toBe("<5m");
    expect(durationBucket(45*60000)).toBe("30–60m");
    expect(durationBucket(7*3600000)).toBe("6h+");
  });
  it("reverses rate into duration", () => {
    expect(durationForBlocks(2690,2.69)).toBeCloseTo(1000000,4);
  });
});
