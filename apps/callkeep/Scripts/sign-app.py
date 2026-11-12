#!/usr/bin/env python3
"""Sign nested frameworks, helpers and app from the inside out."""

from pathlib import Path
import subprocess
import sys

app = Path(sys.argv[1])
identity = sys.argv[2]
command = ["codesign", "--force", "--sign", identity, "--timestamp", "--options", "runtime"]
if len(sys.argv) > 3:
    command += ["--keychain", sys.argv[3]]
components = {
    path
    for path in (app / "Contents" / "Frameworks").rglob("*")
    if not path.is_symlink() and (path.suffix in {".framework", ".app", ".xpc"} or path.name == "Autoupdate")
}
components.update((app / "Contents" / "MacOS").glob("*.dylib"))
for component in sorted(components, key=lambda path: (-len(path.parts), str(path))):
    subprocess.run(command + ["--preserve-metadata=entitlements", str(component)], check=True)
entitlements = Path(__file__).resolve().parent.parent / "Resources" / "Callkeep-iCloud.entitlements"
subprocess.run(command + ["--entitlements", str(entitlements), str(app)], check=True)
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
