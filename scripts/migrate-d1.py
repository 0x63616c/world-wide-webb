#!/usr/bin/env python3
"""Apply checksum-fenced D1 migrations through the pinned Wrangler migration command."""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "backend/migrations"
WRANGLER = ROOT / "backend/node_modules/wrangler/bin/wrangler.js"
VERSION = "4.158.0"
LEDGER = "folding_migration_checksums"
TABLE = "d1_migrations"
DDL = f"""CREATE TABLE IF NOT EXISTS {LEDGER} (
  name TEXT PRIMARY KEY NOT NULL,
  ordinal INTEGER NOT NULL UNIQUE CHECK (ordinal > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  source_bytes INTEGER NOT NULL CHECK (source_bytes > 0),
  source_commit TEXT NOT NULL CHECK (length(source_commit) = 40),
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);"""


def run(args, *, checked=True, environment=None):
    result = subprocess.run(args, cwd=ROOT, env=environment, stdin=subprocess.DEVNULL,
                            capture_output=True, text=True, check=False)
    if checked and result.returncode:
        raise RuntimeError(f"{pathlib.Path(args[0]).name} failed ({result.returncode}); inspect migration state before retry")
    return result


def git(*args):
    return run(["git", *args]).stdout.strip()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path = pathlib.Path(path)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    os.replace(temporary, path)


def sources(require_committed, migrations=MIGRATIONS):
    rows = []
    files = sorted(migrations.glob("*.sql"))
    if not files:
        raise RuntimeError("No migrations")
    for ordinal, file in enumerate(files, 1):
        if not re.fullmatch(r"[0-9]{4}_[a-z0-9_]+\.sql", file.name) or int(file.name[:4]) != ordinal:
            raise RuntimeError("Migration filenames must form one contiguous numbered prefix starting at 0001")
        if file.is_symlink():
            raise RuntimeError("Migration symlinks are not allowed")
        raw = file.read_bytes()
        if require_committed:
            committed = subprocess.run(["git", "show", f"HEAD:{file.relative_to(ROOT)}"], cwd=ROOT,
                                       capture_output=True, check=False)
            if committed.returncode or committed.stdout != raw:
                raise RuntimeError(f"Commit exact migration source before apply: {file.name}")
        sql = raw.decode("utf-8")
        if not raw or sql.startswith("\ufeff"):
            raise RuntimeError("Empty/BOM migration is unsupported")
        # Conservative lexical restriction; reserved ledger names are never valid source SQL.
        no_comments = re.sub(r"--[^\n]*|/\*.*?\*/", " ", sql, flags=re.S)
        if re.search(rf"\b({TABLE}|{LEDGER})\b", no_comments, re.I):
            raise RuntimeError("Source migrations may not manage the migration ledgers")
        if re.search(r"(?:\A|;)\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|ATTACH|DETACH|VACUUM)\b", no_comments, re.I):
            raise RuntimeError("Explicit transactions/external database operations are unsupported")
        rows.append({"name": file.name, "ordinal": ordinal, "sha256": sha(raw),
                     "source_bytes": len(raw), "sql": sql})
    return rows


def instrument(row, previous, commit):
    # A failing CHECK aborts this same Wrangler migration batch. No separate success write.
    checks = [f"(SELECT count(*) FROM {LEDGER}) = {len(previous)}",
              f"(SELECT count(*) FROM {TABLE}) = {len(previous)}"]
    for prior in previous:
        checks += [f"EXISTS (SELECT 1 FROM {LEDGER} WHERE name='{prior['name']}' AND ordinal={prior['ordinal']} AND sha256='{prior['sha256']}' AND source_bytes={prior['source_bytes']})",
                   f"EXISTS (SELECT 1 FROM {TABLE} WHERE name='{prior['name']}')"]
    guard = " AND ".join(checks)
    return DDL + f"""\nINSERT INTO {LEDGER}(name,ordinal,sha256,source_bytes,source_commit)
VALUES ('{row['name']}',{row['ordinal']},CASE WHEN {guard}
THEN '{row['sha256']}' ELSE '' END,{row['source_bytes']},'{commit}');
-- Exact source bytes below; wrapper adds only a boundary newline/semicolon afterwards.
""" + row["sql"] + "\n;\n"


