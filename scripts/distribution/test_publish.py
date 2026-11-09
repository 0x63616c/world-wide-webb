"""Real Git promotion: one immutable prebuilt tag, idempotent retries, no source refs."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import prepare
import publish


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.payload = self.root / "payload"
        (self.payload / "bin").mkdir(parents=True)
        for name in ("homelab", "homelab-host", "hl"):
            path = self.payload / "bin" / name
            path.write_text("synthetic prebuilt executable\n")
            path.chmod(0o755)
        self.remote = self.root / "remote.git"
        prepare.run("git", "init", "-q", "--bare", str(self.remote))
        self.prepared = self.assemble("first")

    def assemble(self, name):
        return prepare.assemble(
            self.payload, self.root / name, source="a" * 40, timestamp="1794160000", product="homelab", version="0.4.2"
        )

    def test_publication_and_lost_response_retry_keep_one_tag_without_source_history(self):
        for _ in range(2):
            self.assertEqual(publish.publish(self.prepared, str(self.remote)), self.prepared["commit"])
        refs = prepare.run("git", "for-each-ref", "--format=%(refname)", cwd=self.remote).splitlines()
        self.assertEqual(refs, ["refs/tags/dist/homelab/v0.4.2"])
        self.assertEqual(prepare.run("git", "show", "-s", "--format=%P", self.prepared["commit"], cwd=self.remote), "")
        missing_source = subprocess.run(["git", "cat-file", "-e", "a" * 40], cwd=self.remote, capture_output=True)
        self.assertNotEqual(missing_source.returncode, 0)

    def test_a_different_build_cannot_replace_the_same_artifact_tag(self):
        publish.publish(self.prepared, str(self.remote))
        (self.payload / "bin/homelab").write_text("different binary bytes\n")
        other = self.assemble("other")
        with self.assertRaisesRegex(ValueError, "Immutable"):
            publish.publish(other, str(self.remote))
        self.assertEqual(publish.remote_commit(str(self.remote), self.prepared["tag"]), self.prepared["commit"])

    def test_filtered_source_history_does_not_fetch_orphan_binary_payloads(self):
        (self.payload / "bin/homelab").write_bytes(os.urandom(3_000_000))
        artifact = self.assemble("large-artifact")
        publish.publish(artifact, str(self.remote))
        source = self.root / "source"
        prepare.run("git", "init", "-q", "-b", "main", str(source))
        (source / "README.md").write_text("Current source checkout\n")
        prepare.run("git", "add", ".", cwd=source)
        prepare.run(
            "git",
            "-c",
            "user.name=Clone test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            "Source",
            cwd=source,
        )
        prepare.run("git", "push", str(self.remote), "HEAD:refs/heads/main", cwd=source)
        prepare.run("git", "config", "uploadpack.allowFilter", "true", cwd=self.remote)
        clone = self.root / "source-clone"
        prepare.run(
            "git",
            "clone",
            "-q",
            "--filter=blob:none",
            "--no-checkout",
            "--branch",
            "main",
            self.remote.as_uri(),
            str(clone),
        )
        prepare.run("git", "fetch", "-q", "--filter=blob:none", "origin", "+refs/tags/*:refs/tags/*", cwd=clone)
        prepare.run("git", "checkout", "-q", "main", cwd=clone)
        binary = prepare.run("git", "rev-parse", artifact["commit"] + ":bin/homelab", cwd=artifact["repository"])
        missing = prepare.run("git", "rev-list", "--objects", "--all", "--missing=print", cwd=clone).splitlines()
        self.assertIn("?" + binary, missing)
        self.assertEqual((clone / "README.md").read_text(), "Current source checkout\n")
        self.assertLess(sum(path.stat().st_size for path in (clone / ".git/objects").rglob("*.pack")), 1_000_000)

    def test_source_history_and_unavailable_destination_fail_before_publication(self):
        repo = Path(self.prepared["repository"])
        prepare.run("git", "checkout", "-q", "artifact", cwd=repo)
        prepare.run(
            "git",
            "-c",
            "user.name=Artifact test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-qm",
            "Forbidden parent",
            cwd=repo,
        )
        other = dict(self.prepared, commit=prepare.run("git", "rev-parse", "HEAD", cwd=repo))
        with self.assertRaisesRegex(ValueError, "zero parents"):
            publish.publish(other, str(self.remote))
        with self.assertRaisesRegex(RuntimeError, "do not assume"):
            publish.remote_commit(str(self.root / "unavailable.git"), self.prepared["tag"])


if __name__ == "__main__":
    unittest.main()
