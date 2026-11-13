#!/usr/bin/env python3
"""Prove the selected OpenTofu backend without Cloudflare credentials or resources."""

import json
import os
import shlex
import shutil
import subprocess
import tempfile
import time
from pathlib import Path


def main():
    binary = shutil.which("tofu")
    if not binary:
        raise RuntimeError("install pinned OpenTofu first")
    with tempfile.TemporaryDirectory(prefix="www-state-proof-") as scratch:
        root = Path(scratch)
        env = dict(os.environ, TF_VAR_state_passphrase="fixture-only-open-tofu-encryption-passphrase")
        command = "python3 -c " + shlex.quote(
            "from pathlib import Path; import time; Path('lock-held').touch(); time.sleep(5)"
        )
        configuration = """variable "state_passphrase" {
  type=string
  sensitive=true
}
terraform {
  backend "local" {}
  encryption {
    key_provider "pbkdf2" "state" { passphrase=var.state_passphrase }
    method "aes_gcm" "state" { keys=key_provider.pbkdf2.state }
    state {
      method=method.aes_gcm.state
      enforced=true
    }
    plan {
      method=method.aes_gcm.state
      enforced=true
    }
  }
}
resource "terraform_data" "proof" {
  input="plaintext-sentinel-must-be-encrypted"
  provisioner "local-exec" { command=COMMAND }
}
output "proof" { value=terraform_data.proof.output }
""".replace("COMMAND", json.dumps(command))
        (root / "main.tf").write_text(configuration)

        def run(*args, check=True, environment=None):
            result = subprocess.run(
                [binary, *args], cwd=root, env=environment or env, stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )
            if check and result.returncode:
                raise RuntimeError("isolated OpenTofu proof command failed: " + args[0])
            return result

        run("init", "-input=false")
        with (root / "apply.log").open("wb") as log:
            process = subprocess.Popen(
                [binary, "apply", "-input=false", "-auto-approve"], cwd=root, env=env, stdout=log, stderr=log
            )
            try:
                deadline = time.monotonic() + 15
                while not (root / "lock-held").exists():
                    if process.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError("state-lock proof did not reach its held lock")
                    time.sleep(0.02)
                competitor = run("apply", "-input=false", "-auto-approve", "-lock-timeout=0s", check=False)
                if (
                    competitor.returncode == 0
                    or b"Error acquiring the state lock" not in competitor.stderr + competitor.stdout
                ):
                    raise RuntimeError("concurrent state writer was not rejected")
                if process.wait(timeout=15) != 0:
                    raise RuntimeError("first isolated state writer failed")
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=10)
        state = root / "terraform.tfstate"
        encrypted = state.read_bytes()
        assert b"plaintext-sentinel" not in encrypted
        assert run("output", "-raw", "proof").stdout == b"plaintext-sentinel-must-be-encrypted"
        wrong = dict(env, TF_VAR_state_passphrase="fixture-only-wrong-encryption-passphrase")
        assert run("output", "-raw", "proof", check=False, environment=wrong).returncode != 0
        backup = root / "verified-backup.tfstate"
        backup.write_bytes(encrypted)
        state.write_bytes(b"broken state fixture")
        state.write_bytes(backup.read_bytes())
        assert run("output", "-raw", "proof").stdout == b"plaintext-sentinel-must-be-encrypted"
    print("PASS: encrypted state, exclusive native lock, wrong-key rejection and backup restore")


if __name__ == "__main__":
    main()
