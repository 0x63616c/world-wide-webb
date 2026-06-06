import { describe, expect, it } from "vitest";
import { formatRelativeAge } from "../relative-age";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HR = 60 * MIN;
const DAY = 24 * HR;
const YEAR = 365 * DAY;

const ago = (ms: number) => formatRelativeAge(NOW - ms, NOW);

describe("formatRelativeAge", () => {
  it("reads 'just now' under a minute", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(59 * 1000)).toBe("just now");
  });

  it("formats minutes, singular and plural", () => {
    expect(ago(MIN)).toBe("1min");
    expect(ago(21 * MIN)).toBe("21mins");
  });

  it("formats hours, singular and plural", () => {
    expect(ago(HR)).toBe("1hr");
    expect(ago(4 * HR)).toBe("4hrs");
  });

  it("formats days with an hours tail", () => {
    expect(ago(3 * DAY + 3 * HR)).toBe("3 days 3hrs");
    expect(ago(DAY + HR)).toBe("1 day 1hr");
  });

  it("drops a zero hours tail on a clean day boundary", () => {
    expect(ago(3 * DAY)).toBe("3 days");
    expect(ago(DAY)).toBe("1 day");
  });

  it("formats years, singular and plural", () => {
    expect(ago(YEAR)).toBe("1 year");
    expect(ago(2 * YEAR)).toBe("2 years");
  });

  it("returns null for a non-finite build time", () => {
    expect(formatRelativeAge(Number.NaN, NOW)).toBeNull();
  });
});
