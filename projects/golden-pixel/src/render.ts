import { BALL_RADIUS, type BallTypeId } from "./config";
import { TRAIL_LEN, type Game, type GameEvent } from "./game";
import { EMPTY, GOLD, WALL } from "./grid";
import { mulberry32 } from "./levels";
import { formatNumber as fmt } from "./economy";
import { PALETTE, rgba, shade } from "./palette";

const CELL = 8; // pixel-layer texels per grid cell
const MAX_PARTICLES = 1800;

interface Flash {
  x: number;
  y: number;
  t: number;
}
interface Light {
  x: number;
  y: number;
  r: number;
  t: number;
  life: number;
  color: string;
}
interface Zap {
  pts: number[];
  t: number;
}
interface FloatText {
  x: number;
  y: number;
  t: number;
  text: string;
  color: string;
  size: number;
}

const ease = {
  inOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  outBack: (t: number) => {
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private pix = document.createElement("canvas");
  private pctx: CanvasRenderingContext2D;
  private bloom = document.createElement("canvas");
  private bctx: CanvasRenderingContext2D;
  private scan: CanvasPattern | null = null;
  private glowSprites = new Map<string, HTMLCanvasElement>();
  private cracks: Path2D[][] = [];
  private serial = -1;
  private goldShown = false;
  w = 0;
  h = 0;
  dpr = 1;
  // camera
  scale = 1;
  camX = 0;
  camY = 0;
  private fit = { scale: 1, x: 0, y: 0 };
  private camAnim: {
    from: { scale: number; x: number; y: number };
    to: { scale: number; x: number; y: number };
    t: number;
    dur: number;
    kind: "in" | "out";
  } | null = null;
  private whiteFlash = 0;
  private shake = 0;
  // fx state
  private flashes: Flash[] = [];
  private lights: Light[] = [];
  private zaps: Zap[] = [];
  private texts: FloatText[] = [];
  private pX = new Float32Array(MAX_PARTICLES);
  private pY = new Float32Array(MAX_PARTICLES);
  private pVX = new Float32Array(MAX_PARTICLES);
  private pVY = new Float32Array(MAX_PARTICLES);
  private pLife = new Float32Array(MAX_PARTICLES);
  private pMax = new Float32Array(MAX_PARTICLES);
  private pSize = new Float32Array(MAX_PARTICLES);
  private pColor: string[] = new Array(MAX_PARTICLES).fill("#fff");
  private pCount = 0;
  private action = 0;
  private breaksThisFrame = 0;
  private radarOffset = { x: 0, y: 0 };
  // adaptive quality
  quality = 1;
  private frameEma = 16;
  private slowFor = 0;
  private fastFor = 0;
  effects = 1;
  crt = true;
  beatAt = -10;
  margins = { left: 120, top: 76, right: 96, bottom: 56 };

  constructor(
    private canvas: HTMLCanvasElement,
    private game: Game,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.pctx = this.pix.getContext("2d")!;
    this.bctx = this.bloom.getContext("2d")!;
    this.buildCracks();
    this.resize();
  }

  // ---------- setup ----------

  private buildCracks(): void {
    const rng = mulberry32(99);
    for (let v = 0; v < 4; v++) {
      const stages: Path2D[] = [];
      const segs: [number, number, number, number][] = [];
      let x = 1 + rng() * 6;
      let y = 0;
      for (let k = 0; k < 4; k++) {
        const nx = Math.max(0.5, Math.min(7.5, x + (rng() - 0.5) * 4));
        const ny = y + 2;
        segs.push([x, y, nx, ny]);
        x = nx;
        y = ny;
      }
      for (let k = 0; k < 4; k++) {
        const sx = rng() * 8;
        const sy = rng() * 8;
        segs.push([sx, sy, sx + (rng() - 0.5) * 5, sy + (rng() - 0.5) * 5]);
      }
      for (let stage = 1; stage <= 3; stage++) {
        const path = new Path2D();
        const n = stage === 1 ? 2 : stage === 2 ? 5 : 8;
        for (let k = 0; k < n; k++) {
          const [a, b, c, d] = segs[k];
          path.moveTo(a, b);
          path.lineTo(c, d);
        }
        stages.push(path);
      }
      this.cracks.push(stages);
    }
  }

  private glowSprite(color: string): HTMLCanvasElement {
    let c = this.glowSprites.get(color);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba(color, 0.9));
    grad.addColorStop(0.25, rgba(color, 0.35));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.glowSprites.set(color, c);
    return c;
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
    this.bloom.width = Math.max(1, Math.round(this.w / 4));
    this.bloom.height = Math.max(1, Math.round(this.h / 4));
    const s = document.createElement("canvas");
    s.width = 1;
    s.height = 3;
    const sg = s.getContext("2d")!;
    sg.fillStyle = "rgba(0,0,0,0.28)";
    sg.fillRect(0, 2, 1, 1);
    this.scan = this.ctx.createPattern(s, "repeat");
    this.computeFit();
    if (!this.camAnim) this.setCam(this.fit);
  }

  private computeFit(): void {
    const g = this.game.grid;
    const m = this.margins;
    const aw = Math.max(100, this.w - m.left - m.right);
    const ah = Math.max(100, this.h - m.top - m.bottom);
    const scale = Math.min(aw / g.w, ah / g.h);
    this.fit = {
      scale,
      x: g.w / 2 - (m.left - m.right) / 2 / scale,
      y: g.h / 2 - (m.top - m.bottom) / 2 / scale,
    };
  }

  private setCam(c: { scale: number; x: number; y: number }): void {
    this.scale = c.scale;
    this.camX = c.x;
    this.camY = c.y;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.w / 2) / this.scale + this.camX,
      y: (sy - this.h / 2) / this.scale + this.camY,
    };
  }

  // ---------- pixel layer ----------

  private rebuildPixels(): void {
    const g = this.game.grid;
    this.pix.width = g.w * CELL;
    this.pix.height = g.h * CELL;
    this.pctx.clearRect(0, 0, this.pix.width, this.pix.height);
    for (let i = 0; i < g.kind.length; i++)
      if (g.kind[i] !== EMPTY) this.drawCell(i);
    this.serial = this.game.levelSerial;
    this.goldShown = false;
    const rng = mulberry32(this.game.s.level * 7919);
    this.radarOffset = { x: (rng() - 0.5) * 2, y: (rng() - 0.5) * 2 };
    this.computeFit();
  }

  private drawCell(i: number): void {
    const g = this.game.grid;
    const p = this.pctx;
    const x = (i % g.w) * CELL;
    const y = ((i / g.w) | 0) * CELL;
    p.clearRect(x, y, CELL, CELL);
    const k = g.kind[i];
    if (k === EMPTY) return;
    if (k === WALL) {
      p.fillStyle = PALETTE.wall;
      p.fillRect(x, y, CELL, CELL);
      p.fillStyle = "rgba(255,255,255,0.9)";
      p.fillRect(x, y, CELL, 1);
      p.fillStyle = "rgba(0,0,0,0.12)";
      p.fillRect(x, y + CELL - 1, CELL, 1);
      return;
    }
    const showGold = k === GOLD && g.exposed(i);
    const base = showGold ? PALETTE.golden : PALETTE.tiers[g.tier[i]];
    const jitter = (((i * 2654435761) >>> 0) % 1000) / 1000;
    p.fillStyle = shade(base, (jitter - 0.5) * 0.16);
    p.fillRect(x, y, CELL, CELL);
    p.fillStyle = "rgba(255,255,255,0.28)";
    p.fillRect(x, y, CELL, 1);
    p.fillRect(x, y, 1, CELL);
    p.fillStyle = "rgba(0,0,0,0.32)";
    p.fillRect(x, y + CELL - 1, CELL, 1);
    p.fillRect(x + CELL - 1, y, 1, CELL);
    const stage = g.crackStage(i);
    if (stage > 0) {
      p.save();
      p.translate(x, y);
      p.strokeStyle = "rgba(0,0,0,0.75)";
      p.lineWidth = 0.9;
      p.stroke(this.cracks[(i * 7) % 4][stage - 1]);
      if (stage === 3) {
        p.fillStyle = "rgba(0,0,0,0.18)";
        p.fillRect(0, 0, CELL, CELL);
      }
      p.restore();
    }
  }

  // ---------- events ----------

  consume(events: GameEvent[]): void {
    const fx = this.effects;
    for (const e of events) {
      switch (e.t) {
        case "hit":
          if (this.flashes.length < 400 * this.quality)
            this.flashes.push({ x: e.x, y: e.y, t: 0.12 });
          if (e.broke) {
            this.breaksThisFrame++;
            const color = e.gold ? PALETTE.golden : PALETTE.tiers[e.tier];
            const n = Math.round((3 + e.tier) * fx * this.quality);
            this.spawnParticles(e.x, e.y, n, color, 5 + e.tier * 1.5, 0.5);
            if (e.gold) {
              this.spawnParticles(
                e.x,
                e.y,
                Math.round(140 * fx),
                PALETTE.golden,
                26,
                1.6,
              );
              this.lights.push({
                x: e.x,
                y: e.y,
                r: 30,
                t: 1.4,
                life: 1.4,
                color: PALETTE.golden,
              });
              this.shake = Math.max(this.shake, 14 * fx);
              this.whiteFlash = 0.5 * fx;
            }
          } else if (e.gold) {
            this.spawnParticles(
              e.x,
              e.y,
              Math.round(10 * fx),
              PALETTE.golden,
              9,
              0.6,
            );
            this.lights.push({
              x: e.x,
              y: e.y,
              r: 5,
              t: 0.25,
              life: 0.25,
              color: PALETTE.golden,
            });
          }
          if (e.crit && this.texts.length < 40 && Math.random() < 0.35) {
            this.texts.push({
              x: e.x,
              y: e.y,
              t: 0.6,
              text: "CRIT",
              color: PALETTE.highlight,
              size: 0.9,
            });
          }
          break;
        case "zap":
          if (this.zaps.length < 60 * this.quality)
            this.zaps.push({ pts: e.pts, t: 0.28 });
          if (this.lights.length < 80)
            this.lights.push({
              x: e.pts[0],
              y: e.pts[1],
              r: 4,
              t: 0.18,
              life: 0.18,
              color: PALETTE.balls.lightning,
            });
          break;
        case "blast":
          if (this.lights.length < 80)
            this.lights.push({
              x: e.x,
              y: e.y,
              r: e.r * 3.2,
              t: 0.35,
              life: 0.35,
              color: PALETTE.balls.bomb,
            });
          this.spawnParticles(
            e.x,
            e.y,
            Math.round(10 * fx * this.quality),
            PALETTE.balls.bomb,
            10 + e.r * 3,
            0.45,
          );
          this.shake = Math.max(this.shake, Math.min(6, e.r * 1.6) * fx);
          break;
        case "money":
          if (this.texts.length < 12)
            this.texts.push({
              x: e.x,
              y: e.y,
              t: 0.9,
              text: "+" + fmt(e.amount),
              color: PALETTE.textPrimary,
              size: 1.1,
            });
          break;
        case "level-clear":
          this.startZoomIn();
          break;
        case "level-start":
          this.rebuildPixels();
          this.startZoomOut();
          break;
        case "hitstop":
          this.shake = Math.max(this.shake, 5 * fx);
          break;
        default:
          break;
      }
    }
  }

  private lastGold = { x: 0, y: 0 };

  private startZoomIn(): void {
    const to = {
      scale: this.fit.scale * 2.2,
      x: this.lastGold.x,
      y: this.lastGold.y,
    };
    this.camAnim = {
      from: { scale: this.scale, x: this.camX, y: this.camY },
      to,
      t: 0,
      dur: 1.6,
      kind: "in",
    };
  }

  private startZoomOut(): void {
    this.computeFit();
    const from = { scale: this.fit.scale * 0.35, x: this.fit.x, y: this.fit.y };
    this.camAnim = { from, to: { ...this.fit }, t: 0, dur: 1.2, kind: "out" };
    this.whiteFlash = Math.max(this.whiteFlash, 0.6 * this.effects);
  }

  private spawnParticles(
    x: number,
    y: number,
    n: number,
    color: string,
    speed: number,
    life: number,
  ): void {
    const cap = Math.floor(MAX_PARTICLES * this.quality);
    for (let k = 0; k < n && this.pCount < cap; k++) {
      const i = this.pCount++;
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.pX[i] = x;
      this.pY[i] = y;
      this.pVX[i] = Math.cos(a) * v;
      this.pVY[i] = Math.sin(a) * v;
      this.pLife[i] = this.pMax[i] = life * (0.5 + Math.random() * 0.5);
      this.pSize[i] = 0.18 + Math.random() * 0.3;
      this.pColor[i] = color;
    }
  }

  // ---------- frame ----------

  frame(dt: number, frameMs: number): void {
    this.adaptQuality(frameMs, dt);
    const game = this.game;
    if (this.serial !== game.levelSerial) this.rebuildPixels();
    const g = game.grid;
    for (const i of game.dirty) this.drawCell(i);
    game.dirty.length = 0;
    const gp = game.goldenPosition();
    if (gp) {
      this.lastGold = gp;
      if (!this.goldShown && g.exposed(g.golden)) {
        this.goldShown = true;
        this.drawCell(g.golden);
      }
    }

    // camera
    if (this.camAnim) {
      const a = this.camAnim;
      a.t += dt;
      const t = Math.min(1, a.t / a.dur);
      const k = a.kind === "in" ? ease.inOutCubic(t) : ease.outBack(t);
      this.scale = a.from.scale + (a.to.scale - a.from.scale) * k;
      this.camX = a.from.x + (a.to.x - a.from.x) * k;
      this.camY = a.from.y + (a.to.y - a.from.y) * k;
      // A zoom-in holds on the golden pixel until the next level starts.
      if (t >= 1 && a.kind === "out") this.camAnim = null;
    } else {
      this.computeFit();
      this.setCam(this.fit);
    }

    this.action +=
      (Math.min(1, this.breaksThisFrame / Math.max(dt, 1e-3) / 120) -
        this.action) *
      Math.min(1, dt * 3);
    this.breaksThisFrame = 0;

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.background;
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawBackground();

    this.shake *= Math.pow(0.0025, dt);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    const s = this.scale;
    ctx.setTransform(
      this.dpr * s,
      0,
      0,
      this.dpr * s,
      this.dpr * (this.w / 2 - this.camX * s + sx),
      this.dpr * (this.h / 2 - this.camY * s + sy),
    );

    // floor
    ctx.fillStyle = PALETTE.panels[0];
    ctx.fillRect(0, 0, g.w, g.h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.pix, 0, 0, g.w, g.h);

    ctx.globalCompositeOperation = "lighter";
    this.drawLights(dt);
    this.drawFlashes(dt);
    this.drawTrails();
    this.drawZaps(dt);
    this.drawParticles(dt);
    this.drawGolden(gp);
    ctx.globalCompositeOperation = "source-over";
    this.drawBalls();
    this.drawTexts(dt);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBloom();
    if (this.whiteFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.whiteFlash})`;
      ctx.fillRect(0, 0, this.w, this.h);
      this.whiteFlash = Math.max(0, this.whiteFlash - dt * 1.4);
    }
    if (this.crt) this.drawCrt();
  }

  private adaptQuality(frameMs: number, dt: number): void {
    this.frameEma += (frameMs - this.frameEma) * 0.1;
    if (this.frameEma > 19) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.frameEma < 13) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = this.fastFor = 0;
    }
    if (this.slowFor > 0.75 && this.quality > 0.25) {
      this.quality = Math.max(0.25, this.quality - 0.25);
      this.slowFor = 0;
    }
    if (this.fastFor > 4 && this.quality < 1) {
      this.quality = Math.min(1, this.quality + 0.25);
      this.fastFor = 0;
    }
  }

  private drawBackground(): void {
    const ctx = this.ctx;
    const beat = Math.max(0, 1 - (performance.now() - this.beatAt) / 400);
    const a = (0.05 + this.action * 0.14 + beat * 0.035) * this.effects;
    const grad = ctx.createRadialGradient(
      this.w / 2,
      this.h / 2,
      0,
      this.w / 2,
      this.h / 2,
      Math.max(this.w, this.h) * 0.75,
    );
    grad.addColorStop(0, rgba(PALETTE.accents[0], a));
    grad.addColorStop(0.6, rgba(PALETTE.accents[0], a * 0.25));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private drawLights(dt: number): void {
    const ctx = this.ctx;
    for (let k = this.lights.length - 1; k >= 0; k--) {
      const l = this.lights[k];
      l.t -= dt;
      if (l.t <= 0) {
        this.lights.splice(k, 1);
        continue;
      }
      const a = (l.t / l.life) * 0.55 * this.effects;
      const grad = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      grad.addColorStop(0, rgba(l.color, a));
      grad.addColorStop(0.4, rgba(l.color, a * 0.4));
      grad.addColorStop(1, rgba(l.color, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
  }

  private drawFlashes(dt: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#ffffff";
    let w = 0;
    for (let k = 0; k < this.flashes.length; k++) {
      const f = this.flashes[k];
      f.t -= dt;
      if (f.t <= 0) continue;
      ctx.globalAlpha = (f.t / 0.12) * 0.55;
      ctx.fillRect(f.x - 0.5, f.y - 0.5, 1, 1);
      this.flashes[w++] = f;
    }
    this.flashes.length = w;
    ctx.globalAlpha = 1;
  }

  private drawTrails(): void {
    if (this.effects <= 0) return;
    const ctx = this.ctx;
    const len = Math.max(
      3,
      Math.round(TRAIL_LEN * (this.quality >= 0.75 ? 1 : 0.5)),
    );
    const byType = new Map<BallTypeId, typeof this.game.balls>();
    for (const b of this.game.balls) {
      let arr = byType.get(b.type);
      if (!arr) byType.set(b.type, (arr = []));
      arr.push(b);
    }
    ctx.lineCap = "round";
    for (const [type, balls] of byType) {
      ctx.strokeStyle = PALETTE.balls[type];
      for (let seg = 1; seg < len; seg++) {
        const f = seg / len;
        ctx.globalAlpha = f * f * 0.5 * this.effects;
        ctx.lineWidth = BALL_RADIUS * 2 * (0.25 + f * 0.6);
        ctx.beginPath();
        for (const b of balls) {
          const i0 = (b.trailHead - len + seg + TRAIL_LEN * 2) % TRAIL_LEN;
          const i1 = (i0 + 1) % TRAIL_LEN;
          const x0 = b.trail[i0 * 2];
          const y0 = b.trail[i0 * 2 + 1];
          const x1 = b.trail[i1 * 2];
          const y1 = b.trail[i1 * 2 + 1];
          if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > 4) continue;
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawZaps(dt: number): void {
    const ctx = this.ctx;
    let w = 0;
    ctx.lineJoin = "round";
    for (const z of this.zaps) {
      z.t -= dt;
      if (z.t <= 0) continue;
      this.zaps[w++] = z;
      const a = z.t / 0.28;
      const path = new Path2D();
      for (let k = 0; k + 3 < z.pts.length; k += 2) {
        const x0 = z.pts[k];
        const y0 = z.pts[k + 1];
        const x1 = z.pts[k + 2];
        const y1 = z.pts[k + 3];
        const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
        const nx = -(y1 - y0);
        const ny = x1 - x0;
        const nl = Math.hypot(nx, ny) || 1;
        path.moveTo(x0, y0);
        for (let s = 1; s < n; s++) {
          const t = s / n;
          const j = (Math.random() - 0.5) * 0.9;
          path.lineTo(
            x0 + (x1 - x0) * t + (nx / nl) * j,
            y0 + (y1 - y0) * t + (ny / nl) * j,
          );
        }
        path.lineTo(x1, y1);
      }
      ctx.globalAlpha = a * 0.35 * this.effects;
      ctx.strokeStyle = PALETTE.balls.lightning;
      ctx.lineWidth = 0.7;
      ctx.stroke(path);
      ctx.globalAlpha = a;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.14;
      ctx.stroke(path);
    }
    this.zaps.length = w;
    ctx.globalAlpha = 1;
  }

  private drawParticles(dt: number): void {
    const ctx = this.ctx;
    const drag = Math.pow(0.04, dt);
    let w = 0;
    for (let i = 0; i < this.pCount; i++) {
      const life = this.pLife[i] - dt;
      if (life <= 0) continue;
      this.pLife[w] = life;
      this.pMax[w] = this.pMax[i];
      this.pVX[w] = this.pVX[i] * drag;
      this.pVY[w] = this.pVY[i] * drag;
      this.pX[w] = this.pX[i] + this.pVX[w] * dt;
      this.pY[w] = this.pY[i] + this.pVY[w] * dt;
      this.pSize[w] = this.pSize[i];
      this.pColor[w] = this.pColor[i];
      const f = life / this.pMax[w];
      ctx.globalAlpha = f;
      ctx.fillStyle = this.pColor[w];
      const sz = this.pSize[w] * (0.5 + f * 0.5);
      ctx.fillRect(this.pX[w] - sz / 2, this.pY[w] - sz / 2, sz, sz);
      w++;
    }
    this.pCount = w;
    ctx.globalAlpha = 1;
  }

  private drawGolden(gp: { x: number; y: number } | null): void {
    const ctx = this.ctx;
    const t = performance.now() / 1000;
    if (!gp) return;
    if (this.goldShown) {
      const pulse = 0.7 + Math.sin(t * 5) * 0.3;
      ctx.globalAlpha = pulse * Math.max(0.4, this.effects);
      ctx.drawImage(
        this.glowSprite(PALETTE.golden),
        gp.x - 5,
        gp.y - 5,
        10,
        10,
      );
      ctx.globalAlpha = 1;
      if (Math.random() < 0.15 * this.effects)
        this.spawnParticles(gp.x, gp.y, 1, PALETTE.golden, 2, 0.8);
    }
    const radar = this.game.mods.radar;
    if (radar > 0 && !this.goldShown) {
      const r = [0, 16, 9, 4][radar];
      const cx = gp.x + this.radarOffset.x * r * 0.6;
      const cy = gp.y + this.radarOffset.y * r * 0.6;
      const p = (t % 2) / 2;
      ctx.strokeStyle = PALETTE.golden;
      ctx.lineWidth = 0.18;
      ctx.globalAlpha = 0.5 * (1 - p);
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.4 + p * 0.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.25;
      ctx.setLineDash([0.6, 0.6]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  private drawBalls(): void {
    const ctx = this.ctx;
    const glowAlpha = 0.55 * this.effects * (this.quality >= 0.5 ? 1 : 0.5);
    const fast = this.quality < 0.5 || this.game.balls.length > 500;
    if (glowAlpha > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = glowAlpha;
      for (const b of this.game.balls) {
        const sprite = this.glowSprite(PALETTE.balls[b.type]);
        const r = b.phase > 0 ? 2.4 : 1.6;
        ctx.drawImage(sprite, b.x - r, b.y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    for (const b of this.game.balls) {
      const color = PALETTE.balls[b.type];
      ctx.fillStyle = b.phase > 0 ? rgba(color, 0.55) : color;
      if (fast) {
        ctx.fillRect(
          b.x - BALL_RADIUS,
          b.y - BALL_RADIUS,
          BALL_RADIUS * 2,
          BALL_RADIUS * 2,
        );
        continue;
      }
      const speed = this.game.ballSpeed(b.type);
      const stretch = 1 + Math.min(0.45, speed / 70) * this.effects;
      const va = Math.atan2(b.vy, b.vx);
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.squash > 0) {
        const sq = b.squash * 0.4 * this.effects;
        ctx.rotate(b.squashAngle);
        ctx.scale(1 - sq, 1 + sq * 0.7);
        ctx.rotate(-b.squashAngle);
      }
      ctx.rotate(va);
      ctx.scale(stretch, 1 / Math.sqrt(stretch));
      ctx.beginPath();
      ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(
        BALL_RADIUS * 0.2,
        -BALL_RADIUS * 0.15,
        BALL_RADIUS * 0.4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }
  }

  private drawTexts(dt: number): void {
    const ctx = this.ctx;
    let w = 0;
    ctx.textAlign = "center";
    for (const t of this.texts) {
      t.t -= dt;
      if (t.t <= 0) continue;
      this.texts[w++] = t;
      t.y -= dt * 2.2;
      const a = Math.min(1, t.t * 3);
      const pop = 1 + Math.max(0, t.t - 0.6) * 1.5;
      ctx.globalAlpha = a;
      ctx.font = `${(t.size * pop).toFixed(2)}px "Geist Pixel", "Geist Mono", monospace`;
      ctx.fillStyle = "#000";
      ctx.fillText(t.text, t.x + 0.08, t.y + 0.08);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    this.texts.length = w;
    ctx.globalAlpha = 1;
  }

  private drawBloom(): void {
    if (this.effects <= 0 || this.quality < 0.5) return;
    const b = this.bctx;
    b.globalCompositeOperation = "copy";
    b.filter = "blur(2px) saturate(1.8)";
    b.drawImage(this.canvas, 0, 0, this.bloom.width, this.bloom.height);
    b.filter = "none";
    const ctx = this.ctx;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5 * this.effects;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bloom, 0, 0, this.w, this.h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private drawCrt(): void {
    const ctx = this.ctx;
    if (this.scan) {
      ctx.fillStyle = this.scan;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    const v = ctx.createRadialGradient(
      this.w / 2,
      this.h / 2,
      Math.min(this.w, this.h) * 0.45,
      this.w / 2,
      this.h / 2,
      Math.max(this.w, this.h) * 0.75,
    );
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = `rgba(80,255,240,${0.012 + Math.random() * 0.01})`;
    ctx.fillRect(0, 0, this.w, this.h);
  }
}
