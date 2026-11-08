#!/usr/bin/env python3
"""Versioned CloudKit schema operations. Never reads records or accepts tokens in argv."""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEAM = "X9E4HG27NK"
CKTOOL_VERSION = "1.0.23001"
SOURCES = [
    "apps/ios/Packages/FoldingKit/Sources/FoldingData/PrivateCloudMirror.swift",
    "apps/ios/Packages/FoldingKit/Sources/FoldingData/PrivateCloudSchemaDescription.swift",
]
ENTITIES = {"ReplicatedEvent", "ResetMarker", "TrackingInterruption", "TransferMarker"}


def run(*args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=False)
    if result.returncode:
        # Tool stderr can contain account or request details. Keep it out of logs/artifacts.
        raise SystemExit(f"{pathlib.Path(args[0]).name} failed ({result.returncode}); operation not confirmed")
    return result.stdout.strip()


def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def write_json(path, data):
    with pathlib.Path(path).open("x") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
        handle.write("\n")


def container(target):
    return "iCloud.app.getfolding.Folding" + (".Staging" if target == "staging" else "")


def cktool(command, target, environment, *args):
    return run("xcrun", "cktool", command, "--team-id", TEAM,
               "--container-id", container(target), "--environment", environment, *args)


def validate_receipt(receipt, target):
    if receipt.get("formatVersion") != 1 or receipt.get("environment") != "development":
        raise SystemExit("Expected development bootstrap receipt version 1")
    if receipt.get("container") != container(target):
        raise SystemExit("Bootstrap receipt is for another container")
    if receipt.get("commit") != run("git", "rev-parse", "HEAD"):
        raise SystemExit("Bootstrap receipt is not from this exact committed app build")
    entities = receipt.get("model", {}).get("entities", [])
    if receipt.get("model", {}).get("formatVersion") != 1 or {e["name"] for e in entities} != ENTITIES:
        raise SystemExit("Unexpected compiled mirror model")
    for entity in entities:
        expected = {"logicalID", "payload"}
        if entity["name"] in {"ReplicatedEvent", "TrackingInterruption"}:
            expected |= {"generationID", "generationRevision"}
        fields = entity.get("attributes", [])
        if {f["name"] for f in fields} != expected or not all(f["optional"] for f in fields):
            raise SystemExit("Missing/nonoptional mirror attributes")
        if not re.fullmatch(r"[a-f0-9]+", entity.get("versionHash", "")):
            raise SystemExit("Missing compiled entity version hash")
        if entity.get("localIndexes", {}).get("logicalIDIndex") != ["logicalID"]:
            raise SystemExit("Missing local identity lookup index")


def check_export_fields(path):
    # Apple's own export remains authoritative, including Core Data's private/system types.
    # This check only rejects missing app fields; it never generates or rewrites Apple schema.
    text = pathlib.Path(path).read_text()
    for entity in ENTITIES:
        match = re.search(r'RECORD\s+TYPE\s+"?CD_' + entity + r'"?\s*\((.*?)\)\s*;', text, re.S)
        if not match:
            raise SystemExit(f"Export is missing Core Data record type {entity}")
        fields = ["CD_logicalID", "CD_payload"]
        if entity in {"ReplicatedEvent", "TrackingInterruption"}:
            fields += ["CD_generationRevision", "CD_generationID"]
        for field in fields:
            if not re.search(r'\b' + field + r'\b', match[1]):
                raise SystemExit(f"Export is missing {entity}.{field}")


def load_artifact(directory):
    directory = pathlib.Path(directory).resolve()
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest.get("schema_version") != 1 or manifest.get("team_id") != TEAM:
        raise SystemExit("Unknown schema artifact/team")
    target = manifest.get("target")
    if target not in {"production", "staging"} or manifest.get("container") != container(target):
        raise SystemExit("Invalid schema artifact identity")
    if manifest.get("environment") != "development":
        raise SystemExit("Only a sealed development snapshot can be promoted")
    for name in ["schema.ckdb", "bootstrap-receipt.json"]:
        if sha(directory / name) != manifest.get("files", {}).get(name):
            raise SystemExit("Schema artifact content changed")
    if manifest.get("model_source_hashes") != {p: sha(ROOT / p) for p in SOURCES}:
        raise SystemExit("Compiled model sources changed; initialize/export the new schema first")
    check_export_fields(directory / "schema.ckdb")
    return directory, manifest


