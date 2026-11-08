#!/usr/bin/env python3
"""Confirm one archived build in D1 without deploying Worker code or bindings."""

import argparse
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTER_SQL = """INSERT INTO published_ios_builds
(deployment,app_id,bundle_version,source_commit,registered_at_ms)
VALUES (?1,?2,CAST(?3 AS INTEGER),?4,CAST(?5 AS INTEGER))
ON CONFLICT(deployment,app_id,bundle_version) DO UPDATE SET source_commit =
 CASE WHEN published_ios_builds.source_commit=excluded.source_commit
 THEN published_ios_builds.source_commit ELSE '' END
"""
READ_SQL = """SELECT source_commit,bundle_version,registered_at_ms FROM published_ios_builds
WHERE deployment=?1 AND app_id=?2 AND bundle_version=CAST(?3 AS INTEGER)"""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        raise RuntimeError("Cloudflare release-policy redirects are not allowed")


def identity(record, configuration, source):
    environment = record["environment"]
    if environment not in {"production", "staging"}:
        raise ValueError("Unknown release environment")
    if record["state"] not in {"archived", "uploaded", "processed", "ready_to_submit", "submitted", "approved", "live"}:
        raise ValueError("Verify the signed immutable archive before authorizing its build")
    if not re.fullmatch(r"[0-9a-f]{64}", record.get("ipa_sha256", "")):
        raise ValueError("Signed IPA identity is missing")
    if record["commit_sha"] != source or not re.fullmatch(r"[0-9a-f]{40}", source):
        raise ValueError("Build registration requires the exact verified source")
    build = record["build_number"]
    if type(build) is not int or not 1 <= build <= 2147483647:
        raise ValueError("Build number is not a bounded integer")
    app_id = record["apple_team_id"] + "." + record["bundle_id"]
    variables = configuration["vars"]
    if variables["DEPLOYMENT"] != environment or variables["APP_ATTEST_APP_ID"] != app_id:
        raise ValueError("D1 configuration belongs to another app/environment")
    worker = record.get("preview_backend_verification", {}).get("worker_version") or record.get(
        "deployed_worker_version"
    )
    if not worker or variables["WORKER_VERSION"] != worker:
        raise ValueError("Use the exact verified backend deployment configuration")
    databases = configuration["d1_databases"]
    if len(databases) != 1 or databases[0]["binding"] != "DB":
        raise ValueError("Expected one explicit application database")
    account, database = configuration["account_id"], databases[0]["database_id"]
    if not re.fullmatch(r"[0-9a-f]{32}", account) or not re.fullmatch(
        r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", database
    ):
        raise ValueError("Expected provisioned account/database identities")
    return environment, app_id, str(build), source, account, database


def query(account, database, token, sql, params):
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{database}/query",
        data=json.dumps({"sql": sql, "params": params}).encode(),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            body = json.load(response)
    except (OSError, ValueError) as error:
        raise RuntimeError("Cloudflare D1 operation was not confirmed") from error
    if (
        body.get("success") is not True
        or len(body.get("result", [])) != 1
        or body["result"][0].get("success") is not True
    ):
        raise RuntimeError("Cloudflare D1 operation failed; response payload suppressed")
    return body["result"][0].get("results", [])


def register(execute, environment, app_id, build, source):
    parameters = [environment, app_id, build]
    try:
        execute(REGISTER_SQL, [*parameters, source, str(time.time_ns() // 1_000_000)])
    except RuntimeError:
        # A lost write response is reconciled by readback, never a blind mutation retry.
        pass
    return confirm(execute, environment, app_id, build, source)


def confirm(execute, environment, app_id, build, source):
    rows = execute(READ_SQL, [environment, app_id, build])
    if len(rows) != 1 or rows[0].get("source_commit") != source or rows[0].get("bundle_version") != int(build):
        raise RuntimeError("Published build policy differs or is missing; stop distribution")
    return {
        "environment": environment,
        "app_id": app_id,
        "build_number": int(build),
        "source_sha": source,
        "registered_at_ms": rows[0]["registered_at_ms"],
    }


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--record", type=Path, required=True)
    parser.add_argument("--configuration", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--read-only", action="store_true")
    args = parser.parse_args()
    source = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).strip():
        parser.error("Commit the verified source before registering a build")
    values = identity(json.loads(args.record.read_text()), json.loads(args.configuration.read_text()), source)
    environment, app_id, build, source, account, database = values
    token = os.environ["FOLDING_RELEASE_POLICY_TOKEN"]
    operation = confirm if args.read_only else register
    receipt = operation(
        lambda sql, params: query(account, database, token, sql, params), environment, app_id, build, source
    )
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    if args.receipt.exists():
        if json.loads(args.receipt.read_text()) != receipt:
            raise RuntimeError("Existing build-policy receipt differs; do not overwrite it")
    else:
        with args.receipt.open("x") as output:
            json.dump(receipt, output, indent=2)
            output.write("\n")
    print("Confirmed the exact signed build in the application release policy")


if __name__ == "__main__":
    main()
