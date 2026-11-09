import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import promote_control_center as promotion


class ControlCenterPromotionTests(unittest.TestCase):
    CI = "https://github.com/0x63616c/world-wide-webb/actions/runs/123/attempts/2"

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.remote = self.root / "remote.git"
        self.repo = self.root / "work"
        self.run = subprocess.run
        self.command(self.root, "init", "--bare", "--initial-branch=main", str(self.remote))
        self.command(self.root, "clone", str(self.remote), str(self.repo))
        self.identity(self.repo)
        self.seed = self.commit("server.rs", "seed")
        manifest = {
            "schemaVersion": 2,
            "sourceRepository": "0x63616c/world-wide-webb",
            "sourceRevision": self.seed,
            "image": self.image("0"),
            "databaseEngine": "sqlite",
        }
        self.commit(promotion.MANIFEST, json.dumps(manifest))
        self.a = self.commit("server.rs", "first image source")
        self.command(self.repo, "push", "origin", "main")

    def command(self, root, *args):
        result = self.run(["git", *args], cwd=root, capture_output=True, text=True, check=True)
        return result.stdout.strip()

    def identity(self, repo):
        self.command(repo, "config", "user.name", "Fixture")
        self.command(repo, "config", "user.email", "fixture@example.test")

    def commit(self, name, content, repo=None):
        repo = repo or self.repo
        target = repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        self.command(repo, "add", name)
        self.command(repo, "commit", "-m", "fixture")
        return self.command(repo, "rev-parse", "HEAD")

    @staticmethod
    def image(digit):
        return "ghcr.io/0x63616c/www-control-center-mini@sha256:" + digit * 64

    def pin(self):
        return json.loads(self.command(self.remote, "show", "main:" + promotion.MANIFEST))

    def promote(self, source=None, digit="1", repo=None):
        return promotion.promote(repo or self.repo, source or self.a, self.image(digit), self.CI, str(self.remote))

    def other(self):
        other = self.root / "other"
        self.command(self.root, "clone", str(self.remote), str(other))
        self.identity(other)
        return other

    def test_only_image_pin_changes_and_retry_does_not_create_another_commit(self):
        before = self.command(self.repo, "rev-parse", "HEAD")
        result = self.promote()
        after = self.command(self.remote, "rev-parse", "main")
        self.assertEqual(result, {"status": "pin-committed", "commit": after})
        self.assertEqual(
            self.command(self.repo, "diff-tree", "--no-commit-id", "--name-only", "-r", after), promotion.MANIFEST
        )
        self.assertEqual(self.pin()["sourceRevision"], self.a)
        self.assertEqual(self.pin()["image"], self.image("1"))
        self.assertIn("Verified-CI: " + self.CI, self.command(self.remote, "show", "-s", "--format=%B", after))
        self.assertEqual(self.command(self.repo, "rev-parse", "HEAD"), before)
        self.assertEqual(self.command(self.repo, "status", "--porcelain"), "")
        self.assertEqual(self.promote(), {"status": "already-pinned", "commit": after})
        self.assertEqual(self.command(self.remote, "rev-parse", "main"), after)

    def test_proposal_leaves_main_untouched_and_reuses_the_same_branch(self):
        before = self.command(self.remote, "rev-parse", "main")
        branch = "codex/control-center-image-" + self.a
        result = promotion.promote(self.repo, self.a, self.image("1"), self.CI, str(self.remote), branch)
        self.assertEqual(result["status"], "pin-proposed")
        self.assertEqual(self.command(self.remote, "rev-parse", "main"), before)
        proposed = json.loads(self.command(self.remote, "show", branch + ":" + promotion.MANIFEST))
        self.assertEqual(proposed["sourceRevision"], self.a)
        self.assertEqual(proposed["image"], self.image("1"))
        self.assertEqual(
            promotion.promote(self.repo, self.a, self.image("1"), self.CI, str(self.remote), branch), result
        )
        with self.assertRaisesRegex(promotion.PromotionError, "different immutable image"):
            promotion.promote(self.repo, self.a, self.image("2"), self.CI, str(self.remote), branch)

    def test_same_source_cannot_get_different_bytes(self):
        self.promote()
        with self.assertRaisesRegex(promotion.PromotionError, "different image"):
            self.promote(digit="2")
        self.assertEqual(self.pin()["image"], self.image("1"))

    def test_late_old_image_cannot_rewind_a_newer_pin(self):
        self.promote()
        self.command(self.repo, "merge", "--ff-only", "FETCH_HEAD")
        newer = self.commit("server.rs", "second image source")
        self.command(self.repo, "push", "origin", "main")
        self.promote(newer, "2")
        with self.assertRaisesRegex(promotion.PromotionError, "older or divergent"):
            self.promote()
        self.assertEqual(self.pin()["sourceRevision"], newer)

    def test_unmerged_source_is_rejected_without_a_remote_change(self):
        before = self.command(self.remote, "rev-parse", "main")
        self.command(self.repo, "switch", "-c", "feature")
        feature = self.commit("server.rs", "unmerged")
        with self.assertRaisesRegex(promotion.PromotionError, "outside authoring main"):
            self.promote(feature)
        self.assertEqual(self.command(self.remote, "rev-parse", "main"), before)

    def test_concurrent_authoring_is_preserved_when_the_pin_is_recomputed(self):
        other = self.other()
        raced = False

        def run(args, **kwargs):
            nonlocal raced
            if args[:2] == ["git", "push"] and not raced:
                raced = True
                self.commit("unrelated.txt", "keep concurrent work", other)
                self.command(other, "push", "origin", "main")
            return self.run(args, **kwargs)

        with patch.object(promotion.subprocess, "run", side_effect=run):
            self.promote()
        self.assertTrue(raced)
        self.assertEqual(self.command(self.remote, "show", "main:unrelated.txt"), "keep concurrent work")
        self.assertEqual(self.pin()["sourceRevision"], self.a)

    def test_concurrently_promoted_newer_image_wins(self):
        newer = self.commit("server.rs", "newer image source")
        self.command(self.repo, "push", "origin", "main")
        other = self.other()
        raced = False

        def run(args, **kwargs):
            nonlocal raced
            if args[:2] == ["git", "push"] and not raced:
                raced = True
                self.promote(newer, "2", other)
            return self.run(args, **kwargs)

        with patch.object(promotion.subprocess, "run", side_effect=run):
            with self.assertRaisesRegex(promotion.PromotionError, "older or divergent"):
                self.promote()
        self.assertEqual(self.pin()["sourceRevision"], newer)

    def test_lost_successful_push_response_is_reconciled_by_readback(self):
        def run(args, **kwargs):
            result = self.run(args, **kwargs)
            if args[:2] == ["git", "push"] and result.returncode == 0:
                result.returncode = 128
            return result

        with patch.object(promotion.subprocess, "run", side_effect=run):
            result = self.promote()
        self.assertEqual(result["status"], "pin-committed")
        self.assertEqual(self.pin()["sourceRevision"], self.a)


if __name__ == "__main__":
    unittest.main()
