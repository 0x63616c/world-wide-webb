import { tierHp } from "./economy";
import { EMPTY, GOLD, Grid, WALL } from "./grid";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(
  rng: () => number,
  w: number,
  h: number,
  scale: number,
): (x: number, y: number) => number {
  const gw = Math.ceil(w / scale) + 2;
  const gh = Math.ceil(h / scale) + 2;
  const g = new Float32Array(gw * gh).map(() => rng());
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / scale;
    const fy = y / scale;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = s(fx - ix);
    const ty = s(fy - iy);
    const v = (a: number, b: number) => g[(iy + b) * gw + ix + a];
    const top = v(0, 0) + (v(1, 0) - v(0, 0)) * tx;
    const bot = v(0, 1) + (v(1, 1) - v(0, 1)) * tx;
    return top + (bot - top) * ty;
  };
}

type Painter = (g: Grid, rng: () => number) => void;

export interface LevelDef {
  name: string;
  w: number;
  h: number;
  seed: number;
  density: number;
  paint: Painter;
  goldNearCenter?: boolean;
}

function thickLine(
  g: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t: number,
): void {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
  for (let s = 0; s <= steps; s++) {
    const x = x0 + ((x1 - x0) * s) / steps;
    const y = y0 + ((y1 - y0) * s) / steps;
    for (let dy = 0; dy < t; dy++)
      for (let dx = 0; dx < t; dx++)
        g.setWall(Math.round(x) + dx, Math.round(y) + dy);
  }
}

function ring(
  g: Grid,
  cx: number,
  cy: number,
  r: number,
  gaps: number,
  rot: number,
): void {
  const steps = Math.ceil(r * 8);
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * Math.PI * 2;
    const ga =
      (((a + rot) % ((Math.PI * 2) / gaps)) + Math.PI * 2) %
      ((Math.PI * 2) / gaps);
    if (ga < 0.35) continue;
    g.setWall(
      Math.round(cx + Math.cos(a) * r),
      Math.round(cy + Math.sin(a) * r),
    );
    g.setWall(
      Math.round(cx + Math.cos(a) * (r + 1)),
      Math.round(cy + Math.sin(a) * (r + 1)),
    );
  }
}

function jaggedRiver(
  g: Grid,
  rng: () => number,
  x: number,
  fromY: number,
  toY: number,
): void {
  let cx = x;
  for (let y = fromY; y < toY; y++) {
    cx += Math.round((rng() - 0.5) * 3);
    cx = Math.max(3, Math.min(g.w - 4, cx));
    if (rng() < 0.06) {
      y += 3; // a gap so balls can pass
      continue;
    }
    g.setWall(cx, y);
    g.setWall(cx + 1, y);
  }
}

export const LEVELS: LevelDef[] = [
  {
    name: "First Light",
    w: 56,
    h: 34,
    seed: 11,
    density: 0.5,
    paint: (g, rng) => {
      jaggedRiver(g, rng, 14, 1, 24);
      jaggedRiver(g, rng, 40, 10, 33);
    },
  },
  {
    name: "Twin Rivers",
    w: 72,
    h: 44,
    seed: 23,
    density: 0.46,
    paint: (g) => {
      for (let x = 2; x < g.w - 2; x++) {
        if (x % 22 < 4) continue;
        const y1 = Math.round(g.h * 0.33 + Math.sin(x / 6) * 4);
        const y2 = Math.round(g.h * 0.66 + Math.cos(x / 7) * 4);
        g.setWall(x, y1);
        g.setWall(x, y1 + 1);
        if ((x + 11) % 22 >= 4) {
          g.setWall(x, y2);
          g.setWall(x, y2 + 1);
        }
      }
    },
  },
  {
    name: "The Ring",
    w: 90,
    h: 56,
    seed: 37,
    density: 0.5,
    paint: (g) => {
      ring(g, g.w / 2, g.h / 2, 20, 4, 0.4);
      ring(g, g.w / 2, g.h / 2, 9, 3, 1.1);
    },
    goldNearCenter: true,
  },
  {
    name: "Pillars",
    w: 112,
    h: 68,
    seed: 41,
    density: 0.52,
    paint: (g) => {
      for (let y = 10; y < g.h - 6; y += 14) {
        for (let x = 10; x < g.w - 6; x += 16) {
          const off = (y / 14) % 2 ? 8 : 0;
          for (let dy = 0; dy < 4; dy++)
            for (let dx = 0; dx < 4; dx++) g.setWall(x + off + dx, y + dy);
        }
      }
    },
  },
  {
    name: "Spiral",
    w: 134,
    h: 82,
    seed: 53,
    density: 0.55,
    paint: (g) => {
      const cx = g.w / 2;
      const cy = g.h / 2;
      let px = cx;
      let py = cy;
      for (let a = 0.6; a < Math.PI * 9; a += 0.04) {
        const r = 2.6 * a;
        const x = cx + Math.cos(a) * r * 1.35;
        const y = cy + Math.sin(a) * r;
        if (Math.floor(a * 1.6) % 7 !== 0) thickLine(g, px, py, x, y, 2);
        px = x;
        py = y;
      }
    },
    goldNearCenter: true,
  },
  {
    name: "Labyrinth",
    w: 160,
    h: 98,
    seed: 67,
    density: 0.56,
    paint: (g, rng) => {
      const step = 12;
      for (let y = step; y < g.h - 4; y += step) {
        for (let x = step; x < g.w - 4; x += step) {
          if (rng() < 0.5)
            thickLine(g, x, y, x + step * (rng() < 0.5 ? 1 : -1) * 0.7, y, 2);
          else
            thickLine(g, x, y, x, y + step * (rng() < 0.5 ? 1 : -1) * 0.7, 2);
        }
      }
    },
  },
  {
    name: "The Core",
    w: 190,
    h: 116,
    seed: 79,
    density: 0.6,
    paint: (g) => {
      for (let r = 10, k = 0; r < 54; r += 11, k++)
        ring(g, g.w / 2, g.h / 2, r, 3 + k, k * 0.9);
      thickLine(g, 6, 6, 40, 30, 2);
      thickLine(g, g.w - 7, g.h - 7, g.w - 41, g.h - 31, 2);
    },
    goldNearCenter: true,
  },
];

