import type { MiningSession, MiningType, SidebarSnapshot, SkillStateSnapshot } from "../types";
import type { RelativeOcrRect } from "./ocrCalibration";

export type ExtensionConnectionMode = "manual" | "auto" | "dumb";
export type OcrCropProfile = "afk-sidepanel" | "standard" | "broad";
export type OffscreenWakeId = "boost-sync" | "boost-precision" | "boost-verify" | "boost-active" | "counter";
export type ExtensionPowerState = "idle" | "deep-sleep" | "sync" | "precision" | "activating" | "verifying" | "active-wait" | "fault";
export type ExtensionHealth = "healthy" | "degraded" | "paused" | "offline";
export type DiagnosticCategory = "system" | "chopping" | "ocr" | "timer" | "input" | "counter" | "session";
export type DiagnosticDetails = Record<string, string | number | boolean | null | undefined>;

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
  cooldownSyncIntervalSec: number;
  precisionWindowSec: number;
}

export interface DiagnosticEntry {
  at: string;
  level: "debug" | "info" | "warn" | "error";
  category: DiagnosticCategory;
  event: string;
  message: string;
  details?: DiagnosticDetails;
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
  ocrProfile?: OcrCropProfile;
  viewportWidth?: number;
  viewportHeight?: number;
  sessionActive: boolean;
  sessionStartedAt?: string;
  sessionStartBlocks?: number;
  boostFault?: string;
  predictedReadyAt?: number;
  lastBoostCaptureAt?: number;
  boostDriftSeconds?: number;
  cooldownUncertaintySec?: number;
  lastAuthoritativeSyncAt?: number;
  nextCooldownSyncAt?: number;
  dumbModeArmed?: boolean;
  ocrQueueDepth?: number;
  fastBoostHits?: number;
  fastRecognizerReady?: boolean;
  boostMicroCalibrated?: boolean;
  counterMicroCalibrated?: boolean;
  powerState: ExtensionPowerState;
  health: ExtensionHealth;
  healthReason?: string;
  lastRecognitionMethod?: OcrRecognitionMethod;
  lastQueueWaitMs?: number;
  lastCaptureMs?: number;
  rejectedOcrCount: number;
  readyToE1LatencyLastMs?: number;
  readyToE1LatencyMedianMs?: number;
  readyToE1LatencyWorstMs?: number;
  firstTryActivations: number;
  backupSuccessfulActivations: number;
  successfulActivations: number;
  activationRetries: number;
  failedActivations: number;
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
  | { target: "background"; type: "RECALIBRATE_OCR" }
  | { target: "background"; type: "SCAN_NOW" }
  | { target: "background"; type: "START_SESSION"; miningType: MiningType }
  | { target: "background"; type: "STOP_SESSION" }
  | { target: "background"; type: "TEST_E" }
  | { target: "background"; type: "CLEAR_BOOST_FAULT" }
  | { target: "background"; type: "OPEN_MONITOR" }
  | { target: "background"; type: "EMERGENCY_STOP" }
  | { target: "background"; type: "OFFSCREEN_WAKE"; id: OffscreenWakeId };

export interface BackgroundResponse<T = unknown> {
  ok: boolean;
  status?: LiveExtensionStatus;
  session?: MiningSession;
  value?: T;
  error?: string;
}

export interface UiStateMessage {
  target: "ui";
  type: "STATE_UPDATE";
  status: LiveExtensionStatus;
}

export type OcrMode = "full" | "counter" | "boost";
export type OcrInputScope = "base" | "micro";
export type OcrRecognitionMethod = "fast-template" | "tesseract-base" | "tesseract-micro";

export interface OcrRequest {
  target: "offscreen";
  type: "OCR";
  mode: OcrMode;
  imageDataUrl: string;
  calibrationKey?: string;
  inputScope?: OcrInputScope;
  preferFast?: boolean;
  /** Cheap precision probe: if no learned Ready/Active template matches, return Unknown without Tesseract. */
  fastOnly?: boolean;
}

export type OffscreenControlRequest =
  | { target: "offscreen"; type: "SCHEDULE_WAKE"; id: OffscreenWakeId; when: number }
  | { target: "offscreen"; type: "CANCEL_WAKE"; id: OffscreenWakeId }
  | { target: "offscreen"; type: "RESET_CALIBRATION" };

export interface OcrResponse {
  ok: boolean;
  rawText?: string;
  confidence?: number;
  elapsedMs?: number;
  snapshot?: SidebarSnapshot;
  blocksMined?: number;
  choppingSkill?: SkillStateSnapshot;
  microRect?: RelativeOcrRect;
  recognitionMethod?: OcrRecognitionMethod;
  fastAttempted?: boolean;
  fastMatchedLabel?: "ready" | "active";
  /** True only after Tesseract has taught the local matcher at least one Ready and one Active template. */
  fastRecognizerReady?: boolean;
  error?: string;
}
