import { describe, expect, test } from "bun:test";
import { BALL_TYPES } from "../src/config";
import {
  ballCost,
  canBuySkill,
  comboMultiplier,
  offlineEarnings,
  skillMods,
  starsForPrestige,
  upgradeCost,
} from "../src/economy";

describe("ball prices", () => {
  test("every purchase of a type costs more than the last", () => {
    for (const t of BALL_TYPES) {
      const start = t.id === "basic" ? 1 : 0;
      for (let n = start; n < start + 30; n++)
        expect(ballCost(t.id, n + 1)).toBeGreaterThan(ballCost(t.id, n));
    }
  });

  test("types scale independently with their own base and growth", () => {
    const growth = new Set(BALL_TYPES.map((t) => t.costGrowth));
    expect(growth.size).toBe(BALL_TYPES.length);
    // Buying lots of basic balls never raises the lightning price.
    expect(ballCost("lightning", 0)).toBe(
      BALL_TYPES.find((t) => t.id === "lightning")!.baseCost,
    );
    expect(ballCost("basic", 1)).toBe(25);
    expect(ballCost("basic", 11)).toBe(Math.round(25 * Math.pow(1.15, 10)));
  });

  test("swarm specialization discounts basic balls only", () => {
    expect(ballCost("basic", 5, "swarm")).toBeLessThan(ballCost("basic", 5));
  });

  test("upgrades get pricier and stop at the cap", () => {
    expect(upgradeCost("fast", "speed", 3)!).toBeGreaterThan(
      upgradeCost("fast", "speed", 2)!,
    );
    expect(upgradeCost("fast", "special", 10)).toBeNull();
  });
});

describe("skills", () => {
  test("nodes need their parents and enough points", () => {
    expect(canBuySkill("sharp", {}, 5)).toBe(false);
    expect(canBuySkill("core", {}, 1)).toBe(true);
    expect(canBuySkill("sharp", { core: 1 }, 1)).toBe(true);
    expect(canBuySkill("u-lightning", { core: 1, sharp: 1 }, 5)).toBe(false);
    expect(
      canBuySkill("u-lightning", { core: 1, sharp: 1, momentum: 1 }, 1),
    ).toBe(false);
    expect(canBuySkill("core", { core: 1 }, 9)).toBe(false);
  });

  test("ranks stack into modifiers and unlock balls", () => {
    const m = skillMods({ core: 1, sharp: 2, greed: 3, "u-fast": 1 }, 2);
    expect(m.damage).toBeCloseTo(1 + 0.1 + 0.4 + 2 * 0.05);
    expect(m.money).toBeCloseTo(1 + 0.75 + 0.2);
    expect(m.unlocked.has("fast")).toBe(true);
    expect(m.unlocked.has("lightning")).toBe(false);
  });
});

describe("rewards", () => {
  test("combo multiplier grows and caps at 3x", () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(50)).toBeCloseTo(1.5);
    expect(comboMultiplier(10000)).toBe(3);
  });

  test("offline earnings ignore short absences and cap at 8 hours", () => {
    expect(offlineEarnings(10, 30, 0.1)).toBe(0);
    expect(offlineEarnings(10, 3600, 0.1)).toBe(3600);
    expect(offlineEarnings(10, 100 * 3600, 0.1)).toBe(
      offlineEarnings(10, 8 * 3600, 0.1),
    );
  });

  test("prestige needs level 3", () => {
    expect(starsForPrestige(1e9, 2)).toBe(0);
    expect(starsForPrestige(160000, 3)).toBe(2);
  });
});
