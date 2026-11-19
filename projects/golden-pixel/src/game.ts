import {
  BALL_BY_ID,
  BALL_RADIUS,
  BALL_TYPES,
  SKILL_BY_ID,
  type BallTypeId,
  type StatId,
} from "./config";
import {
  ballCost,
  canBuySkill,
  canSpecialize,
  comboMultiplier,
  offlineEarnings,
  skillMods,
  skillPointsForClear,
  starsForPrestige,
  tierValue,
  upgradeCost,
  type BallProgress,
  type Mods,
} from "./economy";
import { EMPTY, GOLD, WALL, type Grid } from "./grid";
import { buildLevel, FINAL_LEVEL, mulberry32, type LevelDef } from "./levels";

export interface Settings {
  sound: number;
  music: number;
  effects: number;
  crt: boolean;
  /** Set once the player has touched the CRT toggle; older saves default to off. */
  crtChosen?: boolean;
}

export interface SaveData {
  version: 1;
  money: number;
  lifetimeEarned: number;
  runEarned: number;
  level: number;
  maxLevel: number;
  won: boolean;
  balls: Record<BallTypeId, BallProgress>;
  skillRanks: Record<string, number>;
  skillPoints: number;
  stars: number;
  prestiges: number;
  incomeRate: number;
  lastSeen: number;
  settings: Settings;
  gridKind?: string;
  gridHp?: string;
  gridLevel?: number;
}

export type GameEvent =
  | {
      t: "hit";
      x: number;
      y: number;
      tier: number;
      crit: boolean;
      broke: boolean;
      color: string;
      gold: boolean;
      dmg: number;
    }
  | { t: "wall"; x: number; y: number; color: string }
  | { t: "zap"; pts: number[]; color: string }
  | { t: "blast"; x: number; y: number; r: number; color: string }
  | { t: "money"; x: number; y: number; amount: number }
  | { t: "level-clear"; level: number; sp: number; name: string }
  | { t: "level-start"; level: number; name: string }
  | { t: "win" }
  | { t: "combo"; n: number }
  | { t: "milestone"; amount: number }
  | { t: "buy"; ball: BallTypeId }
  | { t: "upgrade"; ball: BallTypeId }
  | { t: "unlock"; name: string }
  | { t: "spec"; ball: BallTypeId; name: string }
  | { t: "skill"; id: string }
  | { t: "prestige"; stars: number }
  | { t: "hitstop"; s: number };

export interface Ball {
  type: BallTypeId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail: Float32Array;
  trailHead: number;
  squash: number;
  squashAngle: number;
  phase: number;
  phaseCd: number;
  cd: number;
  lastCell: number;
}

export const TRAIL_LEN = 14;

export function defaultSettings(): Settings {
  return { sound: 0.7, music: 0.45, effects: 1, crt: false };
}

export function newSave(): SaveData {
  const balls = {} as Record<BallTypeId, BallProgress>;
  for (const t of BALL_TYPES)
    balls[t.id] = {
      owned: t.id === "basic" ? 1 : 0,
      speed: 0,
      damage: 0,
      special: 0,
      spec: null,
    };
  return {
    version: 1,
    money: 0,
    lifetimeEarned: 0,
    runEarned: 0,
    level: 1,
    maxLevel: 1,
    won: false,
    balls,
    skillRanks: {},
    skillPoints: 0,
    stars: 0,
    prestiges: 0,
    incomeRate: 0,
    lastSeen: Date.now(),
    settings: defaultSettings(),
  };
}

const MONEY_MILESTONES = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12];
const COMBO_MILESTONES = [25, 50, 100, 250, 500, 1000, 2500];
const MAX_BALLS_PER_TYPE = 400;

function encode(a: Uint8Array): string {
  let s = "";
  for (let i = 0; i < a.length; i += 0x8000)
    s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}

function decode(s: string): Uint8Array {
  const b = atob(s);
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}

export class Game {
  s: SaveData;
  grid!: Grid;
  def!: LevelDef;
  spawnX = 0;
  spawnY = 0;
  balls: Ball[] = [];
  mods!: Mods;
  events: GameEvent[] = [];
  dirty: number[] = [];
  levelSerial = 0;
  combo = 0;
  comboTimer = 0;
  bestCombo = 0;
  hitStop = 0;
  private hitStopCooldown = 0;
  phase: "playing" | "clearing" = "playing";
  phaseTimer = 0;
  time = 0;
  private earnedWindow = 0;
  private windowTime = 0;
  private rng = mulberry32(Date.now() & 0xffffffff);

