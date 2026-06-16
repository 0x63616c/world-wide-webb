#!/usr/bin/env node
// The @capacitor-community/apple-sign-in 7.1.0 native Package.swift pins
// capacitor-swift-pm to `from: "7.0.0"` (i.e. 7.0.0..<8.0.0), which conflicts
// with this app's Capacitor 8 (capacitor-swift-pm 8.4.0) and fails xcodebuild
// SPM resolution. Widen the range to <9.0.0.
//
// This is an iOS-native-only concern (it only affects xcodebuild's SwiftPM
// resolution, never the web/server bundles), so it lives here and runs in the
// iOS pipeline + local cap sync, instead of a root bun `patchedDependencies`
// which would force every Docker image's `bun install` to carry the patch file.
// Idempotent.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkgJson = require.resolve("@capacitor-community/apple-sign-in/package.json");
const swift = pkgJson.replace(/package\.json$/, "Package.swift");

const before = readFileSync(swift, "utf8");
const after = before.replace(
  /\.package\(url: "https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git", from: "7\.0\.0"\)/,
  '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", "7.0.0"..<"9.0.0")',
);

if (after.includes('"7.0.0"..<"9.0.0"')) {
  if (after !== before) writeFileSync(swift, after);
  console.log(`apple-sign-in SPM patched (capacitor-swift-pm <9.0.0): ${swift}`);
} else {
  console.error(`patch-ios-spm: could not apply patch to ${swift}`);
  process.exit(1);
}
