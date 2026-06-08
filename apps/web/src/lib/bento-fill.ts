// Bento-fill generator — a seeded skyline wall-builder that tiles a W×H cell
// region AROUND N arbitrary reserved holes (the freely-placed real tiles), with
// best-of-N selection to pick the cleanest seam structure.
//
// Ported + generalized from the validated prototype experiments/fixed-board.mjs
// (www-7klw), whose header recorded this as "the actual production approach (no
// Wang/WFC)". The ONE generalization vs the prototype: it reserved a single
// central cluster hole; free tile placement means N arbitrary holes, so the
// per-column "jump past the hole" + height-cap logic now consults whichever
// hole a column actually hits.
//
// The output is consumed by placeholder-tiles.ts at module load (best-of-N is a
// few ms, deterministic given fixed seeds → identical winner every load), so the
// decorative bento regenerates around wherever the real tiles sit, with no
// committed coordinate tables.

export type Rect = { col: number; row: number; cols: number; rows: number };

// Bento tile size bounds (cells). Width 2..5, height 2..4 — matches the prototype
// and the original hand-authored fill, so the look is unchanged.
const WMIN = 2;
const WMAX = 5;
const HMIN = 2;
const HMAX = 4;

// Deterministic PRNG (mulberry32). Same seed → same stream → same fill.
export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tile lengths along one axis that leave the remainder either flush (0) or itself
// ≥ the minimum — i.e. never strand a 1-cell sliver.
function validSizes(avail: number, mn: number, mx: number): number[] {
  const out: number[] = [];
  const top = Math.min(mx, avail);
  for (let w = mn; w <= top; w++) {
    const r = avail - w;
    if (r === 0 || r >= mn) out.push(w);
  }
  return out;
}

// Per-column hole spans: for each column, the sorted [top, bottomExclusive) row
// intervals it is blocked by. Lets the builder skip a column past whatever hole
// it hits, regardless of how many holes scatter the region.
type Span = { top: number; bottom: number }; // bottom exclusive
function holeSpansPerColumn(W: number, holes: Rect[]): Span[][] {
  const cols: Span[][] = Array.from({ length: W }, () => []);
  for (const h of holes) {
    for (let x = h.col; x < h.col + h.cols; x++) {
      cols[x].push({ top: h.row, bottom: h.row + h.rows });
    }
  }
  for (const list of cols) list.sort((a, b) => a.top - b.top);
  return cols;
}

type Build = { tiles: Rect[]; owner: Int32Array; W: number; H: number; failed: boolean };

// Skyline fill of W×H around the given holes. Walks the lowest column frontier,
// places a varied rectangle that never crosses a hole or strands a sliver, and
// repeats until every non-hole cell is covered — or bails (best-of-N discards a
// failed board). Mirrors the prototype's structure with N-hole generalization.
function buildAround(W: number, H: number, holes: Rect[], rng: () => number): Build {
  const RES = -2; // reserved (hole) marker
  const owner = new Int32Array(W * H).fill(-1);
  for (const h of holes) {
    for (let y = h.row; y < h.row + h.rows; y++) {
      for (let x = h.col; x < h.col + h.cols; x++) owner[y * W + x] = RES;
    }
  }

  const spans = holeSpansPerColumn(W, holes);
  // Smallest row ≥ y in column x that is not inside a hole (skips stacked holes).
  const nextFree = (x: number, y: number): number => {
    let r = y;
    for (const s of spans[x]) {
      if (r >= s.top && r < s.bottom) r = s.bottom;
    }
    return r;
  };
  // First hole-top strictly below `from` in column x (the ceiling a tile starting
  // at `from` must stop at), or H if the column is clear beneath.
  const ceilFor = (x: number, from: number): number => {
    let c = H;
    for (const s of spans[x]) {
      if (s.top >= from && s.top < c) c = s.top;
    }
    return c;
  };

  const frontier = new Int32Array(W);
  for (let x = 0; x < W; x++) frontier[x] = nextFree(x, 0);

  const tiles: Rect[] = [];
  const setO = (x: number, y: number, w: number, h: number, v: number) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) owner[yy * W + xx] = v;
  };

  let guard = 0;
  while (true) {
    if (++guard > W * H * 6) return { owner, tiles, W, H, failed: true };

    // Lowest frontier across all columns; done when every column has reached H.
    let f = Infinity;
    for (let x = 0; x < W; x++) if (frontier[x] < H && frontier[x] < f) f = frontier[x];
    if (f === Infinity) break;

    // Seam length immediately below column c (how long the c-1|c boundary runs up
    // from f). Used to bias placement toward covering long seams.
    const seamBelow = (c: number): number => {
      let n = 0;
      for (let r = f - 1; r >= 0; r--) {
        const a = owner[r * W + (c - 1)];
        const b = owner[r * W + c];
        if (a !== b) n++;
        else break;
      }
      return n;
    };

    // Maximal runs of columns sitting at the minimum frontier f.
    const runs: Array<[number, number]> = [];
    for (let x = 0; x < W; ) {
      if (frontier[x] === f) {
        const s = x;
        let l = 0;
        while (x < W && frontier[x] === f) {
          l++;
          x++;
        }
        runs.push([s, l]);
      } else x++;
    }

    // Pick the run with the longest interior seam (random tie-break).
    let pick: [number, number] | null = null;
    let pu = -1;
    for (const [s, l] of runs) {
      let u = 0;
      for (let c = s + 1; c < s + l; c++) u = Math.max(u, seamBelow(c));
      const ur = u + rng() * 0.1;
      if (ur > pu) {
        pu = ur;
        pick = [s, l];
      }
    }
    if (!pick) return { owner, tiles, W, H, failed: true };
    const [x0, L] = pick;

    // Candidate widths/offsets within the run that don't strand a horizontal sliver.
    const cand: Array<[number, number]> = [];
    for (let w = WMIN; w <= Math.min(WMAX, L); w++) {
      for (let px = x0; px + w <= x0 + L; px++) {
        const lr = px - x0;
        const rr = x0 + L - (px + w);
        if ((lr === 0 || lr >= WMIN) && (rr === 0 || rr >= WMIN)) cand.push([px, w]);
      }
    }
    if (!cand.length) return { owner, tiles, W, H, failed: true };

    // Prefer the placement that covers the longest seam and lands its own edges on
    // existing seams (random tie-break).
    let best: [number, number] | null = null;
    let bk = -Infinity;
    for (const [px, w] of cand) {
      let cov = 0;
      for (let c = px + 1; c < px + w; c++) cov = Math.max(cov, seamBelow(c));
      const edge = Math.max(px > 0 ? seamBelow(px) : 0, px + w < W ? seamBelow(px + w) : 0);
      const key = cov * 1000 - edge * 10 + rng();
      if (key > bk) {
        bk = key;
        best = [px, w];
      }
    }
    if (!best) return { owner, tiles, W, H, failed: true };
    const [px, w] = best;

    // Height is capped by the nearest hole-top beneath f across the chosen columns.
    let ceil = H;
    for (let c = px; c < px + w; c++) ceil = Math.min(ceil, ceilFor(c, f));
    const avail = ceil - f;
    const hOpts = validSizes(avail, HMIN, HMAX);
    if (!hOpts.length) {
      // avail < 2: placing here would strand a 1-row sliver against a hole. Reject
      // the board; best-of-N discards it and tries another seed.
      return { owner, tiles, W, H, failed: true };
    }
    const h = hOpts[(rng() * hOpts.length) | 0];

    tiles.push({ col: px, row: f, cols: w, rows: h });
    setO(px, f, w, h, tiles.length);
    for (let x = px; x < px + w; x++) frontier[x] = nextFree(x, f + h);
  }

  return { owner, tiles, W, H, failed: false };
}