  constructor(save?: SaveData) {
    this.s = save ?? newSave();
    this.refreshMods();
    const resumed =
      this.s.gridLevel === this.s.level && this.s.gridKind && this.s.gridHp;
    this.loadLevel(this.s.level, false);
    if (resumed) this.restoreGrid();
  }

  refreshMods(): void {
    this.mods = skillMods(this.s.skillRanks, this.s.stars);
  }

  loadLevel(level: number, startCash: boolean): void {
    const built = buildLevel(level);
    this.grid = built.grid;
    this.def = built.def;
    this.spawnX = built.spawnX;
    this.spawnY = built.spawnY;
    this.s.level = level;
    this.s.maxLevel = Math.max(this.s.maxLevel, level);
    this.levelSerial++;
    this.dirty.length = 0;
    if (startCash && this.mods.startCash > 0)
      this.earn(this.mods.startCash, -1, -1);
    this.respawnBalls();
    this.events.push({ t: "level-start", level, name: this.def.name });
  }

  private restoreGrid(): void {
    const kind = decode(this.s.gridKind!);
    const hp = decode(this.s.gridHp!);
    const g = this.grid;
    if (kind.length !== g.kind.length) return;
    let left = 0;
    for (let i = 0; i < kind.length; i++) {
      if (g.kind[i] === WALL) continue;
      if (kind[i] === EMPTY) {
        g.kind[i] = EMPTY;
        g.hp[i] = 0;
      } else {
        g.hp[i] = Math.max(g.maxHp[i] * (hp[i] / 255), g.maxHp[i] * 0.01);
        left++;
      }
    }
    g.pixelsLeft = left;
    this.levelSerial++;
  }

  serialize(): SaveData {
    const g = this.grid;
    const kind = new Uint8Array(g.kind.length);
    const hp = new Uint8Array(g.kind.length);
    for (let i = 0; i < kind.length; i++) {
      kind[i] = g.kind[i];
      hp[i] = g.maxHp[i] > 0 ? Math.round((g.hp[i] / g.maxHp[i]) * 255) : 0;
    }
    return {
      ...this.s,
      lastSeen: Date.now(),
      gridKind: encode(kind),
      gridHp: encode(hp),
      gridLevel: this.s.level,
    };
  }

  /** Money owed for time away; also applied to the balance. */
  claimOffline(now: number): { seconds: number; amount: number } {
    const seconds = Math.max(0, (now - this.s.lastSeen) / 1000);
    const amount = offlineEarnings(
      this.s.incomeRate,
      seconds,
      this.mods.offline,
    );
    if (amount > 0) this.earn(amount, -1, -1);
    this.s.lastSeen = now;
    return { seconds, amount };
  }

  totalBalls(): number {
    return this.balls.length;
  }

  respawnBalls(): void {
    this.balls = [];
    for (const t of BALL_TYPES)
      for (let n = 0; n < this.s.balls[t.id].owned; n++) this.spawnBall(t.id);
  }

  spawnBall(type: BallTypeId): void {
    const a = this.rng() * Math.PI * 2;
    const trail = new Float32Array(TRAIL_LEN * 2);
    for (let i = 0; i < TRAIL_LEN; i++) {
      trail[i * 2] = this.spawnX;
      trail[i * 2 + 1] = this.spawnY;
    }
    this.balls.push({
      type,
      x: this.spawnX + (this.rng() - 0.5),
      y: this.spawnY + (this.rng() - 0.5),
      vx: Math.cos(a),
      vy: Math.sin(a),
      trail,
      trailHead: 0,
      squash: 0,
      squashAngle: 0,
      phase: 0,
      phaseCd: 2 + this.rng() * 2,
      cd: 0,
      lastCell: -1,
    });
  }

  // ---------- economy actions ----------

  ballPrice(type: BallTypeId): number {
    const p = this.s.balls[type];
    return ballCost(type, p.owned, p.spec);
  }