def normalized_schema(path):
    # Conservative equality: ignore whitespace/comments but preserve tokens and their order.
    # An ordering difference fails for explicit diff review rather than claiming convergence.
    pattern = r'"(?:[^"\\]|\\.)*"|//[^\n]*|/\*.*?\*/|[^\s]'
    return [m.group() for m in re.finditer(pattern, pathlib.Path(path).read_text(), re.S)
            if not m.group().startswith(("//", "/*"))]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    export = sub.add_parser("snapshot", help="Export development schema with compiled-model receipt")
    export.add_argument("--target", choices=["production", "staging"], required=True)
    export.add_argument("--receipt", type=pathlib.Path, required=True)
    export.add_argument("--output", type=pathlib.Path, required=True)
    for command in ["validate", "import-development", "verify-production"]:
        operation = sub.add_parser(command)
        operation.add_argument("--artifact", type=pathlib.Path, required=True)
        if command == "verify-production":
            operation.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    if run("xcrun", "cktool", "version") != CKTOOL_VERSION:
        raise SystemExit("Select the pinned Xcode/cktool before schema operations")
    if args.command == "snapshot":
        if run("git", "status", "--porcelain"):
            raise SystemExit("Commit source changes before sealing a schema snapshot")
        receipt = json.loads(args.receipt.read_text())
        validate_receipt(receipt, args.target)
        if args.output.exists():
            raise SystemExit("Output already exists; schema snapshots are immutable")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=args.output.parent) as temporary:
            staging = pathlib.Path(temporary)
            cktool("export-schema", args.target, "development", "--output-file", str(staging / "schema.ckdb"))
            check_export_fields(staging / "schema.ckdb")
            write_json(staging / "bootstrap-receipt.json", receipt)
            manifest = {"schema_version": 1, "team_id": TEAM, "target": args.target,
                        "container": container(args.target), "environment": "development",
                        "commit_sha": receipt["commit"], "cktool_version": CKTOOL_VERSION,
                        "created_at": datetime.datetime.now(datetime.UTC).isoformat(),
                        "model_source_hashes": {p: sha(ROOT / p) for p in SOURCES},
                        "files": {p: sha(staging / p) for p in ["schema.ckdb", "bootstrap-receipt.json"]}}
            write_json(staging / "manifest.json", manifest)
            # Rename the complete directory on the same filesystem; no partial published snapshot.
            os.rename(staging, args.output)
        print(f"Development schema snapshot: {args.output}")
        return
    directory, manifest = load_artifact(args.artifact)
    target = manifest["target"]
    if args.command in {"validate", "import-development"}:
        cktool("validate-schema", target, "development", "--file", str(directory / "schema.ckdb"))
        if args.command == "import-development":
            cktool("import-schema", target, "development", "--validate", "--file", str(directory / "schema.ckdb"))
        print("Development schema operation confirmed")
        return
    # There is intentionally no production import or reset-schema command in this wrapper.
    if args.output.exists():
        raise SystemExit("Production evidence already exists; choose a new output directory")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.output.parent) as temporary:
        staging = pathlib.Path(temporary)
        cktool("export-schema", target, "production", "--output-file", str(staging / "schema.ckdb"))
        check_export_fields(staging / "schema.ckdb")
        if normalized_schema(directory / "schema.ckdb") != normalized_schema(staging / "schema.ckdb"):
            raise SystemExit("Production schema differs; promotion is not confirmed. Export/diff in Console.")
        write_json(staging / "verification.json", {
            "schema_version": 1, "container": container(target), "environment": "production",
            "development_manifest_sha256": sha(directory / "manifest.json"),
            "production_schema_sha256": sha(staging / "schema.ckdb"),
            "verified_at": datetime.datetime.now(datetime.UTC).isoformat(),
            "result": "schema_tokens_equal", "records_or_sync_verified": False,
        })
        os.rename(staging, args.output)
    print(f"Production schema readback matched: {args.output}")


if __name__ == "__main__":
    main()