def prepare(configuration, target, output, require_committed, database_kind="application"):
    if database_kind not in ("application", "watchdog"):
        raise RuntimeError("Invalid database kind")
    watchdog = database_kind == "watchdog"
    migrations = ROOT / ("backend/watchdog/migrations" if watchdog else "backend/migrations")
    expected_binding = "MONITOR_DB" if watchdog else "DB"
    expected_name = f"folding-watchdog-{target}" if watchdog else f"folding-{target}"
    config = json.loads(pathlib.Path(configuration).read_text())
    if config.get("vars", {}).get("DEPLOYMENT") != target:
        raise RuntimeError("Generated config environment does not match --environment")
    databases = config.get("d1_databases", [])
    if len(databases) != 1 or databases[0].get("binding") != expected_binding:
        raise RuntimeError("Expected exactly one generated database binding for this kind")
    database = databases[0]
    if database.get("database_name") != expected_name:
        raise RuntimeError("Unexpected database name; inspect the OpenTofu outputs")
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", database.get("database_id", "")):
        raise RuntimeError("Expected provisioned database UUID")
    if database.get("migrations_table", TABLE) != TABLE or database.get("preview_database_id"):
        raise RuntimeError("Custom/preview migration targets are unsupported")
    if not re.fullmatch(r"[a-f0-9]{32}", config.get("account_id", "")):
        raise RuntimeError("Expected explicit Cloudflare account ID")
    commit = git("rev-parse", "HEAD")
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise RuntimeError("Expected committed source identity")
    if require_committed and config.get("vars", {}).get("WORKER_VERSION") != commit:
        raise RuntimeError("Regenerate deployment config for this commit before apply")
    package = json.loads((ROOT / "backend/node_modules/wrangler/package.json").read_text())
    if package.get("version") != VERSION:
        raise RuntimeError("Install pinned Wrangler before migration operations")
    rows = sources(require_committed, migrations)
    if require_committed:
        tracked = set(git("ls-tree", "-r", "--name-only", "HEAD", str(migrations.relative_to(ROOT))).splitlines())
        present = {str((migrations / row["name"]).relative_to(ROOT)) for row in rows}
        if tracked != present:
            raise RuntimeError("Migration files were added/deleted outside the committed history")
    output = pathlib.Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    folder = output / "migrations"
    folder.mkdir()
    for index, row in enumerate(rows):
        (folder / row["name"]).write_text(instrument(row, rows[:index], commit))
    minimal = {"name": f"{expected_name}-migrations", "account_id": config["account_id"],
               "compatibility_date": config["compatibility_date"], "d1_databases": [{
                   "binding": "DB", "database_name": database["database_name"],
                   "database_id": database["database_id"], "migrations_dir": str(folder),
                   "migrations_table": TABLE}]}
    write_json(output / "wrangler.json", minimal)
    manifest = {"schema_version": 1, "environment": target, "database_kind": database_kind, "account_id": config["account_id"],
                "database_name": database["database_name"], "database_id": database["database_id"],
                "commit_sha": commit, "wrangler_version": VERSION,
                "wrangler_cli_sha256": sha((ROOT / "backend/node_modules/wrangler/wrangler-dist/cli.js").read_bytes()),
                "wrapper_sha256": sha(pathlib.Path(__file__).read_bytes()),
                "migration_contract": "wrangler-per-migration-rollback",
                "migrations": [{k: v for k, v in row.items() if k != "sql"} | {
                    "instrumented_sha256": sha((folder / row["name"]).read_bytes())} for row in rows]}
    write_json(output / "manifest.json", manifest)
    return output, manifest


