type GateName =
  | "format"
  | "format-staged"
  | "lint"
  | "lint-tracked"
  | "typecheck"
  | "test"
  | "knip"
  | "gate"
  | "pre-push";

type GateCommand = {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
};

const gateName = Bun.argv[2] as GateName | undefined;
const passthroughArgs = Bun.argv.slice(3);

const commandsByGate = {
  format: [{ label: "format", command: "bunx", args: ["biome", "check", "--write", "."] }],
  "format-staged": [
    {
      label: "format-staged",
      command: "bunx",
      args: ["biome", "check", "--write", "--no-errors-on-unmatched", ...passthroughArgs],
    },
  ],
  lint: [{ label: "lint", command: "bunx", args: ["biome", "check", "."] }],
  "lint-tracked": [
    {
      label: "lint-tracked",
      command: "bunx",
      args: ["biome", "check", "--no-errors-on-unmatched", ...trackedLintFiles()],
    },
  ],
  typecheck: [{ label: "typecheck", command: "bun", args: ["run", "typecheck"] }],
  test: [{ label: "test", command: "bun", args: ["run", "test"] }],
  knip: [
    {
      label: "knip",
      command: "bunx",
      args: ["knip", "--exclude", "exports,nsExports,types,nsTypes"],
    },
  ],
  gate: [
    { label: "lint", command: "bunx", args: ["biome", "check", "."] },
    { label: "typecheck", command: "bun", args: ["run", "typecheck"] },
    { label: "test", command: "bun", args: ["run", "test"] },
  ],
  "pre-push": [
    {
      label: "lint-tracked",
      command: "bunx",
      args: ["biome", "check", "--no-errors-on-unmatched", ...trackedLintFiles()],
    },
    {
      label: "knip",
      command: "bunx",
      args: ["knip", "--exclude", "exports,nsExports,types,nsTypes"],
    },
  ],
} as const satisfies Record<GateName, readonly GateCommand[]>;

function trackedLintFiles(): string[] {
  const result = Bun.spawnSync({
    cmd: [
      "git",
      "ls-files",
      "-z",
      "--",
      "*.ts",
      "*.tsx",
      "*.js",
      "*.jsx",
      "*.mjs",
      "*.cjs",
      "*.json",
      "*.jsonc",
      "*.css",
      "*.html",
    ],
    stdout: "pipe",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
  return result.stdout.toString().split("\0").filter(Boolean);
}

if (!gateName || !(gateName in commandsByGate)) {
  console.error(
    `Usage: bun scripts/quality-gate.ts <${Object.keys(commandsByGate).join("|")}> [files...]`,
  );
  process.exit(2);
}

for (const gateCommand of commandsByGate[gateName]) {
  console.error(`$ ${[gateCommand.command, ...gateCommand.args].join(" ")}`);
  const result = Bun.spawnSync({
    cmd: [gateCommand.command, ...gateCommand.args],
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}