function hasGap(owner: Int32Array): boolean {
  for (const v of owner) if (v === -1) return true;
  return false;
}

// Longest straight interior seam (cells), ignoring reserved-cell boundaries — a
// hole edge is a real boundary, not a decorative seam. Lower is a cleaner bento.
function longestSeam(owner: Int32Array, W: number, H: number): number {
  let v = 0;
  let h = 0;
  for (let c = 1; c < W; c++) {
    let run = 0;
    for (let r = 0; r < H; r++) {
      const a = owner[r * W + (c - 1)];
      const b = owner[r * W + c];
      if (a === -2 || b === -2) {
        run = 0;
        continue;
      }
      if (a !== b) {
        run++;
        if (run > v) v = run;
      } else run = 0;
    }
  }
  for (let r = 1; r < H; r++) {
    let run = 0;
    for (let c = 0; c < W; c++) {
      const a = owner[(r - 1) * W + c];
      const b = owner[r * W + c];
      if (a === -2 || b === -2) {
        run = 0;
        continue;
      }
      if (a !== b) {
        run++;
        if (run > h) h = run;
      } else run = 0;
    }
  }
  return Math.max(v, h);
}

export type FillOptions = {
  // Number of seeds tried; the gap-free board with the shortest longest-seam wins.
  attempts?: number;
  // Base seed; the winner is deterministic for a given (region, holes, seed).
  seed?: number;
};

// Tile the W×H region around `holes` with varied bento rectangles, gap-free and
// sliver-free. Runs best-of-N and returns the cleanest board's tiles (col/row are
// 0-indexed within the region). Throws if no seed yields a complete fill — that
// only happens when a hole layout leaves a structurally unfillable 1-cell pocket,
// which the caller's layout test surfaces loudly so a tile can be nudged a cell.
export function fillAround(W: number, H: number, holes: Rect[], opts: FillOptions = {}): Rect[] {
  const attempts = opts.attempts ?? 300;
  const seed0 = opts.seed ?? 1234;
  let best: Rect[] | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < attempts; i++) {
    const b = buildAround(W, H, holes, mulberry32(seed0 + i * 101));
    if (b.failed || hasGap(b.owner)) continue;
    const score = longestSeam(b.owner, W, H);
    if (score < bestScore) {
      bestScore = score;
      best = b.tiles;
    }
  }
  if (!best) {
    throw new Error(
      `bento-fill: no gap-free tiling of ${W}×${H} around ${holes.length} hole(s) in ${attempts} attempts`,
    );
  }
  return best;
}