class Database:
    def __init__(self, directory, manifest, local=False, persist_to=None):
        self.base = ["node", str(WRANGLER), "d1"]
        self.flags = ["--config", str(directory / "wrangler.json"), "--local" if local else "--remote"]
        if local:
            self.flags += ["--persist-to", str(pathlib.Path(persist_to).resolve())]
        self.name = manifest["database_name"]
        self.environment = dict(os.environ, CI="true", WRANGLER_SEND_METRICS="false")
        if self.environment.get("WRANGLER_LOG", "").lower() == "debug":
            raise RuntimeError("Disable Wrangler debug logging before credential-dependent operations")

    def query(self, sql):
        result = run(self.base + ["execute", self.name, "--command", sql, "--json"] + self.flags,
                     environment=self.environment)
        responses = json.loads(result.stdout)
        if not isinstance(responses, list) or len(responses) != 1 or responses[0].get("success") is not True:
            raise RuntimeError("Unexpected Wrangler D1 read response")
        return responses[0].get("results", [])

    def state(self):
        tables = {row["name"] for row in self.query(f"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('{TABLE}','{LEDGER}');")}
        applied = self.query(f"SELECT name FROM {TABLE} ORDER BY id;") if TABLE in tables else []
        ledger = self.query(f"SELECT name,ordinal,sha256,source_bytes,source_commit FROM {LEDGER} ORDER BY ordinal;") if LEDGER in tables else []
        return applied, ledger

    def apply(self):
        return run(self.base + ["migrations", "apply", self.name] + self.flags,
                   environment=self.environment, checked=False)


def validate_state(state, manifest):
    applied, ledger = state
    expected = manifest["migrations"]
    names = [row["name"] for row in applied]
    if names != [row["name"] for row in expected[:len(names)]]:
        raise RuntimeError("Applied migrations are not a prefix of this source history")
    if len(ledger) != len(applied):
        raise RuntimeError("Unchecksummed or inconsistent migration state; no automatic baseline adoption")
    for row, source in zip(ledger, expected):
        if any(row.get(key) != source[key] for key in ("name", "ordinal", "sha256", "source_bytes")):
            raise RuntimeError("Applied migration bytes/order changed; append a forward repair")
        if not re.fullmatch(r"[a-f0-9]{40}", row.get("source_commit", "")):
            raise RuntimeError("Invalid durable migration provenance")
    return len(applied)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare", "status", "apply"])
    parser.add_argument("--configuration", type=pathlib.Path, required=True)
    parser.add_argument("--environment", choices=["staging", "production"], required=True)
    parser.add_argument("--database-kind", choices=["application", "watchdog"], default="application")
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--local", action="store_true", help="Use isolated Wrangler local database only")
    parser.add_argument("--persist-to", type=pathlib.Path)
    args = parser.parse_args()
    if args.local != bool(args.persist_to):
        parser.error("--local and --persist-to must be supplied together")
    destination = args.output or ROOT / "build/migrations" / args.environment / str(uuid.uuid4())
    directory, manifest = prepare(args.configuration, args.environment, destination, args.command == "apply", args.database_kind)
    if args.command == "prepare":
        print(f"Prepared {len(manifest['migrations'])} migrations: {directory}")
        return
    database = Database(directory, manifest, args.local, args.persist_to)
    count = validate_state(database.state(), manifest)
    report = {"schema_version": 1, "before_applied": count, "database_id": manifest["database_id"],
              "environment": args.environment, "local": args.local, "manifest_sha256": sha((directory / "manifest.json").read_bytes())}
    write_json(directory / "result.json", report)
    if args.command == "status":
        print(f"Verified {count} applied migrations; {len(manifest['migrations']) - count} pending")
        return
    result = database.apply()
    # Read durable provider state even after a nonzero exit. A killed wrapper resumes by re-running.
    after = validate_state(database.state(), manifest)
    report.update(after_applied=after, cli_exit_code=result.returncode,
                  verified_at=datetime.datetime.now(datetime.UTC).isoformat(),
                  complete=after == len(manifest["migrations"]))
    write_json(directory / "result.json", report)
    if result.returncode or not report["complete"]:
        raise RuntimeError(f"Migration attempt stopped; {after} durable migrations verified. Retained evidence: {directory}. Resume the wrapper after inspecting the failure.")
    print(f"Verified all {after} migrations and source hashes: {directory}")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, KeyError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
