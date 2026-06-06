#!/usr/bin/env bun
/**
 * Generates shields.io "endpoint" JSON for the README status badges so the
 * numbers are REAL and self-hosted — no external SaaS, no tokens, no
 * hand-typed values that drift stale (which the repo's no-fake-data rule
 * forbids). Each file is consumed by README.md via
 * `https://img.shields.io/endpoint?url=<raw github url to this json>`.
 *
 * - code-files.json count of git-tracked code files (CODE_GLOBS).
 * - loc.json        total lines across those code files (label "lines").
 * - files.json      count of ALL git-tracked files in the repo.
 *                   These three are cheap and always regenerated — wired into the
 *                   lefthook pre-commit so they can never go stale.
 * - coverage.json   line coverage %, read from vitest's coverage-summary.json.
 *                   Only rewritten when that summary exists (i.e. after a
 *                   `vitest run --coverage`), so a plain local commit that has no
 *                   fresh coverage report leaves the last CI-generated value
 *                   intact rather than zeroing it out.
 *
 * Run: `bun run badges` (root). The CI test job runs it after coverage; the
 * pre-commit hook runs it for the LOC refresh.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const badgesDir = join(repoRoot, ".github", "badges");

type Endpoint = { schemaVersion: 1; label: string; message: string; color: string };

function writeBadge(name: string, badge: Endpoint): void {
  mkdirSync(badgesDir, { recursive: true });
  // Trailing newline keeps the file diff-clean against editors/formatters.
  writeFileSync(join(badgesDir, name), `${JSON.stringify(badge, null, 2)}\n`);
}

// Source extensions that count as "lines of code" for the badge. Tracked files
// only (git ls-files already excludes node_modules and build output).
const CODE_GLOBS = ["*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.css"];

// Thousands-separated decimal, e.g. 43051 -> "43,051", 2123313 -> "2,123,313".
// Locale-independent (manual regex) so CI and local machines always agree.
function formatNum(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Count git-tracked code files and their total lines in one pass.
function countCode(): { files: number; lines: number } {
  const out = execFileSync("git", ["ls-files", "-z", "--", ...CODE_GLOBS], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // `git ls-files` includes tracked paths that are deleted on disk but not yet
  // staged (a pending deletion in a dirty tree). Skip those rather than ENOENT.
  const files = out
    .split("\0")
    .filter(Boolean)
    .filter((f) => existsSync(join(repoRoot, f)));
  let lines = 0;
  for (const f of files) {
    const buf = readFileSync(join(repoRoot, f));
    // Count newlines; add 1 when the final line has no trailing newline.
    let nl = 0;
    for (const byte of buf) if (byte === 0x0a) nl++;
    lines += buf.length > 0 && buf.at(-1) !== 0x0a ? nl + 1 : nl;
  }
  return { files: files.length, lines };
}

// Total git-tracked files in the repo (every path, not just code).
function countTrackedFiles(): number {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean).length;
}

// The three count badges (all blue, comma-formatted). Cheap to compute, so the
// lefthook pre-commit refreshes them on every commit; only coverage is gated to CI.
function genCounts(): void {
  const { files: codeFiles, lines } = countCode();
  const totalFiles = countTrackedFiles();
  writeBadge("code-files.json", {
    schemaVersion: 1,
    label: "code files",
    message: formatNum(codeFiles),
    color: "blue",
  });
  writeBadge("loc.json", {
    schemaVersion: 1,
    label: "lines",
    message: formatNum(lines),
    color: "blue",
  });
  writeBadge("files.json", {
    schemaVersion: 1,
    label: "files",
    message: formatNum(totalFiles),
    color: "blue",
  });
  console.log(
    `code-files.json -> ${formatNum(codeFiles)} | loc.json -> ${formatNum(lines)} lines | files.json -> ${formatNum(totalFiles)}`,
  );
}

// Coverage thresholds -> shields named colors. Honest gradient, no green-washing.
function coverageColor(pct: number): string {
  if (pct >= 90) return "brightgreen";
  if (pct >= 80) return "green";
  if (pct >= 60) return "yellowgreen";
  if (pct >= 40) return "yellow";
  if (pct >= 20) return "orange";
  return "red";
}

function genCoverage(): void {
  const summaryPath = join(repoRoot, "coverage", "coverage-summary.json");
  if (!existsSync(summaryPath)) {
    console.log(
      "coverage.json -> skipped (no coverage/coverage-summary.json; run vitest --coverage first)",
    );
    return;
  }
  const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as {
    total: { lines: { pct: number } };
  };
  const pct = summary.total.lines.pct;
  writeBadge("coverage.json", {
    schemaVersion: 1,
    label: "coverage",
    message: `${pct}%`,
    color: coverageColor(pct),
  });
  console.log(`coverage.json -> ${pct}% (${coverageColor(pct)})`);
}

// `--loc-only` (used by the fast pre-commit hook) refreshes just the LOC badge,
// leaving the CI-generated coverage value untouched so a stale local coverage/
// dir can never write an out-of-date coverage number into a commit.
const locOnly = process.argv.includes("--loc-only");

genCounts();
if (!locOnly) genCoverage();
