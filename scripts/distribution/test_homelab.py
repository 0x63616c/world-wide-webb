import hashlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
SPEC = importlib.util.spec_from_file_location("homelab_delivery", Path(__file__).with_name("homelab.py"))
delivery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(delivery)


class CliDeliveryTests(unittest.TestCase):
    def archive(self, root, extra=None):
        archive = root / "homelab-prebuilt.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            for name in ("bin/homelab", "bin/homelab-host", "share/homelab/README.md"):
                info = tarfile.TarInfo(name)
                info.size, info.mode = 7, 0o755
                bundle.addfile(info, io.BytesIO(b"fixture"))
            info = tarfile.TarInfo("bin/hl")
            info.type, info.linkname = tarfile.SYMTYPE, "homelab"
            bundle.addfile(info)
            if extra:
                bundle.addfile(extra)
        checksum = root / "SHA256SUMS"
        checksum.write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + "  build/homelab-prebuilt.tar.gz\n")
        return archive, checksum

    def test_tested_archive_preserves_its_prebuilt_helpers_and_rejects_unsafe_members(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive, checksum = self.archive(root)
            delivery.unpack(archive, checksum, root / "valid")
            self.assertEqual((root / "valid/bin/homelab-host").read_bytes(), b"fixture")
            self.assertEqual(os.readlink(root / "valid/bin/hl"), "homelab")
            for name, kind, link in [("../escape", tarfile.REGTYPE, ""),
                                      ("bin/other", tarfile.SYMTYPE, "/tmp/private"),
                                      ("bin/other", tarfile.LNKTYPE, "bin/homelab"),
                                      ("bin/homelab", tarfile.REGTYPE, "")]:
                with self.subTest(name=name, kind=kind):
                    info = tarfile.TarInfo(name)
                    info.type, info.linkname = kind, link
                    archive, checksum = self.archive(root, info)
                    with self.assertRaises(ValueError):
                        delivery.unpack(archive, checksum, root / "bad")
                    shutil.rmtree(root / "bad")
            checksum.write_text("0" * 64 + "  build/homelab-prebuilt.tar.gz\n")
            with self.assertRaises(ValueError):
                delivery.unpack(archive, checksum, root / "mismatch")
            self.assertFalse((root / "mismatch").exists())
            self.assertFalse((root / "escape").exists())

    def test_only_exact_successful_main_ci_and_its_named_build_authorize_publication(self):
        source = "a" * 40
        run = {"head_sha": source, "path": ".github/workflows/ci.yml", "event": "push",
               "head_branch": "main", "head_repository": {"full_name": delivery.publish.REPOSITORY},
               "status": "completed", "conclusion": "success", "run_attempt": 2}
        job = {"name": "Homelab / Homelab CLI", "head_sha": source, "status": "completed", "conclusion": "success"}

        def invoke(candidate, jobs):
            def command(*args, **_kwargs):
                if args[:3] == ("git", "rev-parse", "HEAD"):
                    return source
                if args[:2] == ("git", "status"):
                    return ""
                if args[:3] == ("gh", "repo", "view"):
                    return json.dumps({"visibility": "PRIVATE"})
                return json.dumps([{"jobs": jobs}] if "jobs?" in args[-1] else candidate)
            with patch.dict(os.environ, SOURCE_RUN_ID="12", SOURCE_RUN_ATTEMPT="2"), \
                 patch.object(delivery.prepare, "run", side_effect=command):
                return delivery.checked_source()

        self.assertEqual(invoke(run, [job]), source)
        for field, value in [("event", "pull_request"), ("head_sha", "b" * 40),
                             ("head_branch", "other"), ("conclusion", "failure"), ("run_attempt", 1),
                             ("head_repository", {"full_name": "foreign/repo"})]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                invoke(dict(run, **{field: value}), [job])
        for jobs in ([], [job, job], [dict(job, conclusion="skipped")], [dict(job, head_sha="b" * 40)]):
            with self.subTest(jobs=jobs), self.assertRaises(ValueError):
                invoke(run, jobs)

    def test_staged_bytes_and_monotonic_tap_recipe_are_checked_before_install_authority_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive, checksum = self.archive(root)
            delivery.unpack(archive, checksum, root / "payload")
            output = root / "output"
            output.mkdir()
            record = {"source_sha": "a" * 40, "version": "0.4.2",
                      "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                      "url": "https://github.com/0x63616c/world-wide-webb/releases/download/homelab%2Fv0.4.2/homelab-0.4.2.tar.gz"}
            (output / "release.json").write_text(json.dumps(record))
            tap = root / "tap"
            (tap / "Formula").mkdir(parents=True)
            formula = tap / "Formula/homelab.rb"
            original = 'version "0.4.1"\n'
            formula.write_text(original)
            def download(*args):
                shutil.copyfile(archive, args[-1])
                return ""
            with patch.object(sys, "argv", ["homelab.py", str(root), str(output), "--verify-download", "--tap", str(tap)]), \
                 patch.object(delivery, "checked_source", return_value="a" * 40), \
                 patch.object(delivery.prepare, "run", side_effect=download):
                delivery.main()
                self.assertEqual(formula.read_text(), delivery.formula("0.4.2", record["sha256"]))
                formula.write_text('version "0.5.0"\n')
                with self.assertRaises(ValueError):
                    delivery.main()
                self.assertEqual(formula.read_text(), 'version "0.5.0"\n')
                formula.write_text(original)
                archive.write_bytes(b"changed archive")
                with self.assertRaises(ValueError):
                    delivery.main()
                self.assertEqual(formula.read_text(), original)



if __name__ == "__main__":
    unittest.main()
