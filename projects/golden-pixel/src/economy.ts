import {
  BALL_BY_ID,
  SKILL_BY_ID,
  SKILLS,
  SPEC_MILESTONE,
  STAT_MAX,
  TIER_HP,
  TIER_VALUE,
  type BallTypeId,
  type StatId,
} from "./config";

export interface BallProgress {
  owned: number;
  speed: number;
  damage: number;
  special: number;
  spec: string | null;
}

export function ballCost(
  id: BallTypeId,
  owned: number,
  spec: string | null = null,
): number {
  const t = BALL_BY_ID[id];
  // The free starting basic ball does not count towards its price.
  const n = id === "basic" ? Math.max(0, owned - 1) : owned;
  const discount = id === "basic" && spec === "swarm" ? 0.6 : 1;
  return Math.round(t.baseCost * Math.pow(t.costGrowth, n) * discount);
}

const STAT_COST: Record<StatId, { mult: number; growth: number }> = {
  speed: { mult: 2, growth: 1.6 },
  damage: { mult: 3, growth: 1.55 },
  special: { mult: 5, growth: 1.8 },
};

export function upgradeCost(
  id: BallTypeId,
  stat: StatId,
  level: number,
): number | null {
  if (level >= STAT_MAX[stat]) return null;
  const c = STAT_COST[stat];
  return Math.round(
    BALL_BY_ID[id].baseCost * c.mult * Math.pow(c.growth, level),
  );
}

export function canSpecialize(p: BallProgress): boolean {
  return p.spec === null && p.speed + p.damage + p.special >= SPEC_MILESTONE;
}

export function levelHpScale(level: number): number {
  return Math.pow(1.85, level - 1);
}

export function levelValueScale(level: number): number {
  return Math.pow(1.75, level - 1);
}

export function tierHp(tier: number, level: number): number {
  return TIER_HP[tier] * levelHpScale(level);
}

export function tierValue(tier: number, level: number): number {
  return TIER_VALUE[tier] * levelValueScale(level);
}

export function skillPointsForClear(level: number): number {
  return 2 + Math.floor(level / 2);
}

export function starsForPrestige(
  runEarnings: number,
  maxLevel: number,
): number {
  if (maxLevel < 3) return 0;
  return Math.floor(Math.sqrt(runEarnings / 40000));
}

export interface Mods {
  damage: number;
  speed: number;
  money: number;
  crit: number;
  critDamage: number;
  radar: number;
  offline: number;
  startCash: number;
  comboWindow: number;
  tap: number;
  unlocked: Set<BallTypeId>;
}

export function skillMods(ranks: Record<string, number>, stars: number): Mods {
  const m: Mods = {
    damage: 1 + stars * 0.05,
    speed: 1,
    money: 1 + stars * 0.1,
    crit: 0.02,
    critDamage: 3,
    radar: 0,
    offline: 0.1,
    startCash: 0,
    comboWindow: 1.2,
    tap: 4,
    unlocked: new Set<BallTypeId>(["basic"]),
  };
  for (const s of SKILLS) {
    const r = ranks[s.id] ?? 0;
    if (!r) continue;
    const e = s.effect;
    switch (e.kind) {
      case "damage":
        m.damage += e.per * r;
        break;
      case "speed":
        m.speed += e.per * r;
        break;
      case "money":
        m.money += e.per * r;
        break;
      case "crit":
        m.crit += e.per * r;
        break;
      case "critDamage":
        m.critDamage += e.per * r;
        break;
      case "radar":
        m.radar = r;
        break;
      case "offline":
        m.offline += e.per * r;
        break;
      case "startCash":
        m.startCash += e.per * r;
        break;
      case "combo":
        m.comboWindow += e.per * r;
        break;
      case "tap":
        m.tap += e.per * r;
        break;
      case "unlock":
        m.unlocked.add(e.ball);
        break;
    }
  }
  return m;
}

export function canBuySkill(
  id: string,
  ranks: Record<string, number>,
  points: number,
): boolean {
  const s = SKILL_BY_ID[id];
  if (!s) return false;
  if ((ranks[id] ?? 0) >= s.ranks) return false;
  if (points < s.cost) return false;
  return s.requires.every((r) => (ranks[r] ?? 0) > 0);
}

/** Combo multiplier on money: +1% per chained break, capped at x3. */
export function comboMultiplier(combo: number): number {
  return Math.min(3, 1 + combo * 0.01);
}

export const MAX_OFFLINE_SECONDS = 8 * 3600;

export function offlineEarnings(
  incomePerSecond: number,
  seconds: number,
  offlinePct: number,
): number {
  if (seconds < 60 || incomePerSecond <= 0) return 0;
  return Math.floor(
    incomePerSecond * Math.min(seconds, MAX_OFFLINE_SECONDS) * offlinePct,
  );
}

export function formatNumber(n: number): string {
  if (n < 1000) return Math.floor(n).toString();
  const units = ["K", "M", "B", "T", "Qa", "Qi", "Sx"];
  let u = -1;
  let v = n;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return (
    (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + units[u]
  );
}
