import copy
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("promotion", Path(__file__).with_name("promotion.py"))
p = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(p)


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root, stderr=subprocess.PIPE, text=True).strip()


class PromotionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / "remote.git"
        self.repo = self.root / "source"
        self.repo.mkdir()
        git(self.root, "init", "--bare", str(self.remote))
        git(self.repo, "init", "-b", "main")
        git(self.repo, "config", "user.name", "Test")
        git(self.repo, "config", "user.email", "test@example.invalid")
        self.a = self.commit("a")
        self.b = self.commit("b")
        self.c = self.commit("c")
        git(self.repo, "push", str(self.remote), "HEAD:refs/heads/main")
        self.store = p.Store(self.repo, str(self.remote))
        self.identity = "d" * 64

    def commit(self, name):
        (self.repo / "input").write_text(name)
        git(self.repo, "add", "input")
        git(self.repo, "commit", "-m", name)
        return git(self.repo, "rev-parse", "HEAD")

    def intent(self, source, run=1):
        return {"source": source, "run_id": run, "attempt": 1, "inputs": "e" * 64}

    def snapshot(self):
        return self.store.snapshot()[1]

    def acquire(self, source, action="acquire", identity=None):
        return p.lease(self.store, action, identity or self.identity, "test-mac", source, 60)

    def test_exact_source_promotion_and_late_candidate_never_rewinds(self):
        self.assertEqual(p.promote(self.store, self.intent(self.b)), "promoted")
        self.assertEqual(p.promote(self.store, self.intent(self.a)), "superseded")
        self.assertEqual(p.promote(self.store, self.intent(self.b)), "already-promoted")
        self.assertEqual(p.promote(self.store, self.intent(self.c)), "promoted")
        self.assertEqual(self.snapshot()["deployed"], self.c)
        # Control ancestry is durable while deployment is exactly the source SHA.
        refs, _ = self.store.snapshot()
        self.assertEqual(git(self.repo, "rev-list", "--count", refs[p.CONTROL]), "2")
        self.assertEqual(refs[p.DEPLOY], self.c)

    def test_lease_queues_latest_without_runner_wait_and_resume_does_not_extend(self):
        p.promote(self.store, self.intent(self.a))
        original = self.acquire(self.a)
        self.assertEqual(self.acquire(self.a), original)
        self.assertEqual(p.promote(self.store, self.intent(self.b)), "queued")
        self.assertEqual(p.promote(self.store, self.intent(self.c, 2)), "queued")
        self.assertEqual(p.promote(self.store, self.intent(self.b)), "superseded-pending")
        state = self.snapshot()
        self.assertEqual(state["deployed"], self.a)
        self.assertEqual(state["pending"]["source"], self.c)
        self.assertEqual(self.acquire(self.a, "verify"), original)
        self.acquire(self.a, "release")
        self.assertEqual(self.snapshot()["deployed"], self.a)
        self.assertEqual(p.promote(self.store, self.intent(self.b)), "superseded-pending")
        self.assertEqual(p.promote(self.store, self.intent(self.c, 2)), "promoted")
        self.assertIsNone(self.snapshot()["pending"])

    def test_two_observers_cannot_overwrite_each_others_lease(self):
        p.promote(self.store, self.intent(self.a))
        refs, before = self.store.snapshot()
        self.acquire(self.a)
        after = copy.deepcopy(before)
        after.update(deployed=self.b, receipt=self.intent(self.b))
        with self.assertRaises(p.Conflict):
            self.store.commit(refs, before, after)
        self.assertEqual(self.snapshot()["deployed"], self.a)
        self.assertEqual(self.snapshot()["lease"]["id"], self.identity)
        self.assertEqual(p.promote(self.store, self.intent(self.b)), "queued")
        self.assertEqual(self.snapshot()["pending"]["source"], self.b)
        with self.assertRaises(p.Conflict):
            self.acquire(self.a, identity="c" * 64)

    def test_expired_prepared_lease_allows_forward_promotion_but_not_old_activation(self):
        p.promote(self.store, self.intent(self.a))
        with patch.object(p.time, "time", return_value=100):
            self.acquire(self.a)
        with patch.object(p.time, "time", return_value=161):
            self.assertEqual(p.promote(self.store, self.intent(self.b)), "promoted")
            with self.assertRaises(p.Conflict):
                self.acquire(self.a, "activate")
        self.assertEqual(self.snapshot()["deployed"], self.b)
        self.assertIsNone(self.snapshot()["lease"])

    def test_expired_active_lease_requires_explicit_recovery_and_keeps_pending(self):
        p.promote(self.store, self.intent(self.a))
        with patch.object(p.time, "time", return_value=100):
            self.acquire(self.a)
            self.acquire(self.a, "activate")
        with patch.object(p.time, "time", return_value=161):
            self.assertEqual(p.promote(self.store, self.intent(self.b)), "queued")
            self.assertEqual(self.snapshot()["lease"]["phase"], "expired")
            for action in ("acquire", "renew", "activate", "verify", "release"):
                with self.assertRaises(p.Conflict):
                    self.acquire(self.a, action)
            self.acquire(self.a, "recover-release")
        self.assertEqual(self.snapshot()["pending"]["source"], self.b)
        self.assertEqual(p.promote(self.store, self.intent(self.b)), "promoted")

    def test_lost_success_response_is_confirmed_without_duplicate_transaction(self):
        original = self.store.git
        failed = False

        def ambiguous(*args, **kwargs):
            nonlocal failed
            value = original(*args, **kwargs)
            if args[0] == "push" and not failed:
                failed = True
                raise p.Conflict("response lost")
            return value

        with patch.object(self.store, "git", side_effect=ambiguous):
            self.assertEqual(p.promote(self.store, self.intent(self.a)), "promoted")
        self.assertEqual(self.snapshot()["deployed"], self.a)

    def test_rejected_deployment_update_cannot_advance_journal_alone(self):
        p.promote(self.store, self.intent(self.a))
        refs_before, state_before = self.store.snapshot()
        hook = self.remote / "hooks/pre-receive"
        hook.write_text(
            '#!/bin/sh\nwhile read -r old new ref; do\nif [ "$ref" = refs/heads/deploy/homelab ]; then exit 1; fi\ndone\n'
        )
        hook.chmod(0o755)
        with self.assertRaises(p.Conflict):
            p.promote(self.store, self.intent(self.b))
        refs_after, state_after = self.store.snapshot()
        self.assertEqual(refs_after, refs_before)
        self.assertEqual(state_after, state_before)

    def test_unjournaled_manual_deployment_change_fails_closed(self):
        p.promote(self.store, self.intent(self.a))
        git(self.repo, "push", str(self.remote), self.b + ":" + p.DEPLOY)
        with self.assertRaises(p.Conflict):
            self.acquire(self.a)

    def test_divergent_source_and_invalid_lease_are_rejected(self):
        p.promote(self.store, self.intent(self.b))
        git(self.repo, "checkout", "-b", "other", self.a)
        other = self.commit("other")
        with self.assertRaises(p.Conflict):
            p.promote(self.store, self.intent(other))
        for duration in (0, -1, p.MAX_LEASE_SECONDS + 1, True):
            with self.assertRaises(ValueError):
                p.lease(self.store, "acquire", self.identity, "test-mac", self.b, duration)
