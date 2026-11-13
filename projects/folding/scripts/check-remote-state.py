#!/usr/bin/env python3
"""Exercise two real OpenTofu clients and encrypted backup restoration against R2."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid

import boto3

ROOT = Path(__file__).resolve().parents[1]
BUCKET = "folding-infrastructure-state"
ENDPOINT = "https://eb3ea2e5ef93e58704d39980583fee38.r2.cloudflarestorage.com"


def run(directory, *args):
    return subprocess.run(
        ["tofu", f"-chdir={directory}", *args, "-no-color"], check=True, capture_output=True, text=True
    ).stdout


def main():
    for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "TF_VAR_state_passphrase"):
        if not os.environ.get(key):
            raise SystemExit(f"Missing {key}")
    evidence_key = f"verification/{uuid.uuid4()}/state.tfstate"
    with tempfile.TemporaryDirectory(prefix="folding-state-check-") as temp:
        dirs = [Path(temp) / name for name in ("first", "contender", "restored")]
        for directory in dirs:
            directory.mkdir()
            shutil.copyfile(
                ROOT.parents[1] / "projects/folding/infra/cloudflare/state-verification/main.tf", directory / "main.tf"
            )
        for directory in dirs[:2]:
            run(directory, "init", "-input=false", f"-backend-config=key={evidence_key}")
        first = subprocess.Popen(
            ["tofu", f"-chdir={dirs[0]}", "apply", "-input=false", "-auto-approve", "-no-color"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            for line in first.stdout:
                # Match emitted output, not the preceding command-echo line.
                if line.strip().endswith(": FOLDING_LOCK_HELD"):
                    break
            else:
                raise RuntimeError("First client never confirmed holding the lock")
            contender = subprocess.run(
                [
                    "tofu",
                    f"-chdir={dirs[1]}",
                    "apply",
                    "-input=false",
                    "-auto-approve",
                    "-lock-timeout=0s",
                    "-no-color",
                ],
                capture_output=True,
                text=True,
                timeout=15,
            )
            assert contender.returncode != 0, "Competing client incorrectly acquired lock"
            assert "Error acquiring the state lock" in contender.stderr + contender.stdout
            first.communicate(timeout=35)
            assert first.returncode == 0, "First client's apply failed"
        finally:
            if first.poll() is None:
                first.terminate()
                first.wait(timeout=10)
        client = boto3.client("s3", endpoint_url=ENDPOINT, region_name="auto")
        encrypted = client.get_object(Bucket=BUCKET, Key=evidence_key)["Body"].read()
        envelope = json.loads(encrypted)
        assert "encrypted_data" in envelope and "resources" not in envelope
        backup_key = evidence_key.replace("state.tfstate", "backup.tfstate")
        restored_key = evidence_key.replace("state.tfstate", "restored.tfstate")
        # Never overwrite a previous recovery object.
        client.put_object(Bucket=BUCKET, Key=backup_key, Body=encrypted, IfNoneMatch="*")
        recovered = client.get_object(Bucket=BUCKET, Key=backup_key)["Body"].read()
        assert recovered == encrypted
        client.put_object(Bucket=BUCKET, Key=restored_key, Body=recovered, IfNoneMatch="*")
        run(dirs[2], "init", "-input=false", f"-backend-config=key={restored_key}")
        restored = json.loads(run(dirs[2], "state", "pull"))
        resources = restored["resources"]
        assert len(resources) == 1
        assert resources[0]["instances"][0]["attributes"]["input"]["value"] == "folding-r2-lock-and-restore-v1"
        print(
            json.dumps(
                {
                    "result": "pass",
                    "key": evidence_key,
                    "encrypted_backup_sha256": hashlib.sha256(encrypted).hexdigest(),
                    "lock_contention": "second client rejected",
                    "restore": "encrypted backup decrypted by independent client",
                }
            )
        )


if __name__ == "__main__":
    main()
