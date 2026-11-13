"""Exercise stale-publisher decisions against real committed trees."""

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("release_source", ROOT / "scripts/release-source.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class SourceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        release.ROOT = self.root
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.write("scripts/affected", (ROOT / "scripts/affected").read_text())
        (self.root / "scripts/affected").chmod(0o755)
        self.write(
            "apps/tendr/app.yml",
            "testflight: true\napp_store_automatic: true\nuses: [RDesign]\npaths: ['shared/tendr/**']\n",
        )
        self.write("apps/samplr/app.yml", "testflight: true\nuses: []\n")
        self.write("packages/RDesign/view.swift", "// fixture\n")
        self.base = self.commit()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, text=True).strip()

    def write(self, path, content="// change\n"):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "Fixture")
        return self.git("rev-parse", "HEAD")

    def test_app_dependency_extra_path_and_listing_supersede(self):
        for path in [
            "apps/tendr/view.swift",
            "packages/RDesign/view.swift",
            "shared/tendr/code.swift",
            "apps/tendr/fastlane/metadata/en-US/description.txt",
            "apps/tendr/screenshots.json",
        ]:
            with self.subTest(path=path):
                self.write(path)
                latest = self.commit()
                self.assertFalse(release.current("tendr", self.base, latest))
                self.git("reset", "--hard", self.base)

    def test_unrelated_tooling_and_documentation_do_not_supersede(self):
        for path in ["apps/samplr/view.swift", "fastlane/Fastfile", "scripts/another.py", "docs/release.md"]:
            self.write(path)
        latest = self.commit()
        self.assertTrue(release.current("tendr", self.base, latest))
        self.assertTrue(release.current("tendr", latest, latest))

    def test_incoming_configuration_is_used_without_changing_checkout(self):
        self.write("apps/tendr/app.yml", "testflight: true\napp_store_automatic: true\nuses: [NewPackage]\n")
        self.write("packages/NewPackage/view.swift")
        latest = self.commit()
        self.git("checkout", "-q", self.base)
        self.assertFalse(release.current("tendr", self.base, latest))
        result = json.loads(
            subprocess.check_output(
                [str(self.root / "scripts/affected"), self.base, "--head", latest, "--intent", "ship"], cwd=self.root
            )
        )
        self.assertEqual(["tendr"], result["apps"])

    def test_disabled_automatic_delivery_and_abandoned_source_cannot_publish(self):
        self.write("apps/tendr/app.yml", "testflight: true\napp_store_automatic: false\nuses: []\n")
        latest = self.commit()
        self.assertFalse(release.current("tendr", self.base, latest))
        self.assertFalse(release.current("tendr", latest, self.base))


if __name__ == "__main__":
    unittest.main()
