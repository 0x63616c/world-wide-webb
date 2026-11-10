#!/usr/bin/env python3
"""Bounded, signed output reuse for verification; never cache the entire Nix store."""

import argparse
import json
import os
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path

MAX_BYTES = 2 * 1024**3
TIMEOUT = 120
PUBLIC_KEY = Path(__file__).with_name("nix-cache.pub")


def closure_size(info):
    values = info.values() if isinstance(info, dict) else info
    return sum(row["narSize"] for row in values)


def command(arguments, deadline, **kwargs):
    # Terminate the full client process group; cache work has a single shared budget.
    with subprocess.Popen(arguments, start_new_session=True, **kwargs) as child:
        try:
            output, _ = child.communicate(timeout=max(0.01, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
            raise
        if child.returncode:
            raise subprocess.CalledProcessError(child.returncode, arguments)
        return output


def transfer(operation, directory, roots_file):
    started = time.monotonic()
    deadline = started + TIMEOUT
    result = {"operation": operation, "status": "miss"}
    secret = os.environ.pop("NIX_CI_CACHE_SIGNING_KEY", None)
    try:
        if operation == "restore":
            if (directory / "nix-cache-info").is_file():
                command(
                    [
                        "nix",
                        "copy",
                        "--from",
                        directory.as_uri(),
                        "--all",
                        "--extra-trusted-public-keys",
                        PUBLIC_KEY.read_text().strip(),
                    ],
                    deadline,
                )
                result["status"] = "restored"
        else:
            # Only a protected main push or deliberately dispatched reviewed build
            # receives the key from the workflow. Pull requests only restore.
            if not secret:
                result["status"] = "no-signing-key"
                return result
            roots = json.loads(roots_file.read_text())
            if not roots or any(not isinstance(p, str) or not p.startswith("/nix/store/") for p in roots):
                raise ValueError("Invalid built output roots")
            info = json.loads(
                command(["nix", "path-info", "--recursive", "--json", *roots], deadline, stdout=subprocess.PIPE)
            )
            result["closureBytes"] = closure_size(info)
            if result["closureBytes"] > MAX_BYTES:
                result["status"] = "over-size-budget"
                return result
            with tempfile.NamedTemporaryFile(mode="w", prefix="nix-ci-signing-") as key:
                key.write(secret)
                key.flush()
                command(["nix", "store", "sign", "--recursive", "--key-file", key.name, *roots], deadline)
            # A snapshot contains only this build's closure, never accumulated history.
            shutil.rmtree(directory, ignore_errors=True)
            directory.mkdir(parents=True)
            command(["nix", "copy", "--to", directory.as_uri() + "?compression=zstd", *roots], deadline)
            result["status"] = "exported"
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        # Cache unavailability is visible but cannot replace or weaken a real build.
        result.update(status="unavailable", error=type(error).__name__)
        print("::warning::Optional Nix output cache unavailable; required builds remain enabled")
    finally:
        result["seconds"] = round(time.monotonic() - started, 3)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["restore", "export"])
    parser.add_argument("directory", type=Path)
    parser.add_argument("--roots", type=Path, default=Path("nix-built-roots.json"))
    args = parser.parse_args()
    result = transfer(args.operation, args.directory.resolve(), args.roots)
    Path(os.environ.get("RUNNER_TEMP", tempfile.gettempdir()), "nix-cache-" + args.operation + ".json").write_text(
        json.dumps(result, indent=2) + "\n"
    )
    print(json.dumps(result))
    if args.operation == "export" and os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write("ready=" + str(result["status"] == "exported").lower() + "\n")


if __name__ == "__main__":
    main()
