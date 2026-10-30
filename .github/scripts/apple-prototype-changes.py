"""Conservative native CI dependency map; unknown native paths run every suite."""
import json
import sys

ALL = ["macos", "ipad", "panel"]


def affected_suites(paths):
    affected = set()
    for path in paths:
        if path == ".github/workflows/apple-prototype-ci.yml" or path.startswith(
            ".github/scripts/apple-prototype-"
        ):
            return ALL
        prefix = "apps/apple-prototype/"
        if not path.startswith(prefix):
            continue
        directory = path[len(prefix):].split("/")[0]
        if directory in {"Hybrid", "HybridTests", "HybridUITests", "NextAlarmWidget"}:
            affected.add("panel")
        elif directory in {"Tests", "UITests", "WalkActivity"}:
            affected.add("ipad")
        else:
            # Sources, Shared, PanelKit (including fixtures), project.yml, and
            # new/unknown directories may affect every consumer.
            return ALL
    return [suite for suite in ALL if suite in affected]


if __name__ == "__main__":
    print("suites=" + json.dumps(affected_suites(sys.stdin.read().splitlines()), separators=(",", ":")))