  buyBall(type: BallTypeId): boolean {
    if (!this.mods.unlocked.has(type)) return false;
    const p = this.s.balls[type];
    if (p.owned >= MAX_BALLS_PER_TYPE) return false;
    const price = this.ballPrice(type);
    if (this.s.money < price) return false;
    this.s.money -= price;
    p.owned++;
    this.spawnBall(type);
    this.events.push({ t: "buy", ball: type });
    return true;
  }

  upgradePrice(type: BallTypeId, stat: StatId): number | null {
    return upgradeCost(type, stat, this.s.balls[type][stat]);
  }

  buyUpgrade(type: BallTypeId, stat: StatId): boolean {
    const price = this.upgradePrice(type, stat);
    if (price === null || this.s.money < price || !this.mods.unlocked.has(type))
      return false;
    this.s.money -= price;
    this.s.balls[type][stat]++;
    this.events.push({ t: "upgrade", ball: type });
    return true;
  }

  specialize(type: BallTypeId, spec: string): boolean {
    const p = this.s.balls[type];
    if (!canSpecialize(p) || !BALL_BY_ID[type].specs.some((x) => x.id === spec))
      return false;
    p.spec = spec;
    this.events.push({
      t: "spec",
      ball: type,
      name: BALL_BY_ID[type].specs.find((x) => x.id === spec)!.name,
    });
    return true;
  }

  buySkill(id: string): boolean {
    if (!canBuySkill(id, this.s.skillRanks, this.s.skillPoints)) return false;
    const node = SKILL_BY_ID[id];
    this.s.skillPoints -= node.cost;
    this.s.skillRanks[id] = (this.s.skillRanks[id] ?? 0) + 1;
    this.refreshMods();
    this.events.push({ t: "skill", id });
    if (node.effect.kind === "unlock")
      this.events.push({ t: "unlock", name: node.name });
    return true;
  }

  prestigeStars(): number {
    return starsForPrestige(this.s.runEarned, this.s.maxLevel);
  }

  prestige(): boolean {
    const stars = this.prestigeStars();
    if (stars <= 0) return false;
    const fresh = newSave();
    fresh.lifetimeEarned = this.s.lifetimeEarned;
    fresh.skillRanks = this.s.skillRanks;
    fresh.skillPoints = this.s.skillPoints;
    fresh.stars = this.s.stars + stars;
    fresh.prestiges = this.s.prestiges + 1;
    fresh.settings = this.s.settings;
    fresh.won = this.s.won;
    fresh.maxLevel = this.s.maxLevel;
    this.s = fresh;
    this.refreshMods();
    this.loadLevel(1, true);
    this.events.push({ t: "prestige", stars });
    return true;
  }

  // ---------- stats ----------

  ballSpeed(type: BallTypeId): number {
    const p = this.s.balls[type];
    let v = BALL_BY_ID[type].speed * (1 + 0.1 * p.speed) * this.mods.speed;
    if (p.spec === "blur") v *= 1.6;
    return Math.min(v, 60);
  }

  ballDamage(type: BallTypeId): number {
    const p = this.s.balls[type];
    let d =
      BALL_BY_ID[type].damage * Math.pow(1.3, p.damage) * this.mods.damage;
    if (p.spec === "veteran") d *= 3;
    if (p.spec === "wrecking") d *= 3;
    if (p.spec === "marksman") d *= 2;
    return d;
  }

  special(type: BallTypeId): number {
    const sp = BALL_BY_ID[type].special;
    return sp.base + sp.perLevel * this.s.balls[type].special;
  }

  // ---------- simulation ----------

