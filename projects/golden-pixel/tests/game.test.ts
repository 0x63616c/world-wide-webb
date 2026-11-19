import { describe, expect, test } from "bun:test";
import { Game } from "../src/game";
import { EMPTY } from "../src/grid";

describe("game", () => {
  test("the starting ball breaks pixels and earns money", () => {
    const g = new Game();
    expect(g.balls.length).toBe(1);
    const before = g.grid.pixelsLeft;
    for (let i = 0; i < 60 * 30; i++) g.update(1 / 60);
    expect(g.grid.pixelsLeft).toBeLessThan(before);
    expect(g.s.money).toBeGreaterThan(0);
  });

  test("balls stay inside the map", () => {
    const g = new Game();
    g.s.money = 1e6;
    for (let i = 0; i < 20; i++) g.buyBall("basic");
    for (let i = 0; i < 60 * 20; i++) g.update(1 / 60);
    for (const b of g.balls) {
      expect(b.x).toBeGreaterThan(0);
      expect(b.y).toBeGreaterThan(0);
      expect(b.x).toBeLessThan(g.grid.w);
      expect(b.y).toBeLessThan(g.grid.h);
    }
  });

  test("buying deducts money, spawns a ball and raises the price", () => {
    const g = new Game();
    g.s.money = 1000;
    const p = g.ballPrice("basic");
    expect(g.buyBall("basic")).toBe(true);
    expect(g.s.money).toBe(1000 - p);
    expect(g.balls.length).toBe(2);
    expect(g.ballPrice("basic")).toBeGreaterThan(p);
  });

  test("locked balls cannot be bought until the skill is learned", () => {
    const g = new Game();
    g.s.money = 1e9;
    expect(g.buyBall("lightning")).toBe(false);
    g.s.skillPoints = 10;
    expect(g.buySkill("core")).toBe(true);
    expect(g.buySkill("sharp")).toBe(true);
    expect(g.buySkill("momentum")).toBe(true);
    expect(g.buySkill("u-lightning")).toBe(true);
    expect(g.buyBall("lightning")).toBe(true);
  });

  test("breaking the golden pixel awards skill points and advances the level", () => {
    const g = new Game();
    const gi = g.grid.golden;
    g.damageCell(gi, 1e9, false, null);
    expect(g.grid.kind[gi]).toBe(EMPTY);
    expect(g.s.skillPoints).toBeGreaterThan(0);
    for (let i = 0; i < 60 * 4; i++) g.update(1 / 60);
    expect(g.s.level).toBe(2);
    expect(g.events.some((e) => e.t === "level-clear")).toBe(true);
  });

  test("a save round-trips the level layout and progress", () => {
    const g = new Game();
    for (let i = 0; i < 60 * 10; i++) g.update(1 / 60);
    const left = g.grid.pixelsLeft;
    const copy = new Game(JSON.parse(JSON.stringify(g.serialize())));
    expect(copy.grid.pixelsLeft).toBe(left);
    expect(copy.s.money).toBe(g.s.money);
  });
});
