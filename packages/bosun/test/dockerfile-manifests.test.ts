import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guard against the recurring footgun (CC-q002.2): a Dockerfile that runs an
// in-container `bun install --frozen-lockfile` must COPY EVERY workspace's
// package.json first. The root bun.lock references all workspaces, so if a new
// workspace (e.g. apps/captive-portal) is added but a Dockerfile's manifest-COPY
// list isn't updated, the frozen install inside that image fails with "lockfile
// had changes" — breaking the image build (and the prod deploy) for a reason that
// has nothing to do with that image. This test makes the invariant mechanical:
// add a workspace, every workspace-installing Dockerfile must learn about it.

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

// Discover every workspace dir that has a package.json under apps/ and packages/.
function workspaceDirs(): string[] {
  const dirs: string[] = [];
  for (const group of ["apps", "packages"]) {
    const base = join(REPO_ROOT, group);
    let entries: string[];
    try {
      entries = readdirSync(base);
    } catch {
      continue;
    }
    for (const name of entries) {
      const dir = join(base, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
        statSync(join(dir, "package.json"));
        dirs.push(`${group}/${name}`);
      } catch {
        // no package.json — not a workspace
      }
    }
  }
  return dirs.sort();
}

// Find every Dockerfile in the repo (apps/** + packages/**, any name starting
// "Dockerfile").
function dockerfiles(): string[] {
  const found: string[] = [];
  for (const group of ["apps", "packages"]) {
    const base = join(REPO_ROOT, group);
    let entries: string[];
    try {
      entries = readdirSync(base);
    } catch {
      continue;
    }
    for (const name of entries) {
      const dir = join(base, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const f of readdirSync(dir)) {
        if (f.startsWith("Dockerfile")) found.push(join(group, name, f));
      }
    }
  }
  return found.sort();
}

describe("Dockerfile workspace-manifest completeness (CC-q002.2)", () => {
  const allWorkspaces = workspaceDirs();
  const allDockerfiles = dockerfiles();

  it("finds the workspaces and Dockerfiles (sanity)", () => {
    expect(allWorkspaces).toContain("apps/captive-portal");
    expect(allWorkspaces.length).toBeGreaterThan(3);
    expect(allDockerfiles.length).toBeGreaterThan(3);
  });

  // Only Dockerfiles that do a workspace-wide frozen install need every manifest;
  // a self-contained image (e.g. drizzle, which copies no workspace manifests and
  // installs nothing from the root lockfile) is exempt.
  const installingDockerfiles = allDockerfiles.filter((rel) => {
    const body = readFileSync(join(REPO_ROOT, rel), "utf8");
    return body.includes("--frozen-lockfile");
  });

  it("has at least one workspace-installing Dockerfile to guard", () => {
    expect(installingDockerfiles.length).toBeGreaterThan(0);
  });

  for (const rel of installingDockerfiles) {
    it(`${rel} COPYs every workspace package.json before its frozen install`, () => {
      const body = readFileSync(join(REPO_ROOT, rel), "utf8");
      const missing = allWorkspaces.filter((ws) => !body.includes(`${ws}/package.json`));
      expect(
        missing,
        `${rel} is missing a manifest COPY for: ${missing.join(", ")}. ` +
          "Add `COPY <ws>/package.json <ws>/` (matching this file's COPY style) — " +
          "the root bun.lock references every workspace, so --frozen-lockfile fails " +
          "inside the image without it (CC-q002.2).",
      ).toEqual([]);
    });
  }
});
