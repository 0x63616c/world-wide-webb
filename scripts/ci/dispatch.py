#!/usr/bin/env python3
"""Select actual CI consumers once; unknown inputs fail before allocating product jobs."""

import json
import os
from pathlib import Path

from select_units import CONFIG, changed_paths, select


def dispatch(paths, config, force=False):
    selected = select(paths, config, force=force)
    if selected["unmapped"]:
        raise ValueError("Declare CI ownership for: " + ", ".join(selected["unmapped"]))
    products = set()
    for unit in selected["verify"]:
        prefix = unit.split(".")[0]
        if prefix == "cloudflare":
            prefix = "control-center" if unit == "cloudflare.home" else "folding"
        if prefix not in {"repo", "credentials"}:
            products.add("tendr" if prefix == "templates" else prefix)
    languages = set()
    for path in paths:
        if path.endswith(".rs") or Path(path).name in {"Cargo.toml", "Cargo.lock"}:
            languages.add("rust")
        elif path.endswith(".py"):
            languages.add("python")
        elif path.endswith(".rb") or Path(path).name in {"Gemfile", "Gemfile.lock", "Fastfile"}:
            languages.add("ruby")
        elif path.startswith((".github/workflows/", ".github/actions/")) and path.endswith((".yml", ".yaml")):
            languages.add("actions")
    return {
        "products": sorted(products),
        "tooling": "repo.tooling" in selected["verify"],
        "security_languages": sorted(languages),
    }


def main():
    event = os.environ["EVENT"]
    paths = changed_paths(os.environ["BASE"], os.environ["HEAD"], "pull_request" if event == "pull_request" else "push")
    config = json.loads(CONFIG.read_text())
    force = paths is None or os.environ.get("FORCE") == "true"
    result = dispatch(paths or [], config, force=force)
    receipt = select(paths or [], config, force=force)
    receipt.update(
        head=os.environ["HEAD"], base=os.environ["BASE"], event="pull_request" if event == "pull_request" else "push"
    )
    temporary = Path(os.environ.get("RUNNER_TEMP", "/tmp"))
    (temporary / "ci-selection.json").write_text(json.dumps(receipt) + "\n")
    (temporary / "control-center-selection.json").write_text(
        json.dumps(dict.fromkeys(("apple", "image", "infra", "publish_apple", "publish_image", "apply_infra"), False))
        + "\n"
    )
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        for key, value in result.items():
            output.write(f"{key}={json.dumps(value, separators=(',', ':'))}\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
