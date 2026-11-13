import json
import tomllib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class MisePinsTests(unittest.TestCase):
    def test_shared_pins_match_existing_product_and_tooling_versions(self):
        shared = tomllib.loads((ROOT / "mise.toml").read_text())["tools"]
        folding = json.loads((ROOT / "projects/folding/tool-versions.json").read_text())
        for name in ("bun", "node", "python", "xcodegen", "opentofu"):
            self.assertEqual(shared[name], folding[name])
        self.assertEqual(shared["opentofu"], (ROOT / ".opentofu-version").read_text().strip())
        self.assertEqual(shared["ruby"], folding["ruby"])