export const FINAL_LEVEL = LEVELS.length;

/** Levels past the hand-made campaign are seeded remixes. */
export function levelDef(level: number): LevelDef {
  if (level <= LEVELS.length) return LEVELS[level - 1];
  const base = LEVELS[(level - 1) % LEVELS.length];
  return {
    ...base,
    name: `Endless ${level - LEVELS.length}`,
    seed: base.seed * 31 + level,
    w: 190,
    h: 116,
    density: 0.62,
  };
}

export interface BuiltLevel {
  grid: Grid;
  spawnX: number;
  spawnY: number;
  def: LevelDef;
}

export function buildLevel(level: number): BuiltLevel {
  const def = levelDef(level);
  const rng = mulberry32(def.seed);
  const g = new Grid(def.w, def.h);
  const shape = valueNoise(rng, def.w, def.h, 7);
  const hard = valueNoise(rng, def.w, def.h, 11);
  const detail = valueNoise(rng, def.w, def.h, 2.5);
  const maxTier = Math.min(4, level);
  const spawnX = Math.floor(def.w * 0.12) + 2;
  const spawnY = Math.floor(def.h * 0.5);
  for (let y = 0; y < def.h; y++) {
    for (let x = 0; x < def.w; x++) {
      if (x === 0 || y === 0 || x === def.w - 1 || y === def.h - 1) {
        g.setWall(x, y);
        continue;
      }
      if (Math.hypot(x - spawnX, y - spawnY) < 5) continue;
      const v = shape(x, y) * 0.75 + detail(x, y) * 0.25;
      if (v < 1 - def.density) continue;
      const depth = Math.min(
        1,
        Math.hypot(x - spawnX, y - spawnY) / Math.hypot(def.w, def.h),
      );
      const t = Math.max(
        0,
        Math.min(
          maxTier,
          Math.floor((hard(x, y) * 0.7 + depth * 0.6) * (maxTier + 1) - 0.3),
        ),
      );
      g.setPixel(x, y, t, tierHp(t, level));
    }
  }
  // A ring of soft pixels around the spawn so the first ball gets going straight away.
  for (let y = spawnY - 9; y <= spawnY + 9; y++) {
    for (let x = spawnX - 9; x <= spawnX + 9; x++) {
      const d = Math.hypot(x - spawnX, y - spawnY);
      if (
        d > 4 &&
        d < 9 &&
        g.inside(x, y) &&
        g.kind[g.idx(x, y)] === EMPTY &&
        rng() < 0.85
      )
        g.setPixel(x, y, 0, tierHp(0, level));
    }
  }
  def.paint(g, rng);
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) g.setEmpty(spawnX + dx, spawnY + dy);

  // Cells the spawn cannot reach (walls only block) become wall, so every pixel is winnable.
  const seen = new Uint8Array(def.w * def.h);
  const stack = [g.idx(spawnX, spawnY)];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % def.w;
    const y = (i / def.w) | 0;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (!g.inside(nx, ny)) continue;
      const j = g.idx(nx, ny);
      if (seen[j] || g.kind[j] === WALL) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  const candidates: number[] = [];
  for (let i = 0; i < def.w * def.h; i++) {
    if (g.kind[i] === WALL) continue;
    if (!seen[i]) {
      g.setWall(i % def.w, (i / def.w) | 0);
      continue;
    }
    if (g.kind[i] === EMPTY || g.exposed(i)) continue;
    const x = i % def.w;
    const y = (i / def.w) | 0;
    const far = Math.hypot(x - spawnX, y - spawnY) / Math.hypot(def.w, def.h);
    const nearCenter =
      Math.hypot(x - def.w / 2, y - def.h / 2) < Math.min(def.w, def.h) * 0.12;
    if (def.goldNearCenter ? nearCenter : far > 0.45) candidates.push(i);
  }
  if (candidates.length === 0) {
    for (let i = 0; i < def.w * def.h; i++)
      if (g.breakable(i)) candidates.push(i);
  }
  const gi = candidates[Math.floor(rng() * candidates.length)];
  g.kind[gi] = GOLD;
  g.tier[gi] = maxTier;
  g.hp[gi] = g.maxHp[gi] = tierHp(4, level) * 3;
  g.golden = gi;
  return { grid: g, spawnX: spawnX + 0.5, spawnY: spawnY + 0.5, def };
}
