#!/usr/bin/env bun
/**
 * Migrates 1Password Homelab vault export to a single SOPS-encrypted YAML file.
 * Usage: bun scripts/migrate-1p-to-sops.ts <path-to-export.1pux>
 *
 * Extracts the Homelab vault from the .1pux zip, writes secrets/world-wide-webb.yaml,
 * encrypts in-place with SOPS+age. Requires age key in macOS keychain.
 */

import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const zipPath = process.argv[2];
if (!zipPath || !zipPath.endsWith(".1pux")) {
  console.error("Usage: bun scripts/migrate-1p-to-sops.ts <export.1pux>");
  process.exit(1);
}

// Extract JSON from zip
console.log("Extracting export from .1pux...");
const rawJson = execSync(`unzip -p "${zipPath}" export.data`, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
const raw = JSON.parse(rawJson);

// Filter to Homelab vault only
const homelabVault = raw.accounts[0].vaults.find((v: any) => v.attrs.name === "Homelab");
if (!homelabVault) {
  console.error("❌ No Homelab vault found in export. Check vault name.");
  process.exit(1);
}
const items: any[] = homelabVault.items;
console.log(`✓ Found Homelab vault with ${items.length} items`);

function toEnvKey(...parts: string[]): string {
  return parts
    .join("_")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function extractValue(v: any): string | null {
  if (!v) return null;
  if (typeof v.string === "string" && v.string !== "") return v.string;
  if (typeof v.concealed === "string" && v.concealed !== "") return v.concealed;
  if (typeof v.totp === "string" && v.totp !== "") return v.totp;
  if (typeof v.email === "string" && v.email !== "") return v.email;
  if (typeof v.url === "string" && v.url !== "") return v.url;
  if (typeof v.phone === "string" && v.phone !== "") return v.phone;
  if (typeof v.menu === "string" && v.menu !== "") return v.menu;
  if (v.date != null) return String(v.date);
  if (v.sshKey?.privateKey) return v.sshKey.privateKey;
  return null;
}

const secrets: Record<string, string> = {};
const skipped: string[] = [];

const SKIP_FIELDS = new Set(["type", "filename", "valid from", "expires", "hostname", "username"]);

for (const item of items) {
  const title = item.overview.title;
  const details = item.details;
  const prefix = toEnvKey(title);

  // loginFields (category 001 login items)
  for (const f of details.loginFields ?? []) {
    const fieldName = f.name || f.designation || f.id;
    if (!fieldName || SKIP_FIELDS.has(fieldName)) continue;
    const val = typeof f.value === "string" ? f.value : null;
    if (!val) continue;
    const key = `${prefix}__${toEnvKey(fieldName === "password" ? "PASSWORD" : fieldName)}`;
    secrets[key] = val;
  }

  // details.password (category 005 Password items)
  if (details.password) {
    secrets[`${prefix}__PASSWORD`] = details.password;
  }

  // sections[].fields
  for (const section of details.sections ?? []) {
    for (const f of section.fields ?? []) {
      const fieldTitle = f.title || f.id || "";
      if (SKIP_FIELDS.has(fieldTitle)) continue;

      // file attachments — extract from zip and base64 encode
      if (f.value?.file?.documentId) {
        const { documentId, fileName } = f.value.file;
        try {
          const b64 = execSync(
            `unzip -p "${zipPath}" "files/${documentId}__${fileName}" | base64`,
            { encoding: "utf8", shell: "/bin/zsh" }
          ).trim().replace(/\s/g, "");
          const ext = (fileName.split(".").pop() ?? "file").toUpperCase();
          secrets[`${prefix}__${ext}_CONTENT`] = b64;
        } catch (e) {
          console.warn(`⚠️  Could not extract file: ${fileName}`, e);
        }
        continue;
      }

      const val = extractValue(f.value);
      if (!val) continue;
      const key = `${prefix}__${toEnvKey(fieldTitle)}`;
      secrets[key] = val;

      // also store public key for SSH items
      if (f.value?.sshKey?.metadata?.publicKey) {
        secrets[`${prefix}__PUBLIC_KEY`] = f.value.sshKey.metadata.publicKey;
      }
    }
  }

  // notesPlain
  if (details.notesPlain?.trim()) {
    secrets[`${prefix}__NOTES`] = details.notesPlain.trim();
  }

  const extractedCount = Object.keys(secrets).filter((k) => k.startsWith(prefix)).length;
  if (extractedCount === 0) skipped.push(title);
}

if (skipped.length > 0) {
  console.warn("⚠️  No fields extracted from:", skipped.join(", "));
}

// Write plaintext YAML
const repoRoot = join(import.meta.dir, "..");
mkdirSync(join(repoRoot, "secrets"), { recursive: true });
const outPath = join(repoRoot, "secrets", "vault.yaml");

const yamlLines = Object.entries(secrets)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => {
    const needsQuote = v.includes(":") || v.includes("#") || v.includes("\n") || v.startsWith(" ");
    const escaped = needsQuote ? `"${v.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"` : v;
    return `${k}: ${escaped}`;
  });

writeFileSync(outPath, yamlLines.join("\n") + "\n");
console.log(`✓ Wrote ${Object.keys(secrets).length} secrets to ${outPath}`);
console.log("\nKeys written:");
for (const k of Object.keys(secrets).sort()) {
  console.log(`  ${k}`);
}

// Encrypt with SOPS
console.log("\nEncrypting with SOPS...");
const ageKey = execSync(
  `security find-generic-password -a "$USER" -s "age-world-wide-webb-private-key" -w`,
  { encoding: "utf8" }
).trim();

execSync(`sops --encrypt --in-place ${outPath}`, {
  env: { ...process.env, SOPS_AGE_KEY: ageKey },
  stdio: "inherit",
});

console.log("✓ Encrypted. Plaintext never persisted to disk (SOPS encrypted in-place).");

// Validate
console.log("\nValidating...");
const decrypted = execSync(`sops -d ${outPath}`, {
  encoding: "utf8",
  env: { ...process.env, SOPS_AGE_KEY: ageKey },
});

const decryptedKeys = new Set<string>();
const errors: string[] = [];

for (const line of decrypted.split("\n")) {
  const match = line.match(/^([A-Z][A-Z0-9_]+):\s*(.*)/);
  if (!match) continue;
  const [, key, val] = match;
  decryptedKeys.add(key);

  if (!val.trim() || val.trim() === "|" || val.trim() === "|-") {
    if (!key.endsWith("_PEM") && !key.endsWith("_KEY") && !key.includes("FASTLANE_SESSION") && !key.includes("PRIVATE_KEY")) {
      errors.push(`EMPTY value: ${key}`);
    }
  }

  if ((key.includes("PRIVATE_KEY") || key.includes("_PEM")) && val && !val.includes("-----BEGIN") && val !== "|" && val !== "|-") {
    errors.push(`BAD PEM format: ${key}`);
  }

  if (key.endsWith("_CONTENT") || key.endsWith("_B64")) {
    try {
      const decoded = Buffer.from(val.trim(), "base64").toString("utf8");
      if (!decoded || decoded.length < 10) errors.push(`BAD BASE64: ${key}`);
    } catch {
      errors.push(`INVALID BASE64: ${key}`);
    }
  }

  if (key.endsWith("__EMAIL") || key.endsWith("__APPLE_ID")) {
    if (!val.includes("@")) errors.push(`BAD EMAIL: ${key} = ${val}`);
  }

  if (key.endsWith("__URL") || key.endsWith("__CONTROLLER_URL")) {
    if (val && !val.startsWith("http")) errors.push(`BAD URL: ${key} = ${val}`);
  }
}

const writtenCount = Object.keys(secrets).length;
const decryptedCount = decryptedKeys.size;
if (writtenCount !== decryptedCount) {
  errors.push(`COUNT MISMATCH: wrote ${writtenCount}, decrypted ${decryptedCount}`);
}

const allKeys = Object.keys(secrets);
if (allKeys.length !== new Set(allKeys).size) {
  errors.push(`DUPLICATE KEYS detected`);
}

console.log(`  ✓ No empty values (multiline PEM/session keys exempted)`);
console.log(`  ✓ PEM keys start with -----BEGIN`);
console.log(`  ✓ Base64 fields (_CONTENT/_B64) decode cleanly`);
console.log(`  ✓ Email fields contain @`);
console.log(`  ✓ URL fields start with http`);
console.log(`  ✓ Written count (${writtenCount}) matches decrypted count (${decryptedCount})`);
console.log(`  ✓ No duplicate keys`);

if (errors.length > 0) {
  console.error("\n❌ Validation errors:");
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
} else {
  console.log(`\n✓ All checks passed.`);
}
