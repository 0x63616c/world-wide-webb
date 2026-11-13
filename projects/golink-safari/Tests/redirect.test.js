import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  golinkOrigin,
  redirectRules,
  resolveSearch,
  fallbackSearch,
} from "../Extension/redirect.js";

const source = (query) =>
  `https://www.google.com/search?client=safari&q=${encodeURIComponent(query)}&ie=UTF-8&oe=UTF-8`;
const rules = redirectRules("safari-web-extension://test/resolve.html");
const pattern = {
  test: (url) => {
    const matches = rules
      .filter((rule) => new RegExp(rule.condition.regexFilter).test(url))
      .sort((a, b) => b.priority - a.priority);
    return matches[0]?.action.type === "redirect";
  },
};

describe("address-bar go links", () => {
  test.each([
    ["go/repo", "/repo"],
    ["go/team/repo", "/team/repo"],
    ["go/repo?view=all&sort=new#readme", "/repo?view=all&sort=new#readme"],
    ["go/a%2Fb?x=%26%23%2B#part%20two", "/a%2Fb?x=%26%23%2B#part%20two"],
    ["go/café", "/caf%C3%A9"],
    ["go/a@evil.example", "/a@evil.example"],
    ["go//evil.example/path", "//evil.example/path"],
    ["go/repo%20name", "/repo%20name"],
    ["go/../repo", "/repo"],
    ["go/%2e%2e/repo", "/repo"],
    ["go/%2f%2fevil.example", "/%2f%2fevil.example"],
    ["go/https://evil.example", "/https://evil.example"],
  ])("%s preserves URL semantics", (query, suffix) => {
    const original = source(query);
    expect(pattern.test(original)).toBe(true);
    expect(resolveSearch(original)).toBe(golinkOrigin + suffix);
    expect(new URL(resolveSearch(original)).origin).toBe(golinkOrigin);
  });

  test.each([
    "repo",
    "go",
    "go/",
    "go/repo explanation",
    "please go/repo",
    "https://go/repo",
    "GO/repo",
    "go/repo\tfoo",
    "go/repo\nfoo",
  ])("leaves ordinary search %s untouched", (query) => {
    expect(pattern.test(source(query))).toBe(false);
    expect(resolveSearch(source(query))).toBeNull();
  });

  test("accepts q in either parameter position and literal slash", () => {
    for (const url of [
      "https://google.com/search?q=go/repo",
      "https://www.google.com/search?x=1&q=go%2Frepo",
      "https://www.google.com/search?q=go%2frepo&x=1",
    ]) {
      expect(pattern.test(url)).toBe(true);
      expect(resolveSearch(url)).toBe(golinkOrigin + "/repo");
    }
  });

  test.each([
    "https://evil.example/search?q=go%2Frepo",
    "https://www.google.com.evil.example/search?q=go%2Frepo",
    "http://www.google.com/search?q=go%2Frepo",
    "https://www.google.com:8443/search?q=go%2Frepo",
    "https://www.google.com/other?q=go%2Frepo",
    "https://www.google.com/search?q=go%2Frepo&q=normal",
    "https://www.google.com/search?q=go%2Frepo&%71=normal",
    "https://www.google.com/search?q=go%2Fbad%FF",
    source("go/repo\\@evil.example"),
    source("go/repo%zz"),
    source("go/repo\u00a0phrase"),
    "https://www.google.com/search?q=go%2Frepo&q=go%2Fother",
  ])("rejects ambiguous input without arbitrary fallback: %s", (url) => {
    expect(resolveSearch(url)).toBeNull();
    const fallback = fallbackSearch(url);
    if (fallback) {
      expect(new URL(fallback).hostname).toMatch(/^(www\.)?google\.com$/);
      expect(pattern.test(fallback)).toBe(false);
      expect(new URL(fallback).searchParams.getAll("q")).toEqual(
        new URL(url).searchParams.getAll("q"),
      );
    }
  });

  test("packaged rule captures the complete original URL into an extension fragment", () => {
    const url = source("go/repo?x=one&y=two#readme");
    const rule = rules[0];
    expect(rule.condition.resourceTypes).toEqual(["main_frame"]);
    expect(rule.action.redirect.regexSubstitution).toBe(
      "safari-web-extension://test/resolve.html#\\0",
    );
    expect(new RegExp(rules[1].condition.regexFilter).exec(url)[0]).toBe(url);
    const manifest = JSON.parse(
      readFileSync(new URL("../Extension/manifest.json", import.meta.url)),
    );
    expect(manifest.permissions).toEqual([
      "declarativeNetRequestWithHostAccess",
    ]);
    expect(manifest.host_permissions).toEqual([
      "https://www.google.com/*",
      "https://google.com/*",
    ]);
    expect(manifest.content_scripts).toBeUndefined();
  });
});
