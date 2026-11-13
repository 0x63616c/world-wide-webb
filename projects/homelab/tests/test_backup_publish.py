import json
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock

import test_verify_backup as fixture

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import backup_publish as publisher
from bounded import run_independent


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture.RestoreVerificationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root.parent / (self.fixture.root.name + "-pending")
        self.root.mkdir(mode=0o700)
        self.addCleanup(lambda: __import__("shutil").rmtree(self.root))
        self.path = self.root / "20261109T000000Z-aaaaaaaa"
        self.fixture.root.rename(self.path)
        self.fixture.root = self.path
        (self.path / "COMPLETE.json").unlink()
        self.remote = "/Homelab/backups/homelab-macbook/" + self.path.name

    def accept(self):
        health = Mock()
        publisher.accept_local(self.path, self.remote, "full", ["cloudflared"], "a" * 32, fixture.verify.verify, health)
        health.assert_called_once()

    def test_local_acceptance_needs_no_nas_and_publication_needs_no_live_generation(self):
        self.accept()
        self.assertTrue((self.path / "PINNED").exists())
        self.assertFalse((self.path / "NAS_VERIFIED").exists())
        names = []
        client = Mock()
        client.ensure_file.side_effect = lambda path, *args: names.append(path.name)
        publisher.publish_set(self.path, lambda: client, fixture.verify.verify)
        self.assertEqual(names[-1], "COMPLETE.json")
        self.assertEqual(set(names[:-1]), {"images.json", "recovery.tar.gz"})
        self.assertTrue((self.path / "NAS_VERIFIED").exists())

    def test_failed_upload_never_publishes_completion_and_immutable_set_retries(self):
        self.accept()
        client = Mock()
        client.ensure_file.side_effect = RuntimeError("offline")
        with self.assertRaises(RuntimeError):
            publisher.publish_set(self.path, lambda: client, fixture.verify.verify)
        self.assertFalse((self.path / "NAS_VERIFIED").exists())
        self.assertNotIn("COMPLETE.json", [c.args[0].name for c in client.ensure_file.call_args_list])
        before = (self.path / "COMPLETE.json").read_bytes()
        client.ensure_file.side_effect = None
        publisher.publish_set(self.path, lambda: client, fixture.verify.verify)
        self.assertEqual((self.path / "COMPLETE.json").read_bytes(), before)

    def test_corrupt_payload_or_destination_fails_before_network(self):
        self.accept()
        path = self.path / "LOCAL_VERIFIED.json"
        data = json.loads(path.read_text())
        data["remote"] = "/unrelated"
        path.write_text(json.dumps(data))
        client = Mock()
        with self.assertRaises(ValueError):
            publisher.publish_set(self.path, client, fixture.verify.verify)
        client.assert_not_called()

    def test_publisher_lock_excludes_another_owner(self):
        with publisher.publication_lock(self.root):
            with self.assertRaises(BlockingIOError):
                with publisher.publication_lock(self.root):
                    self.fail("Concurrent publisher acquired ownership")


class BoundedTests(unittest.TestCase):
    def test_failure_joins_running_child_and_prevents_further_admission(self):
        entered = threading.Event()
        finished = threading.Event()
        seen = []

        def operation(item):
            seen.append(item)
            if item == 0:
                entered.wait(2)
                raise RuntimeError("failure")
            entered.set()
            finished.set()

        with self.assertRaises(RuntimeError):
            run_independent(range(10), operation)
        self.assertTrue(finished.is_set())
        self.assertLessEqual(len(seen), 3)
