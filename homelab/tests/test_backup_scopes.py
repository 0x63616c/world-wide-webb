import datetime
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

scripts = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location("scoped_backup", scripts / "backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class ScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "backups"
        self.config = dict(
            root=str(self.root),
            host="homelab-macbook",
            services=["home-assistant", "control-center", "penpot"],
            minFreeGiB=1,
            keepLocal=7,
            healthCommands={"control-center-hourly": ["hourly-health"], "penpot": ["penpot-health"]},
        )

    def test_scope_is_a_subset_and_roots_cannot_overlap(self):
        hourly = backup.scoped_configuration(self.config, "control-center-hourly")
        penpot = backup.scoped_configuration(self.config, "penpot")
        self.assertEqual(hourly["services"], ["control-center"])
        self.assertEqual(penpot["services"], ["penpot"])
        self.assertEqual(Path(hourly["root"]), self.root / "control-center-history")
        self.assertEqual(Path(penpot["root"]), self.root / "penpot")
        self.assertEqual(self.config["services"], ["home-assistant", "control-center", "penpot"])
        for scope in ["unknown", "penpot"]:
            with self.assertRaises(ValueError):
                backup.scoped_configuration({**self.config, "services": ["control-center"]}, scope)

    def test_deployment_sets_have_independent_scope_and_preserve_scheduled_recovery(self):
        scoped = backup.scoped_configuration(self.config, "deployment", ["control-center"])
        self.assertEqual(Path(scoped["root"]), self.root / "deployment")
        self.assertEqual(scoped["services"], ["control-center"])
        for name in ["deployment", "penpot", "control-center-history"]:
            (self.root / name).mkdir(parents=True, exist_ok=True)
        for i in range(10):
            directory = self.root / "deployment" / f"20261109T00{i:02}00Z-aaaaaaaa"
            directory.mkdir()
            (directory / "NAS_VERIFIED").touch()
        pending = self.root / "deployment/20261108T000000Z-aaaaaaaa"
        pending.mkdir()
        pinned = self.root / "deployment/20261107T000000Z-aaaaaaaa"
        pinned.mkdir()
        (pinned / "NAS_VERIFIED").touch()
        (pinned / "PINNED").touch()
        full = self.root / "20261101T000000Z-aaaaaaaa"
        full.mkdir()
        (full / "NAS_VERIFIED").touch()
        backup.prune_verified(self.root / "deployment", 7)
        self.assertTrue(pending.exists())
        self.assertTrue(pinned.exists())
        self.assertTrue(full.exists())
        self.assertTrue((self.root / "penpot").exists())
        self.assertEqual(len(list((self.root / "deployment").iterdir())), 9)

    def test_scoped_recovery_health_inherits_real_operation_descriptor(self):
        health = Path(self.temp.name) / "health"
        health.write_text("#!" + sys.executable + "\nimport os\nos.fstat(int(os.environ['HOMELAB_OPERATION_FD']))\n")
        health.chmod(0o700)
        lock = os.open(Path(self.temp.name) / "operation.lock", os.O_CREAT | os.O_RDWR, 0o600)
        self.addCleanup(lambda: os.close(lock))

        def accept(*args, **kwargs):
            args[6]()

        with (
            patch.dict(os.environ, {"HOMELAB_OPERATION_FD": str(lock)}),
            patch.object(backup.snapshot, "snapshot", return_value=[]),
            patch.object(backup, "recovery_bundle"),
            patch.object(backup.backup_publish, "accept_local", side_effect=accept),
            patch.object(backup, "nas_client") as nas,
        ):
            backup.backup(
                {**self.config, "reconcileCommand": str(health)},
                scope="deployment",
                selected=["control-center"],
                local_only=True,
            )
            nas.assert_not_called()

    @patch.object(backup, "recovery_bundle")
    @patch.object(backup.snapshot, "snapshot")
    @patch.object(backup, "verified_copy")
    @patch.object(backup, "nas_client")
    @patch.object(backup.history, "prune_remote")
    @patch.object(backup.history, "prune_local")
    @patch.object(backup, "prune_verified")
    def test_hourly_uses_online_snapshot_and_only_its_history_and_health(
        self, prune, local, remote, client, copy, snapshot, bundle
    ):
        backup.backup(self.config, scope="control-center-hourly")
        args, kwargs = snapshot.call_args
        self.assertEqual(args[1], ["control-center"])
        self.assertTrue(kwargs["control_center_online"])
        self.assertFalse(kwargs["weekly_exports"])
        self.assertEqual(args[0].parent, self.root / "control-center-history")
        self.assertIn("/homelab-macbook/control-center-history/", copy.call_args.args[1])
        self.assertEqual(copy.call_args.args[3], ["hourly-health"])
        remote.assert_called_once()
        local.assert_called_once_with(self.root / "control-center-history")
        prune.assert_not_called()
        client.return_value.login.assert_called_once()
        client.return_value.logout.assert_called_once()

    @patch.object(backup, "recovery_bundle")
    @patch.object(backup.snapshot, "snapshot")
    @patch.object(backup, "verified_copy")
    @patch.object(backup, "nas_client")
    @patch.object(backup.history, "prune_remote")
    @patch.object(backup, "prune_verified")
    def test_penpot_cold_snapshot_does_not_touch_other_services_or_full_retention(
        self, prune, remote, client, copy, snapshot, bundle
    ):
        backup.backup(self.config, scope="penpot")
        self.assertEqual(snapshot.call_args.args[1], ["penpot"])
        self.assertFalse(snapshot.call_args.kwargs["control_center_online"])
        self.assertEqual(snapshot.call_args.args[0].parent, self.root / "penpot")
        self.assertIn("/homelab-macbook/penpot/", copy.call_args.args[1])
        prune.assert_called_once_with(self.root / "penpot", 7)
        remote.assert_not_called()

    @patch.object(backup, "nas_client")
    @patch.object(backup.snapshot, "snapshot")
    def test_unresolved_restart_in_another_scope_blocks_before_any_snapshot(self, snapshot, client):
        failed = self.root / "penpot/failed"
        failed.mkdir(parents=True)
        (failed / "app.restart-required").touch()
        self.root.chmod(0o700)
        with self.assertRaisesRegex(RuntimeError, "recovery inspection"):
            backup.backup(self.config, scope="control-center-hourly")
        snapshot.assert_not_called()
        client.assert_not_called()


class HistoryTests(unittest.TestCase):
    def stamps(self, count=10 * 24):
        start = datetime.datetime(2026, 10, 25, tzinfo=datetime.timezone.utc)
        return [(start + datetime.timedelta(hours=i)).strftime("%Y%m%dT%H%M%SZ") + "-aaaaaaaa" for i in range(count)]

    def test_hourly_and_pacific_daily_retention_survive_dst(self):
        names = self.stamps()
        keep = backup.history.retained(names)
        self.assertTrue(set(names[-24:]) <= keep)
        days = {}
        from zoneinfo import ZoneInfo

        for name in names:
            utc = datetime.datetime.strptime(name[:16], "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
            days[utc.astimezone(ZoneInfo("America/Los_Angeles")).date()] = name
        self.assertTrue(set(list(days.values())[-7:]) <= keep)
        self.assertLess(len(keep), len(names))
        weekly = backup.history.retained(names, weekly=True)
        self.assertTrue(keep <= weekly)
        for bad in ["../outside", "20261108T000000Z", "20261308T000000Z-aaaaaaaa"]:
            with self.assertRaises(ValueError):
                backup.history.retained([bad])

    def test_local_expiration_never_deletes_pending_or_other_scope_data(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            names = self.stamps(24 * 10)
            for name in names:
                p = root / name
                p.mkdir()
                (p / "NAS_VERIFIED").touch()
            pending = root / "20260101T000000Z-aaaaaaaa"
            pending.mkdir()
            unrelated = root / "full-backups"
            unrelated.mkdir()
            backup.history.prune_local(root)
            self.assertTrue(pending.exists())
            self.assertTrue(unrelated.exists())
            self.assertEqual(
                {p.name for p in root.iterdir()} - {pending.name, unrelated.name}, backup.history.retained(names)
            )

    def test_remote_deletion_is_exact_host_history_only_and_keeps_every_week(self):
        names = self.stamps(24 * 40)
        parent = backup.history.namespace("homelab-macbook")
        rows = [{"name": n, "path": parent + "/" + n, "isdir": True} for n in names]
        rows += [
            {"name": names[0], "path": "/Homelab/backups/mac-mini/" + names[0], "isdir": True},
            {"name": "../outside", "path": parent + "/../outside", "isdir": True},
        ]
        nas = Mock()

        def call(api, method, **kwargs):
            if method == "list":
                return {"files": rows, "total": len(rows)}
            if method == "getinfo":
                return {"files": [{"path": json.loads(kwargs["path"])[0], "isdir": False}]}
            return {}

        nas.call.side_effect = call
        backup.history.prune_remote(nas, "homelab-macbook", names[-1])
        deleted = [json.loads(c.kwargs["path"])[0] for c in nas.call.call_args_list if c.args[1] == "delete"]
        expected = sorted(parent + "/" + n for n in set(names) - backup.history.retained(names, weekly=True))
        self.assertEqual(deleted, expected)
        self.assertTrue(all(p.startswith(parent + "/") and p.rsplit("/", 1)[0] == parent for p in deleted))
        with self.assertRaises(ValueError):
            backup.history.prune_remote(nas, "mac-mini", names[-1])

    def test_missing_current_completion_prevents_all_remote_deletion(self):
        nas = Mock()
        nas.call.return_value = {"files": [], "total": 0}
        with self.assertRaisesRegex(RuntimeError, "expiration skipped"):
            backup.history.prune_remote(nas, "homelab-macbook", "20261108T000000Z-aaaaaaaa")
        self.assertFalse(any(c.args[1] == "delete" for c in nas.call.call_args_list))


if __name__ == "__main__":
    unittest.main()
