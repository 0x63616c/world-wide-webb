#!/usr/bin/env bun
/**
 * Generates shields.io "endpoint" JSON for the README status badges so the
 * numbers are REAL and self-hosted — no external SaaS, no tokens, no
 * hand-typed values that drift stale (which the repo's no-fake-data rule
 * forbids). Each file is consumed by README.md via
 * `https://img.shields.io/endpoint?url=<raw github url to this json>`.
 *
 * - files.json      "<code files>/<all files>" — git-tracked code files
 *                   (CODE_GLOBS) over ALL git-tracked files (label "files").
 * - loc.json        "<code lines>/<all lines>" — total lines across code files
 *                   over total lines across every tracked file (label "lines").
 *                   These two are cheap and always regenerated — wired into the
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

// Count lines in a file buffer: newlines, plus 1 when the final line has no
// trailing newline. Binary files just contribute their 0x0a byte count.
function countLines(buf: Buffer): number {
  let nl = 0;
  for (const byte of buf) if (byte === 0x0a) nl++;
  return buf.length > 0 && buf.at(-1) !== 0x0a ? nl + 1 : nl;
}

// List git-tracked paths matching `globs` (all tracked files when empty),
// skipping pending deletions (tracked but absent on disk → would ENOENT).
function trackedFiles(globs: string[]): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", ...globs], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => existsSync(join(repoRoot, f)));
}

// Count files and total lines for a tracked-path set in one pass.
function countSet(globs: string[]): { files: number; lines: number } {
  const files = trackedFiles(globs);
  let lines = 0;
  for (const f of files) lines += countLines(readFileSync(join(repoRoot, f)));
  return { files: files.length, lines };
}

// Current HEAD short commit SHA. In CI this is the real main commit; on a local
// pre-commit run HEAD is the parent, so CI (which regenerates badges post-push)
// is authoritative — same as the coverage badge.
function headShortSha(): string {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

// The count badges (all blue). Cheap to compute, so the lefthook pre-commit
// refreshes them on every commit; only coverage is gated to CI.
//
// - files.json  "<code files>/<all files>"  — code vs every tracked path
// - loc.json    "<code lines>/<all lines>"  — code lines vs lines in every file
// - commit.json short HEAD SHA
function genCounts(): void {
  const code = countSet(CODE_GLOBS);
  const all = countSet([]);
  writeBadge("files.json", {
    schemaVersion: 1,
    label: "files",
    message: `${formatNum(code.files)}/${formatNum(all.files)}`,
    color: "blue",
  });
  writeBadge("loc.json", {
    schemaVersion: 1,
    label: "lines",
    message: `${formatNum(code.lines)}/${formatNum(all.lines)}`,
    color: "blueviolet",
  });
  writeBadge("commit.json", {
    schemaVersion: 1,
    label: "commit",
    message: headShortSha(),
    color: "blue",
  });
  console.log(
    `files.json -> ${formatNum(code.files)}/${formatNum(all.files)} | loc.json -> ${formatNum(code.lines)}/${formatNum(all.lines)} lines | commit.json -> ${headShortSha()}`,
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
