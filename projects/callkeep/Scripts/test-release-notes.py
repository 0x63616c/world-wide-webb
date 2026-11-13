import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from release_notes import release_notes


class ReleaseNotesTests(unittest.TestCase):
    def setUp(self):
        self.original = Path.cwd()
        self.temp = tempfile.TemporaryDirectory()
        os.chdir(self.temp.name)
        self.addCleanup(self.restore)
        self.git("init", "-q")
        self.git("config", "user.name", "Release notes test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "tag.gpgsign", "false")

    def restore(self):
        os.chdir(self.original)
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", *args], text=True).strip()

    def commit(self, path, message, tag=None):
        file = Path(path)
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(message)
        self.git("add", ".")
        self.git("commit", "-qm", message)
        if tag:
            self.git("tag", tag)

    def test_product_tags_and_inputs_ignore_other_apps_and_orphan_distribution(self):
        self.commit("projects/callkeep/Sources/App.swift", "Old Callkeep", "callkeep/v1.0.25")
        self.commit("projects/tendr/Store.swift", "Tendr only", "v1.0.999")
        self.commit("projects/callkeep/Sources/App.swift", "Improve recording")
        notes = release_notes("1.0.26")
        self.assertIn("Improve recording", notes)
        self.assertNotIn("Tendr only", notes)
        self.assertNotIn("Old Callkeep", notes)
        self.git("tag", "callkeep/v1.0.26")
        self.assertEqual(release_notes("1.0.26"), notes)

    def test_legacy_paths_survive_history_import_without_html_execution(self):
        self.commit("Sources/Callkeep/App.swift", "<script> & recording fix")
        notes = release_notes("1.0.26")
        self.assertIn("&lt;script&gt; &amp; recording fix", notes)
        self.assertNotIn("<script>", notes)

    def test_an_unrelated_branch_release_cannot_hide_main_changes(self):
        self.commit("projects/callkeep/App.swift", "Base", "callkeep/v1.0.24")
        initial = self.git("rev-parse", "HEAD")
        self.commit("projects/callkeep/App.swift", "Other branch", "callkeep/v1.0.25")
        self.git("checkout", "-q", "--detach", initial)
        self.commit("projects/callkeep/App.swift", "Main fix")
        notes = release_notes("1.0.26")
        self.assertIn("Main fix", notes)
        self.assertNotIn("Other branch", notes)

    def test_burned_reservations_do_not_hide_changes_since_the_last_published_release(self):
        self.commit("projects/callkeep/App.swift", "Published base", "callkeep/v1.0.25")
        self.commit("projects/callkeep/App.swift", "Recorder improvement", "callkeep/v1.0.26")
        os.chdir(Path.cwd() / "projects/callkeep")
        notes = release_notes("1.0.27", previous_tag="callkeep/v1.0.25")
        self.assertIn("Recorder improvement", notes)


if __name__ == "__main__":
    unittest.main()
