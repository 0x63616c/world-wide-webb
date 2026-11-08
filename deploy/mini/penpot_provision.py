#!/usr/bin/env python3
"""Generate instance secrets once; run on the mini inside ~/penpot."""

import os
import secrets
from pathlib import Path

os.umask(0o077)
root = Path(__file__).resolve().parent
target = root / "runtime.env"
if not target.exists():
    with target.open("x") as out:
        out.write(f"PENPOT_SECRET_KEY={secrets.token_urlsafe(64)}\n")
        out.write(f"PENPOT_DATABASE_PASSWORD={secrets.token_urlsafe(32)}\n")
target.chmod(0o600)
print("Instance secret file is ready; existing keys preserved")
