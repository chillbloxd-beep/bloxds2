export type Game = "bloxd" | "minecraft";
export type MiningType = "active" | "afk";
export type SessionSource = "manual" | "live_timer" | "afk_timer" | "extension";
export type QualityState = "local" | "included" | "short_sample" | "review";

export type SkillStateKind = "ready" | "active" | "cooldown" | "unknown";

export interface SkillStateSnapshot {
  state: SkillStateKind;
  cooldownSeconds?: number;
  raw?: string;
}

export interface SidebarSkillSnapshot {
  level?: number;
  luckyPercent?: number;
  skill?: SkillStateSnapshot;
}

export interface SidebarSnapshot {
  capturedAt: string;
  rawText: string;
  lines: string[];
  ocrConfidence?: number;
  banner?: string;
  owner?: string;
  phase?: string;
  blocksMined?: number;
  mining?: SidebarSkillSnapshot;
  digging?: SidebarSkillSnapshot;
  chopping?: SidebarSkillSnapshot;
  farmingLevel?: number;
  goldPercent?: number;
  goldSkill?: SkillStateSnapshot;
  daily?: string;
}

export interface BoostRunStats {
  successfulActivations: number;
  activationRetries: number;
  failedActivations: number;
  cooldownsRead: number[];
}

export interface MiningSession {
  id: string;
  game: Game;
  implementation?: string;
  gameDataVersion: string;
  phase: string;
  miningType: MiningType;
  startCounter: number;
  endCounter: number;
  blocksMined: number;
  durationMs: number;
  averageBps: number;
  source: SessionSource;
  startedAt?: string;
  createdAt: string;
  tool?: string;
  breakSpeed?: string;
  momentum?: string;
  device?: string;
  notes?: string;
  sidebarBefore?: SidebarSnapshot;
  sidebarAfter?: SidebarSnapshot;
  boostStats?: BoostRunStats;
  extensionConnectionMode?: "manual" | "auto" | "dumb";
  lobby?: string;
  communityOptIn: boolean;
  cloudStatus?: "local" | "synced" | "failed";
}

export interface Goal {
  id: string;
  name: string;
  currentBlocks: number;
  targetBlocks: number;
  targetDate?: string;
  createdAt: string;
}

export interface AppSettings {
  theme: "light" | "dark";
  manualBaseline?: number;
  defaultCommunityOptIn: boolean;
}

export interface CommunitySummary {
  scope: {
    game: string;
    phase?: string;
    miningType?: string;
    durationBucket?: string;
  };
  runs: number;
  players: number;
  totalBlocks: number;
  totalDurationMs: number;
  combinedThroughput: number | null;
  meanSessionRate: number | null;
  medianSessionRate: number | null;
  p10: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  averageBlocksPerRun: number | null;
  medianBlocksPerRun: number | null;
  averageDurationMs: number | null;
  medianDurationMs: number | null;
  excludedOutliers: number;
  sampleCapped: boolean;
  sampleLimit: number;
}
