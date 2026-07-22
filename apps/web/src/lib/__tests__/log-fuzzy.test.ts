import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "../log/fuzzy";

const LINE = 'trpc tesla.get failed {"type":"query","path":"tesla.get","ms":88,"httpStatus":503}';

describe("fuzzyMatch", () => {
  it("matches a plain substring, which is what you type most of the time", () => {
    expect(fuzzyMatch(LINE, "tesla.get")).toBe(true);
    expect(fuzzyMatch(LINE, "503")).toBe(true);
    expect(fuzzyMatch(LINE, "TESLA")).toBe(true); // case-insensitive
  });

  it("tolerates dropped characters and typos", () => {
    expect(fuzzyMatch(LINE, "tslget")).toBe(true);
    expect(fuzzyMatch(LINE, "htpstatus")).toBe(true);
  });

  it("ANDs space-separated terms", () => {
    expect(fuzzyMatch(LINE, "tesla 503")).toBe(true);
    expect(fuzzyMatch(LINE, "tesla 502")).toBe(false);
  });

  it("is NOT so fuzzy that it matches anything", () => {
    // The whole risk of subsequence matching on log text: scavenging the query's
    // letters from across a long JSON line and calling it a hit. On a wall panel
    // a false match is worse than no match , it looks like it found something.
    expect(fuzzyMatch(LINE, "spotify")).toBe(false);
    expect(fuzzyMatch(LINE, "weather")).toBe(false);
    expect(fuzzyMatch(LINE, "zzz")).toBe(false);
  });

  it("does not let a single character match everything", () => {
    expect(fuzzyMatch(LINE, "q")).toBe(true); // present as a substring
    expect(fuzzyMatch(LINE, "z")).toBe(false); // absent, and too short to fuzz
  });

  it("finds the tightest match, not merely the earliest", () => {
    // A stray early 'c' must not anchor the match and stretch its span past the
    // compactness limit, hiding a genuine match later in the line.
    expect(fuzzyMatch('c ......................... {"path":"climate.get"}', "climate")).toBe(true);
  });

  it("matches everything on an empty query", () => {
    expect(fuzzyMatch(LINE, "")).toBe(true);
    expect(fuzzyMatch(LINE, "   ")).toBe(true);
  });
});
