import { describe, expect, it, vi } from "vitest";
import {
  PriorityOcrQueue,
  cooldownSyncDelayMs,
  isStaleObservation,
  transitionVerdict
} from "./reliability";

describe("PriorityOcrQueue", () => {
  it("runs a waiting critical boost before an older waiting counter", async () => {
    const queue = new PriorityOcrQueue();
    const order: string[] = [];
    let release!: () => void;
    const blocker = new Promise<void>(resolve => { release = resolve; });

    const first = queue.enqueue("full", async () => {
      order.push("running");
      await blocker;
      return 1;
    });
    const counter = queue.enqueue("counter", async () => {
      order.push("counter");
      return 2;
    });
    const critical = queue.enqueue("boost-critical", async () => {
      order.push("critical");
      return 3;
    });

    await vi.waitFor(() => expect(order).toEqual(["running"]));
    release();
    await Promise.all([first, counter, critical]);
    expect(order).toEqual(["running", "critical", "counter"]);
  });
});

describe("observation ordering", () => {
  it("rejects an old connection, generation or capture", () => {
    expect(isStaleObservation({ connectionEpoch: 1, generation: 5, captureAt: 500 }, 2, 5, 500)).toBe(true);
    expect(isStaleObservation({ connectionEpoch: 2, generation: 4, captureAt: 600 }, 2, 5, 500)).toBe(true);
    expect(isStaleObservation({ connectionEpoch: 2, generation: 5, captureAt: 499 }, 2, 5, 500)).toBe(true);
    expect(isStaleObservation({ connectionEpoch: 2, generation: 6, captureAt: 600 }, 2, 5, 500)).toBe(false);
  });
});

describe("transitionVerdict", () => {
  it("requires confirmation for implausibly early Ready", () => {
    expect(transitionVerdict({
      previous: { state: "cooldown", cooldownSeconds: 30 },
      observed: { state: "ready" },
      captureAt: 10_000,
      predictedReadyAt: 40_000,
      boostCycleActive: false
    })).toBe("confirm");
  });

  it("accepts Ready when it arrives near the prediction", () => {
    expect(transitionVerdict({
      previous: { state: "cooldown", cooldownSeconds: 2 },
      observed: { state: "ready" },
      captureAt: 10_000,
      predictedReadyAt: 10_900,
      boostCycleActive: false
    })).toBe("accept");
  });
});

describe("cooldownSyncDelayMs", () => {
  it("keeps normal cooldown reads at the requested interval and tightens near Ready", () => {
    expect(cooldownSyncDelayMs({ remainingMs: 120_000, nominalIntervalSec: 15, uncertaintySec: 0.5 })).toBe(15_000);
    expect(cooldownSyncDelayMs({ remainingMs: 20_000, nominalIntervalSec: 15, uncertaintySec: 0.5 })).toBe(7_000);
    expect(cooldownSyncDelayMs({ remainingMs: 8_000, nominalIntervalSec: 15, uncertaintySec: 0.5 })).toBe(2_500);
    expect(cooldownSyncDelayMs({ remainingMs: 80_000, nominalIntervalSec: 15, uncertaintySec: 4.5 })).toBe(3_000);
  });
});
