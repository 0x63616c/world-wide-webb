import json
import tomllib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class MisePinsTests(unittest.TestCase):
    def test_shared_pins_match_existing_product_and_tooling_versions(self):
        shared = tomllib.loads((ROOT / "mise.toml").read_text())["tools"]
        folding = json.loads((ROOT / "apps/folding/tool-versions.json").read_text())
        for name in ("bun", "node", "python", "xcodegen", "opentofu"):
            self.assertEqual(shared[name], folding[name])
        self.assertEqual(shared["opentofu"], (ROOT / ".opentofu-version").read_text().strip())

    def test_folding_ruby_matches_release_pin(self):
        local = tomllib.loads((ROOT / "apps/folding/mise.toml").read_text())["tools"]
        folding = json.loads((ROOT / "apps/folding/tool-versions.json").read_text())
        self.assertEqual(local["ruby"], folding["ruby"])
