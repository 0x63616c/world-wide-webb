"""Reservation and retry state fixtures; no provider, signing or credentials."""

import copy
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("callkeep_release", Path(__file__).with_name("release.py"))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
REAL_RELEASE = release.Release


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        run = release.prepare.run
        run("git", "init", "-q", "-b", "main", str(self.root))
        run("git", "config", "user.name", "Callkeep release test", cwd=self.root)
        run("git", "config", "user.email", "test@example.invalid", cwd=self.root)
        run("git", "config", "commit.gpgsign", "false", cwd=self.root)
        (self.root / "source").write_text("first")
        run("git", "add", ".", cwd=self.root)
        run("git", "commit", "-qm", "First source", cwd=self.root)
        self.first = run("git", "rev-parse", "HEAD", cwd=self.root)
        (self.root / "source").write_text("second")
        run("git", "commit", "-qam", "Second source", cwd=self.root)
        self.second = run("git", "rev-parse", "HEAD", cwd=self.root)
        self.refs, self.stores = [], {}
        stores = self.stores

        class Store:
            def __init__(self, tag):
                self.tag = tag
                self.store = stores.setdefault(tag, {"manifest": [], "delivery": [], "promotion": [], "assets": {}})

            def ensure(self, source):
                pass

            def latest(self, prefix="manifest"):
                values = self.store[prefix]
                return copy.deepcopy(values[-1]) if values else None

            def save(self, record, prefix="manifest"):
                previous = self.latest(prefix)
                number = previous["revision"] if previous else 0
                if prefix == "manifest" and record.get("revision", 0) != number:
                    raise RuntimeError("Concurrent state")
                value = dict(record, revision=number + 1)
                self.store[prefix].append(copy.deepcopy(value))
                return value

            def info(self):
                return {"assets": [{"name": name} for name in self.store["assets"]]}

            def download(self, name, directory):
                path = directory / name
                path.write_bytes(self.store["assets"][name])
                return path

        def api(path, body=None):
            self.assertEqual(path, "repos/0x63616c/world-wide-webb/git/refs")
            tag = body["ref"].removeprefix("refs/tags/")
            if any(entry[1] == tag for entry in self.refs):
                raise RuntimeError("Tag collision")
            self.refs.append((int(tag.rsplit(".", 1)[1]), tag, body["sha"]))
            return {"ref": body["ref"]}

        for name, value in [
            ("ROOT", self.root),
            ("Release", Store),
            ("source_tags", lambda: sorted(self.refs)),
            ("api", api),
        ]:
            setting = patch.object(release, name, value)
            setting.start()
            self.addCleanup(setting.stop)

    def test_source_tags_reserve_unique_counters_and_same_source_reuses_its_number(self):
        first = release.reserve(self.first)
        second = release.reserve(self.second)
        retried = release.reserve(self.first)
        self.assertEqual([first["version"], second["version"], retried["version"]], ["1.0.26", "1.0.27", "1.0.26"])
        self.assertEqual(len(self.refs), 2)

    def test_interrupted_archive_burns_number_but_complete_assets_are_reused(self):
        first = release.reserve(self.first)
        store = release.Release(first["tag"])
        store.save(dict(store.latest(), archive_attempt_started=True))
        replacement = release.reserve(self.first)
        self.assertEqual(replacement["version"], "1.0.27")
        self.assertEqual(replacement["replaces_tag"], first["tag"])
        current = release.Release(replacement["tag"])
        candidates = {name: {"name": name + ".zip", "sha256": "a" * 64} for name in ("archive", "dsym", "notary")}
        current.save(dict(current.latest(), archive_attempt_started=True, candidates=candidates))
        current.store["assets"].update({value["name"]: b"fixture" for value in candidates.values()})
        resumed = release.reserve(self.first)
        self.assertEqual(resumed["version"], "1.0.27")
        self.assertFalse(resumed["build"])
        self.assertEqual(store.latest()["version"], "1.0.26")

    def test_late_older_source_does_not_roll_back_a_completed_release(self):
        state = release.reserve(self.second)
        store = release.Release(state["tag"])
        store.save(dict(store.latest(), state="artifact_published", archive_sha256="a" * 64))
        pointer = release.Release("callkeep-delivery")
        pointer.save({"source_sha": self.second, "tag": state["tag"], "archive_sha256": "a" * 64}, "delivery")
        self.assertFalse(release.reserve(self.first)["needed"])
        self.assertFalse(release.reserve(self.second)["needed"])
        self.assertEqual(store.latest()["state"], "complete", "Reconcile a lost final-record response")
        self.assertEqual(len(self.refs), 1)

    def test_tap_pushed_but_delivery_pointer_lost_cannot_allow_older_source(self):
        newer = release.reserve(self.second)
        newer.update(state="artifact_published", archive_sha256="b" * 64)
        newer["download_verified"] = {
            "source_sha": self.second,
            "archive_sha256": "b" * 64,
            "public_download": True,
        }
        release.fence_promotion(newer)
        # Tap push succeeds, but the job dies before complete writes its delivery pointer.
        self.assertIsNone(release.Release("callkeep-delivery").latest("delivery"))
        self.assertFalse(release.reserve(self.first)["needed"])
        older = dict(newer, source_sha=self.first, version="1.0.25", archive_sha256="a" * 64)
        older["download_verified"] = {
            "source_sha": self.first,
            "archive_sha256": "a" * 64,
            "public_download": True,
        }
        with self.assertRaisesRegex(ValueError, "older"):
            release.fence_promotion(older)
        release.fence_promotion(newer)  # Same artifact recovery remains possible.

    def test_newer_source_with_sealed_lower_counter_gets_fresh_reservation(self):
        newer = release.reserve(self.second)
        store = release.Release(newer["tag"])
        candidates = {name: {"name": name + ".zip", "sha256": "a" * 64} for name in ("archive", "dsym", "notary")}
        sealed = store.save(dict(store.latest(), archive_attempt_started=True, state="sealed", candidates=candidates))
        store.store["assets"].update({item["name"]: b"fixture" for item in candidates.values()})
        older = release.reserve(self.first)
        older.update(state="artifact_published", archive_sha256="a" * 64)
        older["download_verified"] = {
            "source_sha": self.first,
            "archive_sha256": "a" * 64,
            "public_download": True,
        }
        release.fence_promotion(older)
        replacement = release.reserve(self.second)
        self.assertEqual(replacement["version"], "1.0.28")
        self.assertEqual(replacement["replaces_tag"], newer["tag"])
        self.assertEqual(replacement["replacement_reason"], "superseded_promotion_counter")
        self.assertTrue(replacement["build"])
        self.assertEqual(store.latest(), sealed, "Never relabel or discard the sealed lower-version bytes")

    def test_manifest_compare_and_set_rejects_a_stale_writer_before_upload(self):
        store = REAL_RELEASE("callkeep/v1.0.26")
        with patch.object(store, "latest", return_value={"revision": 2}):
            with self.assertRaisesRegex(RuntimeError, "concurrently"):
                store.save({"revision": 1, "source_sha": self.first})

    def test_install_authority_requires_the_exact_public_download_proof(self):
        record = {"state": "artifact_published", "source_sha": self.first, "archive_sha256": "a" * 64}
        with self.assertRaisesRegex(ValueError, "sealed build"):
            release.require_download_proof(record)
        record["download_verified"] = {"source_sha": self.first, "archive_sha256": "a" * 64, "public_download": True}
        release.require_download_proof(record)
        record["download_verified"]["archive_sha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "sealed build"):
            release.require_download_proof(record)

    def test_public_download_rejects_changed_archive_before_extraction(self):
        record = {
            "state": "artifact_published",
            "version": "1.0.26",
            "source_sha": self.first,
            "archive_sha256": "a" * 64,
            "candidates": {"archive": {"name": "Callkeep-1.0.26.zip", "sha256": "a" * 64}},
        }

        def download(*args):
            self.assertEqual(args[0], "curl")
            self.assertIn("callkeep%2Fv1.0.26", args[-3])
            Path(args[-1]).write_bytes(b"changed bytes")

        with (
            patch.object(release.prepare, "run", side_effect=download),
            patch.object(release, "safe_extract") as extract,
        ):
            with self.assertRaisesRegex(ValueError, "checksum"):
                release.verify_download(release.Release("callkeep/v1.0.26"), record)
            extract.assert_not_called()

    def test_archive_path_and_symlink_escape_are_rejected_before_extraction(self):
        import stat
        import zipfile

        for name, target in [("../outside", None), ("Callkeep.app/Contents/escape", "../../../outside")]:
            archive = self.root / "unsafe.zip"
            with zipfile.ZipFile(archive, "w") as output:
                entry = zipfile.ZipInfo(name)
                if target:
                    entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                output.writestr(entry, target or "unsafe")
            with patch.object(release.prepare, "run") as command:
                with self.assertRaises(ValueError):
                    release.safe_extract(archive, self.root / "extract")
                command.assert_not_called()

    def test_native_ci_requires_the_exact_main_attempt_and_job(self):
        original_run = release.prepare.run
        base = {
            "head_sha": self.second,
            "path": ".github/workflows/ci.yml",
            "event": "push",
            "head_branch": "main",
            "head_repository": {"full_name": release.REPOSITORY},
            "status": "completed",
            "conclusion": "success",
            "run_attempt": 2,
        }
        jobs = [
            {
                "jobs": [
                    {
                        "name": "Callkeep / Callkeep native",
                        "head_sha": self.second,
                        "status": "completed",
                        "conclusion": "success",
                    }
                ]
            }
        ]

        def command(*args, **kwargs):
            if args[:3] == ("gh", "repo", "view"):
                return '{"visibility":"PRIVATE"}'
            if args[:2] == ("gh", "api"):
                return json.dumps(jobs)
            return original_run(*args, **kwargs)

        url = "https://github.com/0x63616c/world-wide-webb/actions/runs/123/attempts/2"
        with patch.dict(os.environ, {"CALLKEEP_SOURCE_CI_RUN_URL": url}), patch.object(release.prepare, "run", command):
            for change in [
                {},
                {"event": "pull_request"},
                {"run_attempt": 3},
                {"head_branch": "feature"},
                {"head_sha": self.first},
            ]:
                with patch.object(release, "api", return_value=dict(base, **change)):
                    if change:
                        with self.assertRaises(ValueError):
                            release.trusted_source()
                    else:
                        self.assertEqual(release.trusted_source(), self.second)
            jobs[0]["jobs"][0]["conclusion"] = "skipped"
            with patch.object(release, "api", return_value=base):
                with self.assertRaises(ValueError):
                    release.trusted_source()


class ImmutableReleaseTests(unittest.TestCase):
    def test_post_publication_progress_is_uploaded_to_the_draft_ledger(self):
        product = REAL_RELEASE("callkeep/v1.0.26")
        ledger = REAL_RELEASE("callkeep-delivery")
        source = "a" * 40
        previous = {"revision": 5, "source_sha": source, "state": "artifact_published"}
        uploads = []

        def upload(*args, **_kwargs):
            self.assertEqual(args[:3], ("gh", "release", "upload"))
            uploads.append((args[3], Path(args[4]).name, json.loads(Path(args[4]).read_text())))
            return ""

        with (
            patch.object(product, "latest", return_value=previous),
            patch.object(ledger, "ensure") as ensure,
            patch.object(release, "Release", return_value=ledger),
            patch.object(release.prepare, "run", side_effect=upload),
        ):
            saved = product.save(dict(previous, state="complete"))
        ensure.assert_called_once_with(source)
        self.assertEqual(uploads, [("callkeep-delivery", "callkeep-v1.0.26-manifest-r00000006.json", saved)])
        self.assertEqual(saved["state"], "complete")

    def test_legacy_immutable_record_is_read_until_a_ledger_record_exists(self):
        product = REAL_RELEASE("callkeep/v1.0.26")
        ledger = REAL_RELEASE("callkeep-delivery")
        old, new = {"revision": 5}, {"revision": 6}
        with (
            patch.object(release, "Release", return_value=ledger),
            patch.object(product, "_latest", return_value=old) as fallback,
            patch.object(ledger, "_latest", return_value=None) as scoped,
        ):
            self.assertEqual(product.latest(), old)
            scoped.assert_called_once_with("callkeep-v1.0.26-manifest")
            fallback.assert_called_once_with("manifest")
            scoped.return_value = new
            self.assertEqual(product.latest(), new)
            self.assertEqual(fallback.call_count, 1)

    def test_operational_ledger_must_never_be_published(self):
        ledger = REAL_RELEASE("callkeep-delivery")
        with patch.object(ledger, "info", return_value={"isDraft": False}):
            with self.assertRaisesRegex(RuntimeError, "remain a draft"):
                ledger.ensure("a" * 40)


if __name__ == "__main__":
    unittest.main()