  update(dt: number): void {
    this.time += dt;
    this.hitStopCooldown -= dt;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }
    this.windowTime += dt;
    if (this.windowTime >= 5) {
      const rate = this.earnedWindow / this.windowTime;
      this.s.incomeRate = this.s.incomeRate * 0.7 + rate * 0.3;
      this.earnedWindow = 0;
      this.windowTime = 0;
    }
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (this.phase === "clearing") {
      this.phaseTimer -= dt;
      dt *= 0.15;
      if (this.phaseTimer <= 0) this.advance();
    }
    for (const b of this.balls) this.stepBall(b, dt);
  }

  private advance(): void {
    this.phase = "playing";
    const next = this.s.level + 1;
    if (this.s.level === FINAL_LEVEL && !this.s.won) {
      this.s.won = true;
      this.events.push({ t: "win" });
    }
    this.loadLevel(next, true);
  }

  private stepBall(b: Ball, dt: number): void {
    const speed = this.ballSpeed(b.type);
    const len = Math.hypot(b.vx, b.vy) || 1;
    b.vx /= len;
    b.vy /= len;
    b.cd -= dt;
    b.squash = Math.max(0, b.squash - dt * 6);
    if (b.type === "ghost") this.ghostTimers(b, dt);
    const dist = speed * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.3));
    const h = dist / steps;
    for (let s = 0; s < steps; s++) {
      if (b.phase > 0) this.phaseMove(b, h);
      else this.solidMove(b, h);
    }
    b.trailHead = (b.trailHead + 1) % TRAIL_LEN;
    b.trail[b.trailHead * 2] = b.x;
    b.trail[b.trailHead * 2 + 1] = b.y;
  }

  private ghostTimers(b: Ball, dt: number): void {
    if (b.phase > 0) {
      b.phase -= dt;
      if (b.phase <= 0 && this.grid.solidAt(Math.floor(b.x), Math.floor(b.y)))
        b.phase = 0.05;
      if (b.phase < 0) b.phase = 0;
    } else {
      b.phaseCd -= dt;
      if (b.phaseCd <= 0) {
        b.phase = this.special("ghost");
        b.phaseCd = this.s.balls.ghost.spec === "poltergeist" ? 1.5 : 3;
      }
    }
  }

  private phaseMove(b: Ball, h: number): void {
    const g = this.grid;
    let nx = b.x + b.vx * h;
    let ny = b.y + b.vy * h;
    if (nx < 1 + BALL_RADIUS || nx > g.w - 1 - BALL_RADIUS) {
      b.vx = -b.vx;
      nx = b.x;
    }
    if (ny < 1 + BALL_RADIUS || ny > g.h - 1 - BALL_RADIUS) {
      b.vy = -b.vy;
      ny = b.y;
    }
    b.x = nx;
    b.y = ny;
    const i = g.idx(Math.floor(nx), Math.floor(ny));
    if (i !== b.lastCell) {
      b.lastCell = i;
      if (g.breakable(i)) {
        const mult = this.s.balls.ghost.spec === "wraith" ? 3 : 1;
        this.hitCell(b, i, this.ballDamage("ghost") * mult);
      }
    }
  }

  private probe(x: number, y: number, ax: boolean, sign: number): number {
    const g = this.grid;
    const r = BALL_RADIUS;
    const o = r * 0.7;
    const pts = ax
      ? [
          [x + sign * r, y],
          [x + sign * r, y - o],
          [x + sign * r, y + o],
        ]
      : [
          [x, y + sign * r],
          [x - o, y + sign * r],
          [x + o, y + sign * r],
        ];
    for (const [px, py] of pts) {
      const cx = Math.floor(px);
      const cy = Math.floor(py);
      if (!g.inside(cx, cy)) return -2;
      const i = g.idx(cx, cy);
      if (g.kind[i] !== EMPTY) return i;
    }
    return -1;
  }

  private solidMove(b: Ball, h: number): void {
    const nx = b.x + b.vx * h;
    const cx = this.probe(nx, b.y, true, Math.sign(b.vx));
    if (cx === -1 || this.collide(b, cx)) b.x = nx;
    else this.bounce(b, true);
    const ny = b.y + b.vy * h;
    const cy = this.probe(b.x, ny, false, Math.sign(b.vy));
    if (cy === -1 || this.collide(b, cy)) b.y = ny;
    else this.bounce(b, false);
  }

  /** Returns true when the ball passes through (pierce), false when it bounces. */
  private collide(b: Ball, i: number): boolean {
    const g = this.grid;
    if (i < 0 || g.kind[i] === WALL) {
      if (i >= 0 && this.rng() < 0.25)
        this.events.push({ t: "wall", x: b.x, y: b.y, color: "" });
      return false;
    }
    const dmg = this.ballDamage(b.type);
    const broke = this.hitCell(b, i, dmg);
    if (broke && b.type === "heavy") {
      const pierce =
        this.s.balls.heavy.spec === "juggernaut"
          ? Infinity
          : this.special("heavy");
      if (b.lastCell < pierce) {
        b.lastCell = Math.max(0, b.lastCell) + 1;
        return true;
      }
    }
    return false;
  }

  private bounce(b: Ball, xAxis: boolean): void {
    if (xAxis) b.vx = -b.vx;
    else b.vy = -b.vy;
    // A little angle noise keeps balls from settling into loops.
    let a = Math.atan2(b.vy, b.vx) + (this.rng() - 0.5) * 0.3;
    // Keep away from near-axis angles, which make balls shuttle back and forth.
    const q = ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (q < 0.2) a += 0.2 - q;
    else if (q > Math.PI / 2 - 0.2) a -= q - (Math.PI / 2 - 0.2);
    b.vx = Math.cos(a);
    b.vy = Math.sin(a);
    b.squash = 1;
    b.squashAngle = xAxis ? 0 : Math.PI / 2;
    if (b.type === "heavy") b.lastCell = 0;
    if (b.type === "sniper") {
      const range = Math.round(
        this.special("sniper") *
          (this.s.balls.sniper.spec === "seeker" ? 2 : 1),
      );
      const t = this.grid.nearestBreakable(
        b.x,
        b.y,
        range,
        this.s.balls.sniper.spec === "seeker",
      );
      if (t >= 0) {
        const tx = (t % this.grid.w) + 0.5;
        const ty = ((t / this.grid.w) | 0) + 0.5;
        const d = Math.hypot(tx - b.x, ty - b.y) || 1;
        b.vx = (tx - b.x) / d;
        b.vy = (ty - b.y) / d;
      }
    }
  }

  /** Applies one ball hit including its type's special. Returns whether the cell broke. */
  hitCell(b: Ball | null, i: number, baseDmg: number): boolean {
    const type = b?.type ?? "basic";
    let critChance = this.mods.crit;
    if (b) {
      if (type === "basic") critChance += this.special("basic");
      if (this.s.balls[type].spec === "marksman") critChance += 0.25;
    }
    const crit = this.rng() < critChance;
    let dmg = baseDmg * (crit ? this.mods.critDamage : 1);
    if (b && type === "fast") {
      const chance =
        this.special("fast") * (this.s.balls.fast.spec === "flurry" ? 2 : 1);
      if (this.rng() < chance)
        dmg *= this.s.balls.fast.spec === "flurry" && this.rng() < 0.3 ? 3 : 2;
    }
    const broke = this.damageCell(i, dmg, crit, b ? b.type : null);
    if (b && b.cd <= 0) {
      if (type === "lightning") this.chain(b, i);
      if (type === "bomb") this.blast(b, i);
    }
    return broke;
  }

  damageCell(
    i: number,
    dmg: number,
    crit: boolean,
    source: BallTypeId | null,
  ): boolean {
    const g = this.grid;
    if (!g.breakable(i)) return false;
    const gold = g.kind[i] === GOLD;
    const tier = g.tier[i];
    const before = g.crackStage(i);
    const broke = g.damage(i, dmg);
    const x = (i % g.w) + 0.5;
    const y = ((i / g.w) | 0) + 0.5;
    this.events.push({
      t: "hit",
      x,
      y,
      tier,
      crit,
      broke,
      color: source ?? "basic",
      gold,
      dmg,
    });
    if (broke) {
      this.dirty.push(i);
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.comboTimer = this.mods.comboWindow;
      if (COMBO_MILESTONES.includes(this.combo))
        this.events.push({ t: "combo", n: this.combo });
      const value =
        tierValue(tier, this.s.level) *
        (gold ? 50 : 1) *
        this.mods.money *
        comboMultiplier(this.combo);
      this.earn(value, x, y);
      if (gold) this.clearLevel();
      else if (crit && tier >= 3) this.requestHitStop(0.05);
    } else {
      if (g.crackStage(i) !== before) this.dirty.push(i);
      if (gold) this.requestHitStop(0.04);
    }
    return broke;
  }

  requestHitStop(s: number): void {
    if (this.hitStopCooldown > 0) return;
    const scaled = s * this.s.settings.effects;
    if (scaled <= 0.005) return;
    this.hitStop = scaled;
    this.hitStopCooldown = 0.6;
    this.events.push({ t: "hitstop", s: scaled });
  }

  private earn(amount: number, x: number, y: number): void {
    const prev = this.s.lifetimeEarned;
    this.s.money += amount;
    this.s.lifetimeEarned += amount;
    this.s.runEarned += amount;
    this.earnedWindow += amount;
    if (x >= 0 && amount >= tierValue(3, this.s.level))
      this.events.push({ t: "money", x, y, amount });
    for (const m of MONEY_MILESTONES)
      if (prev < m && this.s.lifetimeEarned >= m)
        this.events.push({ t: "milestone", amount: m });
  }

  private chain(b: Ball, from: number): void {
    const g = this.grid;
    const spec = this.s.balls.lightning.spec;
    const n = Math.round(
      this.special("lightning") + (spec === "storm" ? 4 : 0),
    );
    const range = 4 * (spec === "storm" ? 1.5 : 1);
    const dmg =
      this.ballDamage("lightning") * 0.6 * (spec === "overcharge" ? 2.5 : 1);
    let cx = from % g.w;
    let cy = (from / g.w) | 0;
    const pts = [cx + 0.5, cy + 0.5];
    const r = Math.ceil(range);
    for (let k = 0; k < n; k++) {
      let pick = -1;
      for (let tries = 0; tries < 14 && pick < 0; tries++) {
        const x = cx + Math.round((this.rng() * 2 - 1) * r);
        const y = cy + Math.round((this.rng() * 2 - 1) * r);
        if (!g.inside(x, y)) continue;
        const j = g.idx(x, y);
        if (j !== from && g.breakable(j)) pick = j;
      }
      if (pick < 0) break;
      cx = pick % g.w;
      cy = (pick / g.w) | 0;
      pts.push(cx + 0.5, cy + 0.5);
      this.damageCell(pick, dmg, false, "lightning");
    }
    if (pts.length > 2) this.events.push({ t: "zap", pts, color: "lightning" });
    b.cd = 0.12;
  }

  private blast(b: Ball, at: number): void {
    const spec = this.s.balls.bomb.spec;
    const radius = this.special("bomb") * (spec === "nuke" ? 1.6 : 1);
    const g = this.grid;
    const x = (at % g.w) + 0.5;
    const y = ((at / g.w) | 0) + 0.5;
    const dmg = this.ballDamage("bomb");
    const kills = this.explode(x, y, radius, dmg);
    if (spec === "cluster") {
      for (let k = 0; k < 3; k++) {
        const a = this.rng() * Math.PI * 2;
        this.explode(
          x + Math.cos(a) * radius,
          y + Math.sin(a) * radius,
          radius * 0.55,
          dmg * 0.6,
        );
      }
    }
    if (kills >= 10) this.requestHitStop(0.06);
    b.cd = 0.3;
  }

  private explode(x: number, y: number, r: number, dmg: number): number {
    const g = this.grid;
    let kills = 0;
    this.events.push({ t: "blast", x, y, r, color: "bomb" });
    for (let cy = Math.floor(y - r); cy <= Math.ceil(y + r); cy++) {
      for (let cx = Math.floor(x - r); cx <= Math.ceil(x + r); cx++) {
        if (!g.inside(cx, cy)) continue;
        if (Math.hypot(cx + 0.5 - x, cy + 0.5 - y) > r) continue;
        const i = g.idx(cx, cy);
        if (g.breakable(i) && this.damageCell(i, dmg, false, "bomb")) kills++;
      }
    }
    return kills;
  }

  tap(x: number, y: number): void {
    const g = this.grid;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (!g.inside(cx, cy)) return;
    const i = g.idx(cx, cy);
    if (g.breakable(i))
      this.damageCell(i, this.mods.tap * this.mods.damage, false, null);
  }

  private clearLevel(): void {
    const sp = skillPointsForClear(this.s.level);
    this.s.skillPoints += sp;
    this.phase = "clearing";
    this.phaseTimer = 2.2;
    this.requestHitStop(0.12);
    this.events.push({
      t: "level-clear",
      level: this.s.level,
      sp,
      name: this.def.name,
    });
  }

  goldenPosition(): { x: number; y: number } | null {
    const g = this.grid;
    if (g.golden < 0 || !g.breakable(g.golden)) return null;
    return { x: (g.golden % g.w) + 0.5, y: ((g.golden / g.w) | 0) + 0.5 };
  }
}
