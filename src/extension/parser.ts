import type { SidebarSkillSnapshot, SidebarSnapshot, SkillStateSnapshot } from "../types";

export function isOneBlockUrl(value?: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "bloxd.io" && url.pathname.toLowerCase() === "/play/oneblock";
  } catch {
    return false;
  }
}

export function lobbyFromUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).searchParams.get("lobby") || undefined;
  } catch {
    return undefined;
  }
}

function cleanDigits(token: string): string {
  return token.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/[^0-9]/g, "");
}

function numberFromToken(token?: string): number | undefined {
  if (!token) return undefined;
  const digits = cleanDigits(token);
  if (!digits) return undefined;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : undefined;
}

export function parseSkillState(text: string): SkillStateSnapshot {
  const compact = text.replace(/\s+/g, " ").trim();
  if (/\bready\b/i.test(compact)) return { state: "ready", raw: compact };
  if (/\bactive\b/i.test(compact)) return { state: "active", raw: compact };
  const cooldown = compact.match(/([0-9IlOo|]{1,5})\s*s\b/i);
  if (cooldown) {
    const seconds = numberFromToken(cooldown[1]);
    if (seconds !== undefined && seconds <= 86400) return { state: "cooldown", cooldownSeconds: seconds, raw: compact };
  }
  return { state: "unknown", raw: compact };
}

function parsePercent(line: string, label: string): number | undefined {
  const match = line.match(new RegExp(`${label}\\s*[:=]?\\s*([0-9OoIl|]+(?:[.,][0-9OoIl|]+)?)\\s*%`, "i"));
  if (!match) return undefined;
  const normalized = match[1].replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function parseLevel(line: string, label: string): number | undefined {
  const match = line.match(new RegExp(`^\\s*${label}\\s+([0-9OoIl|,]+)`, "i"));
  return numberFromToken(match?.[1]);
}

export function parseBlocksMined(text: string): number | undefined {
  const match = text.match(/Blocks\s*mined\s*[:=]?\s*([0-9OoIl|,]+)/i);
  return numberFromToken(match?.[1]);
}

export function parseSidebarText(text: string, confidence?: number): SidebarSnapshot {
  const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const snapshot: SidebarSnapshot = {
    capturedAt: new Date().toISOString(),
    rawText: text.trim(),
    lines,
    ocrConfidence: confidence
  };

  const oneBlockIndex = lines.findIndex(line => /ONE\s*BLOCK/i.test(line));
  if (oneBlockIndex >= 0) {
    const banner = lines.slice(oneBlockIndex + 1).find(line => !/^-+$/.test(line) && !/^(Owner|Phase|Blocks\s*mined)\b/i.test(line));
    if (banner) snapshot.banner = banner;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const owner = line.match(/Owner\s*[:=]?\s*(.+)$/i);
    if (owner) snapshot.owner = owner[1].trim();
    const phase = line.match(/Phase\s*[:=]?\s*(.+)$/i);
    if (phase) snapshot.phase = phase[1].trim();
    const blocks = parseBlocksMined(line);
    if (blocks !== undefined) snapshot.blocksMined = blocks;

    for (const name of ["Mining", "Digging", "Chopping"] as const) {
      const level = parseLevel(line, name);
      if (level === undefined) continue;
      const next = lines[i + 1] || "";
      const skill: SidebarSkillSnapshot = { level };
      const lucky = parsePercent(next, "Lucky");
      if (lucky !== undefined) skill.luckyPercent = lucky;
      if (/Skill/i.test(next)) skill.skill = parseSkillState(next);
      snapshot[name.toLowerCase() as "mining" | "digging" | "chopping"] = skill;
    }

    const farming = parseLevel(line, "Farming");
    if (farming !== undefined) snapshot.farmingLevel = farming;

    if (/^Gold\b/i.test(line)) {
      const percent = parsePercent(line, "Gold");
      if (percent !== undefined) snapshot.goldPercent = percent;
      if (/Skill/i.test(line)) snapshot.goldSkill = parseSkillState(line);
    }

    const daily = line.match(/^Daily\s*[:=]?\s*(.+)$/i);
    if (daily) snapshot.daily = daily[1].trim();
  }

  return snapshot;
}

export function parseChoppingFromText(text: string): SkillStateSnapshot {
  const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const choppingIndex = lines.findIndex(line => /^Chopping\b/i.test(line));
  if (choppingIndex >= 0) {
    const neighborhood = lines.slice(choppingIndex, choppingIndex + 3).join(" ");
    return parseSkillState(neighborhood);
  }
  const skillLine = lines.find(line => /Skill/i.test(line));
  return parseSkillState(skillLine || text);
}
