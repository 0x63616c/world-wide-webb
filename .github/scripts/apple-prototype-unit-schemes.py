"""Restrict generated CI schemes to the bundles this workflow already executes.

xcodebuild's -only-testing limits execution, but build-for-testing still builds
other TestableReferences. Independent runners cannot reuse those extra builds.
"""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


def restrict_scheme(path, target):
    tree = ET.parse(path)
    testables = tree.getroot().find("TestAction/Testables")
    if testables is None:
        raise ValueError(f"No testables in {path}")
    selected = []
    for testable in list(testables):
        reference = testable.find("BuildableReference")
        if reference is not None and reference.get("BlueprintName") == target:
            selected.append(testable)
        else:
            testables.remove(testable)
    if len(selected) != 1:
        raise ValueError(f"Expected exactly one {target} testable in {path}")
    tree.write(path, encoding="UTF-8", xml_declaration=True)


if __name__ == "__main__":
    schemes = Path(sys.argv[1]) / "xcshareddata/xcschemes"
    for scheme, target in [("WorldWideWebb-iPad", "WorldWideWebbTests"), ("Panel", "PanelTests")]:
        restrict_scheme(schemes / f"{scheme}.xcscheme", target)
