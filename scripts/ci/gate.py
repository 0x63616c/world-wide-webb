#!/usr/bin/env python3
"""One required result covers every selected product, with failures and skips explicit."""

import json
import os


def verify(needs):
    if needs.get("changes", {}).get("result") != "success":
        raise ValueError("CI input selection did not succeed")
    outputs = needs["changes"]["outputs"]
    products = json.loads(outputs["products"])
    for name in (
        "control-center",
        "folding",
        "tendr",
        "tapes",
        "callkeep",
        "golink",
        "minecraft",
        "golden-pixel",
        "homelab",
        "sites",
        "typecheck",
        "test-unit",
        "security",
    ):
        selected = name in products
        if name == "tendr":
            # The Standard iOS job builds every standard_ios app, Tapes included.
            selected = bool({"tendr", "tapes"}.intersection(products))
        if name in {"typecheck", "test-unit"}:
            selected = outputs["tooling"] == "true"
        elif name == "security":
            selected = bool(json.loads(outputs["security_languages"]))
        expected = "success" if selected else "skipped"
        if needs.get(name, {}).get("result") != expected:
            raise ValueError(f"{name}: expected {expected}")


if __name__ == "__main__":
    verify(json.loads(os.environ["CI_NEEDS"]))
