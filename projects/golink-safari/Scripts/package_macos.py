#!/usr/bin/env python3
"""Archive generated Mac apps and remove their competing system registrations."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRAR = "/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Support/lsregister"


def package(derived_data, build_succeeded, *, root=ROOT, run=subprocess.run):
    derived_data = derived_data.resolve()
    allowed = [root.resolve() / "build" / name for name in ("macos", "macos-release")]
    if derived_data not in allowed:
        raise ValueError("Refusing to clean outside this product's generated Mac build directories")
    problems = []
    for app in sorted((derived_data / "Build/Products").glob("*/Golink.app")):
        if app.is_symlink() or not app.is_dir() or derived_data not in app.resolve().parents:
            raise ValueError("Refusing to clean a redirected generated app")
        extensions = sorted(app.glob("Contents/PlugIns/*.appex"))
        for extension in extensions:
            if extension.is_symlink() or app.resolve() not in extension.resolve().parents:
                raise ValueError("Refusing to unregister a redirected Safari extension")
        archive = app.with_suffix(".zip" if build_succeeded else ".failed-build.zip")
        try:
            run(["ditto", "-c", "-k", "--keepParent", str(app), str(archive)], check=True)
        except subprocess.CalledProcessError:
            problems.append("Could not archive generated app; preserving it for diagnosis")
            continue
        for extension in extensions:
            result = run(["pluginkit", "-r", str(extension)], capture_output=True, text=True)
            if result.returncode and "no plugin at" not in result.stdout + result.stderr:
                problems.append("Could not unregister generated Safari extension")
        result = run([REGISTRAR, "-u", str(app)], capture_output=True, text=True)
        if result.returncode and "-10814" not in result.stdout + result.stderr:
            problems.append("Could not unregister generated app")
        # Remove only the generated bundle whose recovery ZIP just succeeded.
        # Never touch the separately installed app or its registrations.
        shutil.rmtree(app)
        print(f"Packaged generated app: {archive}")
    if problems:
        raise RuntimeError("; ".join(problems))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("derived_data", type=Path)
    parser.add_argument("build_status", type=int)
    args = parser.parse_args()
    try:
        package(args.derived_data, args.build_status == 0)
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Golink build cleanup failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
