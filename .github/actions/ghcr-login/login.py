"""Pass the scoped vault field directly to Docker; never emit decrypted vault content."""

import os
import subprocess
from pathlib import Path

root = Path(os.environ["GITHUB_WORKSPACE"])
token = subprocess.check_output(
    ["sops", "--decrypt", "--extract", '["GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN"]', str(root / "secrets/vault.yaml")],
    stderr=subprocess.DEVNULL,
).strip()
if not token:
    raise SystemExit("Container publication credential is unavailable")
subprocess.run(["docker", "login", "ghcr.io", "-u", "0x63616c", "--password-stdin"], input=token, check=True)
