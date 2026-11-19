import { describe, expect, test } from "bun:test";
import { EMPTY, GOLD, Grid, PIXEL, WALL } from "../src/grid";
import { buildLevel, LEVELS } from "../src/levels";

describe("grid", () => {
  test("damage breaks a pixel only when hp runs out", () => {
    const g = new Grid(4, 4);
    g.setPixel(1, 1, 2, 3);
    expect(g.pixelsLeft).toBe(1);
    const i = g.idx(1, 1);
    expect(g.damage(i, 1)).toBe(false);
    expect(g.crackStage(i)).toBe(1);
    expect(g.damage(i, 2)).toBe(true);
    expect(g.kind[i]).toBe(EMPTY);
    expect(g.pixelsLeft).toBe(0);
  });

  test("walls are unbreakable and outside the map counts as wall", () => {
    const g = new Grid(3, 3);
    g.setWall(0, 0);
    expect(g.damage(0, 999)).toBe(false);
    expect(g.kind[0]).toBe(WALL);
    expect(g.kindAt(-1, 1)).toBe(WALL);
    expect(g.solidAt(1, 1)).toBe(false);
  });

  test("nearest breakable finds the closest pixel", () => {
    const g = new Grid(20, 20);
    g.setPixel(15, 10, 0, 1);
    g.setPixel(12, 10, 0, 1);
    expect(g.nearestBreakable(10.5, 10.5, 10)).toBe(g.idx(12, 10));
    expect(g.nearestBreakable(10.5, 10.5, 1)).toBe(-1);
  });
});

describe("levels", () => {
  test("every level has walls, pixels, one golden pixel and grows in size", () => {
    let prev = 0;
    for (let l = 1; l <= LEVELS.length; l++) {
      const { grid } = buildLevel(l);
      expect(grid.w * grid.h).toBeGreaterThan(prev);
      prev = grid.w * grid.h;
      let gold = 0;
      let walls = 0;
      let pixels = 0;
      for (let i = 0; i < grid.kind.length; i++) {
        if (grid.kind[i] === GOLD) gold++;
        if (grid.kind[i] === WALL) walls++;
        if (grid.kind[i] === PIXEL) pixels++;
      }
      expect(gold).toBe(1);
      expect(walls).toBeGreaterThan(grid.w * 2);
      expect(pixels).toBeGreaterThan(grid.w * grid.h * 0.15);
      expect(grid.pixelsLeft).toBe(pixels + gold);
    }
  });

  test("the golden pixel is reachable from the spawn through non-wall cells", () => {
    for (let l = 1; l <= LEVELS.length; l++) {
      const { grid, spawnX, spawnY } = buildLevel(l);
      const seen = new Uint8Array(grid.kind.length);
      const stack = [grid.idx(Math.floor(spawnX), Math.floor(spawnY))];
      while (stack.length) {
        const i = stack.pop()!;
        if (seen[i] || grid.kind[i] === WALL) continue;
        seen[i] = 1;
        const x = i % grid.w;
        const y = (i / grid.w) | 0;
        if (x > 0) stack.push(i - 1);
        if (x < grid.w - 1) stack.push(i + 1);
        if (y > 0) stack.push(i - grid.w);
        if (y < grid.h - 1) stack.push(i + grid.w);
      }
      expect(seen[grid.golden]).toBe(1);
    }
  });
});
