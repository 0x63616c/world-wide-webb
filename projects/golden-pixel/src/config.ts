export const GAME_NAME = "Golden Pixel";
export const SAVE_SLOT = "golden-pixel-save-v1";

/** Ball diameter is 0.64 of a grid cell; glow and trails extend beyond it. */
export const BALL_RADIUS = 0.32;

export type BallTypeId =
  "basic" | "fast" | "heavy" | "lightning" | "bomb" | "sniper" | "ghost";
export type StatId = "speed" | "damage" | "special";

export interface Specialization {
  id: string;
  name: string;
  text: string;
}

export interface BallType {
  id: BallTypeId;
  name: string;
  blurb: string;
  baseCost: number;
  costGrowth: number;
  speed: number; // cells per second
  damage: number;
  special: {
    name: string;
    base: number;
    perLevel: number;
    max: number;
    unit: string;
  };
  specs: [Specialization, Specialization];
}

export const BALL_TYPES: BallType[] = [
  {
    id: "basic",
    name: "Basic",
    blurb: "Reliable bouncer.",
    baseCost: 25,
    costGrowth: 1.15,
    speed: 9,
    damage: 1,
    special: {
      name: "Crit chance",
      base: 0,
      perLevel: 0.03,
      max: 10,
      unit: "%",
    },
    specs: [
      { id: "swarm", name: "Swarm", text: "Basic balls cost 40% less" },
      { id: "veteran", name: "Veteran", text: "Basic balls deal 3x damage" },
    ],
  },
  {
    id: "fast",
    name: "Fast",
    blurb: "Quick, light hits.",
    baseCost: 150,
    costGrowth: 1.17,
    speed: 17,
    damage: 1,
    special: { name: "Twin hit", base: 0, perLevel: 0.06, max: 10, unit: "%" },
    specs: [
      { id: "blur", name: "Blur", text: "+60% speed" },
      {
        id: "flurry",
        name: "Flurry",
        text: "Twin hit chance doubled and can triple-hit",
      },
    ],
  },
  {
    id: "heavy",
    name: "Heavy",
    blurb: "Big damage, pierces what it breaks.",
    baseCost: 500,
    costGrowth: 1.2,
    speed: 7,
    damage: 5,
    special: { name: "Pierce", base: 1, perLevel: 1, max: 10, unit: "" },
    specs: [
      { id: "juggernaut", name: "Juggernaut", text: "Unlimited pierce" },
      { id: "wrecking", name: "Wrecking Ball", text: "+200% damage" },
    ],
  },
  {
    id: "lightning",
    name: "Lightning",
    blurb: "Chains zaps to nearby pixels.",
    baseCost: 1200,
    costGrowth: 1.22,
    speed: 10,
    damage: 1.5,
    special: { name: "Chains", base: 2, perLevel: 1, max: 12, unit: "" },
    specs: [
      { id: "storm", name: "Storm", text: "+4 chains, +50% chain range" },
      { id: "overcharge", name: "Overcharge", text: "Chain damage x2.5" },
    ],
  },
  {
    id: "bomb",
    name: "Bomb",
    blurb: "Explodes on impact.",
    baseCost: 2500,
    costGrowth: 1.24,
    speed: 8,
    damage: 3,
    special: {
      name: "Blast radius",
      base: 1.3,
      perLevel: 0.22,
      max: 10,
      unit: "",
    },
    specs: [
      {
        id: "cluster",
        name: "Cluster",
        text: "Each blast throws 3 mini blasts",
      },
      { id: "nuke", name: "Nuke", text: "Blast radius x1.6" },
    ],
  },
  {
    id: "sniper",
    name: "Sniper",
    blurb: "Aims at the nearest pixel after every bounce.",
    baseCost: 5000,
    costGrowth: 1.26,
    speed: 14,
    damage: 4,
    special: { name: "Lock-on range", base: 8, perLevel: 3, max: 10, unit: "" },
    specs: [
      {
        id: "seeker",
        name: "Gold Seeker",
        text: "Hunts the golden pixel when it is in range",
      },
      { id: "marksman", name: "Marksman", text: "x2 damage and +25% crit" },
    ],
  },
  {
    id: "ghost",
    name: "Ghost",
    blurb: "Phases through walls and pixels.",
    baseCost: 12000,
    costGrowth: 1.3,
    speed: 9,
    damage: 3,
    special: {
      name: "Phase time",
      base: 0.8,
      perLevel: 0.2,
      max: 10,
      unit: "s",
    },
    specs: [
      { id: "poltergeist", name: "Poltergeist", text: "Phases twice as often" },
      { id: "wraith", name: "Wraith", text: "x3 damage while phasing" },
    ],
  },
];

export const BALL_BY_ID = Object.fromEntries(
  BALL_TYPES.map((b) => [b.id, b]),
) as Record<BallTypeId, BallType>;

export const STAT_MAX: Record<StatId, number> = {
  speed: 15,
  damage: 25,
  special: 10,
};
/** A ball type can pick a specialization once its upgrade levels add up to this. */
export const SPEC_MILESTONE = 10;

export type SkillEffect =
  | { kind: "damage"; per: number }
  | { kind: "speed"; per: number }
  | { kind: "money"; per: number }
  | { kind: "crit"; per: number }
  | { kind: "critDamage"; per: number }
  | { kind: "radar" }
  | { kind: "offline"; per: number }
  | { kind: "startCash"; per: number }
  | { kind: "combo"; per: number }
  | { kind: "tap"; per: number }
  | { kind: "unlock"; ball: BallTypeId };

