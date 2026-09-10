import type { CommunitySummary, MiningSession } from "../types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function api(path: string) {
  return `${API_BASE}${path}`;
}

function installId(): string {
  const key = "oneblock.installId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID() + "-" + Array.from(crypto.getRandomValues(new Uint32Array(4))).map(n => n.toString(16)).join("");
    localStorage.setItem(key, id);
  }
  return id;
}

export async function submitCommunityRun(session: MiningSession): Promise<void> {
  const res = await fetch(api("/api/community/runs"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-install-id": installId()
    },
    body: JSON.stringify({
      id: session.id,
      game: session.game,
      implementation: session.implementation,
      gameDataVersion: session.gameDataVersion,
      phase: session.phase,
      miningType: session.miningType,
      startCounter: session.startCounter,
      endCounter: session.endCounter,
      durationMs: session.durationMs,
      source: session.source,
      tool: session.tool,
      breakSpeed: session.breakSpeed,
      momentum: session.momentum,
      device: session.device
    })
  });
  if (!res.ok) throw new Error(`Community sync failed (${res.status})`);
}

export async function deleteCommunityRun(id: string): Promise<void> {
  const res = await fetch(api(`/api/community/runs/${encodeURIComponent(id)}`), {
    method: "DELETE",
    headers: {
      "x-install-id": installId()
    }
  });
  if (!res.ok) throw new Error(`Community withdrawal failed (${res.status})`);
}

export async function fetchCommunitySummary(filters: {
  game?: string;
  phase?: string;
  miningType?: string;
  durationBucket?: string;
} = {}): Promise<CommunitySummary> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
  const res = await fetch(api(`/api/community/summary?${params.toString()}`));
  if (!res.ok) throw new Error(`Community API unavailable (${res.status})`);
  return res.json();
}

export async function health(): Promise<boolean> {
  try {
    const res = await fetch(api("/api/health"));
    return res.ok;
  } catch {
    return false;
  }
}
