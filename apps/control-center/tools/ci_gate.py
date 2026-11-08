#!/usr/bin/env python3
"""Required checks cannot turn green through an accidental job skip."""

import json
import os


def verify(needs):
    for name in ["changes"]:
        if needs.get(name, {}).get("result") != "success":
            raise ValueError(f"{name} must succeed")
    selected = needs["changes"].get("outputs", {})
    for job, output in [
        ("typecheck", "checks"),
        ("test-unit", "checks"),
        ("apple", "apple"),
        ("image", "image"),
        ("infra", "infra"),
    ]:
        flag = selected.get(output)
        if flag not in ["true", "false"]:
            raise ValueError(f"{output} selection is missing")
        result = needs.get(job, {}).get("result")
        if result != "success" and not (flag == "false" and result == "skipped"):
            raise ValueError(f"{job} did not satisfy its selected check")


if __name__ == "__main__":
    verify(json.loads(os.environ["CI_NEEDS"]))
