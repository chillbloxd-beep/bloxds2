import { describe, expect, it } from "vitest";
import { cropRegion, isUsableSnapshot, profileOrder, snapshotScore } from "./crop";
import type { SidebarSnapshot } from "../types";

describe("One Block OCR crop profiles", () => {
  it("prefers the calibrated AFK side-panel profile for a narrow game viewport", () => {
    expect(profileOrder(1303, 1083)[0]).toBe("afk-sidepanel");
  });

  it("prefers the standard profile for a wide game viewport", () => {
    expect(profileOrder(1536, 959)[0]).toBe("standard");
  });

  it("keeps every crop inside the current viewport", () => {
    const view = { width: 1303, height: 1083, pageX: 0, pageY: 0 };
    for (const profile of ["afk-sidepanel", "standard", "broad"] as const) {
      for (const mode of ["full", "counter", "boost"] as const) {
        const crop = cropRegion(profile, mode, view);
        expect(crop.x).toBeGreaterThanOrEqual(0);
        expect(crop.y).toBeGreaterThanOrEqual(0);
        expect(crop.x + crop.width).toBeLessThanOrEqual(view.width + 0.001);
        expect(crop.y + crop.height).toBeLessThanOrEqual(view.height + 0.001);
      }
    }
  });

  it("scores a complete One Block sidebar as usable", () => {
    const snapshot: SidebarSnapshot = {
      capturedAt: new Date().toISOString(),
      rawText: "ONE BLOCK\nOwner: test\nPhase: Jungle\nBlocks mined: 1571296\nChopping 1000\nLucky: 100.0% | Skill: Ready",
      lines: [],
      owner: "test",
      phase: "Jungle",
      blocksMined: 1571296,
      chopping: { level: 1000, skill: { state: "ready" } }
    };
    expect(snapshotScore(snapshot)).toBeGreaterThanOrEqual(8);
    expect(isUsableSnapshot(snapshot)).toBe(true);
  });
});
