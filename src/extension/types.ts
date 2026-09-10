import type { MiningSession, MiningType, SidebarSnapshot, SkillStateSnapshot } from "../types";

export type ExtensionConnectionMode = "manual" | "auto";

export interface ExtensionSettings {
  mode: ExtensionConnectionMode;
  manualEnabled: boolean;
  autoBoost: boolean;
  liveCounter: boolean;
  counterIntervalSec: number;
  verifyAfterPressSec: number;
  activeCheckSec: number;
  cooldownSafetySec: number;
  readyRetrySec: number;
  doubleTapGapMs: number;
}

export interface DiagnosticEntry {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface LiveExtensionStatus {
  ready: boolean;
  connected: boolean;
  tabId?: number;
  url?: string;
  lobby?: string;
  phase?: string;
  blocksMined?: number;
  rollingBps?: number;
  choppingSkill: SkillStateSnapshot;
  lastOcrConfidence?: number;
  lastOcrMs?: number;
  readsLastMinute: number;
  sessionActive: boolean;
  sessionStartedAt?: string;
  sessionStartBlocks?: number;
  boostFault?: string;
  settings: ExtensionSettings;
  currentSnapshot?: SidebarSnapshot;
  diagnostics: DiagnosticEntry[];
  error?: string;
}

export interface ActiveExtensionSession {
  id: string;
  startedAtMs: number;
  miningType: MiningType;
  startSnapshot: SidebarSnapshot;
  connectionMode: ExtensionConnectionMode;
  lobby?: string;
  boostStart: {
    successfulActivations: number;
    activationRetries: number;
    failedActivations: number;
    cooldownCount: number;
  };
}

export type BackgroundCommand =
  | { target: "background"; type: "GET_STATUS" }
  | { target: "background"; type: "SET_SETTINGS"; patch: Partial<ExtensionSettings> }
  | { target: "background"; type: "REFRESH_FULL" }
  | { target: "background"; type: "SCAN_NOW" }
  | { target: "background"; type: "START_SESSION"; miningType: MiningType }
  | { target: "background"; type: "STOP_SESSION" }
  | { target: "background"; type: "CLEAR_BOOST_FAULT" }
  | { target: "background"; type: "EMERGENCY_STOP" };

export interface BackgroundResponse<T = unknown> {
  ok: boolean;
  status?: LiveExtensionStatus;
  session?: MiningSession;
  value?: T;
  error?: string;
}

export type OcrMode = "full" | "counter" | "boost";

export interface OcrRequest {
  target: "offscreen";
  type: "OCR";
  mode: OcrMode;
  imageDataUrl: string;
}

export interface OcrResponse {
  ok: boolean;
  rawText?: string;
  confidence?: number;
  elapsedMs?: number;
  snapshot?: SidebarSnapshot;
  blocksMined?: number;
  choppingSkill?: SkillStateSnapshot;
  error?: string;
}
