import type { SidebarSnapshot } from "../types";
import type { OcrCropProfile, OcrMode } from "./types";

export interface OcrViewport {
  width: number;
  height: number;
  pageX: number;
  pageY: number;
}

interface NormalizedCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

type CropSet = Record<OcrMode, NormalizedCrop>;

// The AFK profile is calibrated from the user's 1920x1200 Chromebook layout with
// Chrome's side panel open. All coordinates are normalized to the Bloxd viewport,
// so lobby number and absolute screen resolution do not matter.
const CROPS: Record<OcrCropProfile, CropSet> = {
  "afk-sidepanel": {
    full: { x: 0.735, y: 0.31, w: 0.265, h: 0.48 },
    counter: { x: 0.75, y: 0.45, w: 0.25, h: 0.12 },
    boost: { x: 0.75, y: 0.59, w: 0.25, h: 0.105 }
  },
  standard: {
    full: { x: 0.71, y: 0.25, w: 0.29, h: 0.58 },
    counter: { x: 0.73, y: 0.40, w: 0.27, h: 0.17 },
    boost: { x: 0.73, y: 0.54, w: 0.27, h: 0.18 }
  },
  broad: {
    full: { x: 0.58, y: 0.16, w: 0.42, h: 0.70 },
    counter: { x: 0.62, y: 0.34, w: 0.38, h: 0.25 },
    boost: { x: 0.62, y: 0.48, w: 0.38, h: 0.31 }
  }
};

export function profileOrder(width: number, height: number): OcrCropProfile[] {
  const aspect = width / Math.max(1, height);
  // Opening Chrome's side panel makes the game viewport notably narrower.
  return aspect < 1.55
    ? ["afk-sidepanel", "standard", "broad"]
    : ["standard", "afk-sidepanel", "broad"];
}

export function cropRegion(profile: OcrCropProfile, mode: OcrMode, view: OcrViewport) {
  const crop = CROPS[profile][mode];
  const x = Math.max(0, Math.min(view.width, view.width * crop.x));
  const y = Math.max(0, Math.min(view.height, view.height * crop.y));
  const width = Math.max(1, Math.min(view.width - x, view.width * crop.w));
  const height = Math.max(1, Math.min(view.height - y, view.height * crop.h));
  return {
    x: view.pageX + x,
    y: view.pageY + y,
    width,
    height,
    scale: 1
  };
}

export function snapshotScore(snapshot?: SidebarSnapshot): number {
  if (!snapshot) return 0;
  let score = 0;
  if (/ONE\s*BLOCK/i.test(snapshot.rawText)) score += 2;
  if (snapshot.blocksMined !== undefined) score += 6;
  if (snapshot.phase) score += 2;
  if (snapshot.owner) score += 1;
  if (snapshot.mining?.level !== undefined) score += 1;
  if (snapshot.digging?.level !== undefined) score += 1;
  if (snapshot.chopping?.level !== undefined) score += 2;
  if (snapshot.chopping?.skill && snapshot.chopping.skill.state !== "unknown") score += 3;
  if (snapshot.farmingLevel !== undefined) score += 1;
  if (snapshot.goldPercent !== undefined) score += 1;
  return score;
}

export function isUsableSnapshot(snapshot?: SidebarSnapshot): boolean {
  return Boolean(snapshot && snapshot.blocksMined !== undefined && snapshotScore(snapshot) >= 8);
}
