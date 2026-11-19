export const EMPTY = 0;
export const WALL = 1;
export const PIXEL = 2;
export const GOLD = 3;

/** Typed-array pixel map. The grid is also the spatial index: a ball only looks at the cells it touches. */
export class Grid {
  readonly kind: Uint8Array;
  readonly tier: Uint8Array;
  readonly hp: Float32Array;
  readonly maxHp: Float32Array;
  pixelsLeft = 0;
  golden = -1;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    const n = w * h;
    this.kind = new Uint8Array(n);
    this.tier = new Uint8Array(n);
    this.hp = new Float32Array(n);
    this.maxHp = new Float32Array(n);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Outside the map counts as wall. */
  kindAt(x: number, y: number): number {
    if (!this.inside(x, y)) return WALL;
    return this.kind[y * this.w + x];
  }

  solidAt(x: number, y: number): boolean {
    return this.kindAt(x, y) !== EMPTY;
  }

  breakable(i: number): boolean {
    const k = this.kind[i];
    return k === PIXEL || k === GOLD;
  }

  setWall(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    const i = this.idx(x, y);
    if (this.breakable(i)) this.pixelsLeft--;
    this.kind[i] = WALL;
    this.hp[i] = 0;
  }

  setEmpty(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    const i = this.idx(x, y);
    if (this.breakable(i)) this.pixelsLeft--;
    this.kind[i] = EMPTY;
    this.hp[i] = 0;
  }

  setPixel(x: number, y: number, tier: number, hp: number): void {
    const i = this.idx(x, y);
    if (!this.breakable(i)) this.pixelsLeft++;
    this.kind[i] = PIXEL;
    this.tier[i] = tier;
    this.hp[i] = hp;
    this.maxHp[i] = hp;
  }

  /** Deals damage; returns true when the cell broke. Walls and empty cells ignore damage. */
  damage(i: number, amount: number): boolean {
    if (!this.breakable(i)) return false;
    this.hp[i] -= amount;
    if (this.hp[i] > 0) return false;
    this.kind[i] = EMPTY;
    this.hp[i] = 0;
    this.pixelsLeft--;
    return true;
  }

  /** 0 = intact .. 3 = about to break. */
  crackStage(i: number): number {
    const r = this.hp[i] / this.maxHp[i];
    return r > 0.75 ? 0 : r > 0.5 ? 1 : r > 0.25 ? 2 : 3;
  }

  /** True once a neighbour is open, so the golden pixel can be seen. */
  exposed(i: number): boolean {
    const x = i % this.w;
    const y = (i / this.w) | 0;
    return (
      this.kindAt(x + 1, y) === EMPTY ||
      this.kindAt(x - 1, y) === EMPTY ||
      this.kindAt(x, y + 1) === EMPTY ||
      this.kindAt(x, y - 1) === EMPTY
    );
  }

  /** Nearest breakable cell to (cx, cy) within range, searching rings outward. */
  nearestBreakable(
    cx: number,
    cy: number,
    range: number,
    preferGold = false,
  ): number {
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    if (preferGold && this.golden >= 0 && this.breakable(this.golden)) {
      const gx = this.golden % this.w;
      const gy = (this.golden / this.w) | 0;
      if (Math.hypot(gx - x0, gy - y0) <= range) return this.golden;
    }
    for (let r = 1; r <= range; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = x0 + dx;
          const y = y0 + dy;
          if (!this.inside(x, y)) continue;
          const i = this.idx(x, y);
          if (!this.breakable(i)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
}
