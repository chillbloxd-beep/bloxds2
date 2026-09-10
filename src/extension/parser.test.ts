import { describe, expect, it } from "vitest";
import { isOneBlockUrl, lobbyFromUrl, parseChoppingFromText, parseSidebarText, parseSkillState } from "./parser";

const SAMPLE = `ONE BLOCK
----------------
Free Watermelon
Owner: chill_dude_chill
Phase: Jungle
Blocks mined: 1570233
Mining 1000 []
Lucky: 100.0% | Skill: Ready
Digging 1000 []
Lucky: 100.0% | Skill: Ready
Chopping 1000 []
Lucky: 100.0% | Skill: 154s
Farming 783 []
Gold: 50.0% | Skill: Ready
Daily: Win a minigame event (0/1)`;

describe("One Block URL matching", () => {
  it("matches One Block with and without a lobby", () => {
    expect(isOneBlockUrl("https://bloxd.io/play/oneBlock")).toBe(true);
    expect(isOneBlockUrl("https://bloxd.io/play/oneBlock?lobby=1111")).toBe(true);
    expect(isOneBlockUrl("https://bloxd.io/play/oneBlock?lobby=98765&x=1")).toBe(true);
    expect(lobbyFromUrl("https://bloxd.io/play/oneBlock?lobby=1111")).toBe("1111");
  });

  it("does not activate on another Bloxd mode", () => {
    expect(isOneBlockUrl("https://bloxd.io/play/bedWars?lobby=1111")).toBe(false);
  });
});

describe("sidebar parsing", () => {
  it("keeps raw text and parses the visible One Block fields", () => {
    const snapshot = parseSidebarText(SAMPLE, 94);
    expect(snapshot.rawText).toContain("Free Watermelon");
    expect(snapshot.owner).toBe("chill_dude_chill");
    expect(snapshot.phase).toBe("Jungle");
    expect(snapshot.blocksMined).toBe(1570233);
    expect(snapshot.mining?.level).toBe(1000);
    expect(snapshot.mining?.luckyPercent).toBe(100);
    expect(snapshot.mining?.skill?.state).toBe("ready");
    expect(snapshot.digging?.level).toBe(1000);
    expect(snapshot.chopping?.level).toBe(1000);
    expect(snapshot.chopping?.luckyPercent).toBe(100);
    expect(snapshot.chopping?.skill).toMatchObject({ state: "cooldown", cooldownSeconds: 154 });
    expect(snapshot.farmingLevel).toBe(783);
    expect(snapshot.goldPercent).toBe(50);
    expect(snapshot.goldSkill?.state).toBe("ready");
    expect(snapshot.daily).toBe("Win a minigame event (0/1)");
  });
});

describe("boost state parsing", () => {
  it("distinguishes Ready, Active and countdown seconds", () => {
    expect(parseSkillState("Lucky: 100.0% | Skill: Ready").state).toBe("ready");
    expect(parseSkillState("Lucky: 100.0% | Skill: Active").state).toBe("active");
    expect(parseSkillState("Lucky: 100.0% | Skill: 157s")).toMatchObject({ state: "cooldown", cooldownSeconds: 157 });
    expect(parseChoppingFromText("Chopping 1000 []\nLucky: 100.0% | Skill: Ready").state).toBe("ready");
  });

  it("does not convert unclear text into a false action state", () => {
    expect(parseSkillState("Lucky: 100.0% | Skill: ???").state).toBe("unknown");
  });
});