export interface SkillNode {
  id: string;
  name: string;
  text: string;
  cost: number; // skill points per rank
  ranks: number;
  requires: string[];
  x: number; // layout, 0..1
  y: number;
  effect: SkillEffect;
}

export const SKILLS: SkillNode[] = [
  {
    id: "core",
    name: "Core",
    text: "+10% damage",
    cost: 1,
    ranks: 1,
    requires: [],
    x: 0.5,
    y: 0.5,
    effect: { kind: "damage", per: 0.1 },
  },
  {
    id: "sharp",
    name: "Sharpened",
    text: "+20% damage per rank",
    cost: 1,
    ranks: 5,
    requires: ["core"],
    x: 0.36,
    y: 0.38,
    effect: { kind: "damage", per: 0.2 },
  },
  {
    id: "momentum",
    name: "Momentum",
    text: "+10% ball speed per rank",
    cost: 1,
    ranks: 5,
    requires: ["core"],
    x: 0.64,
    y: 0.38,
    effect: { kind: "speed", per: 0.1 },
  },
  {
    id: "greed",
    name: "Greed",
    text: "+25% money per rank",
    cost: 1,
    ranks: 5,
    requires: ["core"],
    x: 0.5,
    y: 0.7,
    effect: { kind: "money", per: 0.25 },
  },
  {
    id: "u-fast",
    name: "Fast Ball",
    text: "Unlock the Fast ball",
    cost: 1,
    ranks: 1,
    requires: ["momentum"],
    x: 0.78,
    y: 0.26,
    effect: { kind: "unlock", ball: "fast" },
  },
  {
    id: "u-heavy",
    name: "Heavy Ball",
    text: "Unlock the Heavy ball",
    cost: 1,
    ranks: 1,
    requires: ["sharp"],
    x: 0.22,
    y: 0.26,
    effect: { kind: "unlock", ball: "heavy" },
  },
  {
    id: "u-lightning",
    name: "Lightning Ball",
    text: "Unlock the Lightning ball",
    cost: 2,
    ranks: 1,
    requires: ["sharp", "momentum"],
    x: 0.5,
    y: 0.2,
    effect: { kind: "unlock", ball: "lightning" },
  },
  {
    id: "u-bomb",
    name: "Bomb Ball",
    text: "Unlock the Bomb ball",
    cost: 2,
    ranks: 1,
    requires: ["u-heavy"],
    x: 0.1,
    y: 0.12,
    effect: { kind: "unlock", ball: "bomb" },
  },
  {
    id: "u-sniper",
    name: "Sniper Ball",
    text: "Unlock the Sniper ball",
    cost: 2,
    ranks: 1,
    requires: ["u-fast"],
    x: 0.9,
    y: 0.12,
    effect: { kind: "unlock", ball: "sniper" },
  },
  {
    id: "u-ghost",
    name: "Ghost Ball",
    text: "Unlock the Ghost ball",
    cost: 3,
    ranks: 1,
    requires: ["u-lightning"],
    x: 0.5,
    y: 0.05,
    effect: { kind: "unlock", ball: "ghost" },
  },
  {
    id: "crit",
    name: "Precision",
    text: "+4% crit chance per rank",
    cost: 1,
    ranks: 5,
    requires: ["sharp"],
    x: 0.18,
    y: 0.5,
    effect: { kind: "crit", per: 0.04 },
  },
  {
    id: "critdmg",
    name: "Brutal",
    text: "+50% crit damage per rank",
    cost: 2,
    ranks: 3,
    requires: ["crit"],
    x: 0.06,
    y: 0.38,
    effect: { kind: "critDamage", per: 0.5 },
  },
  {
    id: "combo",
    name: "Flow State",
    text: "+0.4s combo window per rank",
    cost: 1,
    ranks: 3,
    requires: ["momentum"],
    x: 0.82,
    y: 0.5,
    effect: { kind: "combo", per: 0.4 },
  },
  {
    id: "tap",
    name: "Finger of God",
    text: "Clicks deal +10 damage per rank",
    cost: 1,
    ranks: 5,
    requires: ["combo"],
    x: 0.94,
    y: 0.38,
    effect: { kind: "tap", per: 10 },
  },
  {
    id: "radar",
    name: "Gold Radar",
    text: "Each rank narrows a hint around the golden pixel",
    cost: 2,
    ranks: 3,
    requires: ["greed"],
    x: 0.66,
    y: 0.84,
    effect: { kind: "radar" },
  },
  {
    id: "offline",
    name: "Idle Engine",
    text: "+15% offline earnings per rank",
    cost: 1,
    ranks: 4,
    requires: ["greed"],
    x: 0.34,
    y: 0.84,
    effect: { kind: "offline", per: 0.15 },
  },
  {
    id: "cash",
    name: "Head Start",
    text: "+150 cash at each level start per rank",
    cost: 1,
    ranks: 5,
    requires: ["offline"],
    x: 0.18,
    y: 0.94,
    effect: { kind: "startCash", per: 150 },
  },
];

export const SKILL_BY_ID = Object.fromEntries(
  SKILLS.map((s) => [s.id, s]),
) as Record<string, SkillNode>;

/** Durability (hits at 1 damage) and payout of each colour tier on level 1. */
export const TIER_HP = [1, 2, 3, 4, 5];
export const TIER_VALUE = [1, 3, 7, 15, 32];
