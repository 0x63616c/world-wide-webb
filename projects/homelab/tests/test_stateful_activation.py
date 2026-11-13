import contextlib
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

scripts = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location("stateful_activation", scripts / "stateful-activation.py")
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


class StatefulActivationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.old = self.root / "old"
        self.new = self.root / "new"
        for p in [self.old, self.new]:
            (p / "etc/homelab").mkdir(parents=True)
            (p / "etc/homelab/deployment.json").write_text(
                json.dumps({"host": "example", "services": ["hindsight"], "backupsEnabled": True})
            )
        self.events = []

    def run_transaction(self, fail=None):
        def event(name):
            def call(*args):
                self.events.append(name)
                if name == fail:
                    raise RuntimeError("injected failure")

            return call

        return activation.transaction(
            self.new, self.old, self.root, 7, event("backup"), event("activation"), event("reconcile")
        )

    def test_backup_precedes_activation_and_success_follows_health(self):
        receipt = self.run_transaction()
        self.assertEqual(self.events, ["backup", "activation", "reconcile"])
        self.assertEqual(receipt["phase"], "verified")
        self.assertFalse((self.root / "transaction").exists())
        self.assertEqual(json.loads((self.root / "last-success.json").read_text())["candidate"], str(self.new))

    def test_penpot_retirement_precedes_activation_and_keeps_failure_journal(self):
        old = {"host": "example", "services": ["penpot"], "backupsEnabled": True}
        new = {"host": "example", "services": [], "backupsEnabled": True}
        (self.old / "etc/homelab/deployment.json").write_text(json.dumps(old))
        (self.new / "etc/homelab/deployment.json").write_text(json.dumps(new))
        events = []

        def retire(services):
            self.assertEqual(services, ["penpot"])
            events.append("retire")
            raise RuntimeError("retirement failed")

        with self.assertRaisesRegex(RuntimeError, "retirement failed"):
            activation.transaction(
                self.new,
                self.old,
                self.root,
                7,
                lambda *_: events.append("backup"),
                lambda *_: events.append("activation"),
                lambda *_: events.append("reconcile"),
                retire=retire,
            )
        self.assertEqual(events, ["retire"])
        self.assertEqual(json.loads((self.root / "transaction").read_text())["phase"], "retire")

    def test_penpot_retirement_removes_only_its_verified_resources(self):
        calls = []
        listings = iter(
            [
                "penpot-penpot-backend-1\npenpot-penpot-postgres-1",
                "",
                "penpot_assets\npenpot_postgres\nother_volume",
                "penpot_default\nother_network",
            ]
        )

        def docker(command, **kwargs):
            self.assertTrue(kwargs["check"])
            args = command[3:]
            calls.append(args)
            if args[0] in ("ps", "volume", "network") and args[-2:] == ["--format", "{{.Names}}"]:
                return subprocess.CompletedProcess(command, 0, next(listings))
            if args[0] in ("volume", "network") and args[1] == "ls":
                return subprocess.CompletedProcess(command, 0, next(listings))
            return subprocess.CompletedProcess(command, 0, "")

        with patch.object(activation.subprocess, "run", side_effect=docker):
            activation.retire_penpot(io.StringIO())
        self.assertIn(["rm", "-f", "penpot-penpot-backend-1"], calls)
        self.assertIn(["rm", "-f", "penpot-penpot-postgres-1"], calls)
        self.assertIn(["volume", "rm", "penpot_assets"], calls)
        self.assertIn(["volume", "rm", "penpot_postgres"], calls)
        self.assertNotIn(["volume", "rm", "other_volume"], calls)
        self.assertIn(["network", "rm", "penpot_default"], calls)

    def test_penpot_retirement_rejects_unexpected_project_container_before_removal(self):
        def docker(command, **kwargs):
            return subprocess.CompletedProcess(command, 0, "penpot-unexpected-1\n")

        with patch.object(activation.subprocess, "run", side_effect=docker) as run:
            with self.assertRaisesRegex(RuntimeError, "unexpected containers"):
                activation.retire_penpot(io.StringIO())
        self.assertEqual(run.call_count, 1)

    def test_backup_activation_and_health_failures_retain_barrier_and_never_rollback(self):
        for phase, events in [
            ("backup", ["backup"]),
            ("activation", ["backup", "activation"]),
            ("reconcile", ["backup", "activation", "reconcile"]),
        ]:
            with self.subTest(phase=phase):
                self.events = []
                with self.assertRaisesRegex(RuntimeError, "injected"):
                    self.run_transaction(fail=phase)
                self.assertEqual(self.events, events)
                self.assertEqual(json.loads((self.root / "transaction").read_text())["phase"], phase)
                self.assertFalse((self.root / "last-success.json").exists())

    def test_verified_backup_stage_can_be_released_without_losing_its_journal(self):
        token = "a" * 32
        current = self.root / "current"
        profile = self.root / "profile"
        current.symlink_to(self.old)
        profile.symlink_to(self.old)
        (self.root / "operation.lock").touch()
        plan = activation.plan_deployment(activation.metadata(self.old), activation.metadata(self.new))
        record = {
            "id": token,
            "previous": str(self.old),
            "candidate": str(self.new),
            "phase": "backup",
            "plan": plan,
            "timings": {"backup": {"finishedAt": "2026-11-13T04:34:04Z"}},
        }
        (self.root / "transaction").write_text(json.dumps(record))
        (self.root / "transaction").chmod(0o600)
        (self.root / "last-success.json").write_text(json.dumps({"phase": "verified", "candidate": str(self.old)}))
        backup_root = self.root / "backups"
        backup = backup_root / "deployment" / "20261113T042940Z-829be109"
        backup.mkdir(parents=True)
        for directory in (backup_root, backup.parent, backup):
            directory.chmod(0o700)
        manifest = backup / "COMPLETE.json"
        manifest.write_text("{}")
        digest = hashlib.sha256(manifest.read_bytes()).hexdigest()
        (backup / "LOCAL_VERIFIED.json").write_text(
            json.dumps(
                {"transaction": token, "scope": "deployment", "services": plan["backup"], "manifestSha256": digest}
            )
        )
        (backup / "NAS_VERIFIED").write_text(json.dumps({"manifestSha256": digest}))
        (backup / "PINNED").write_text(json.dumps({"transaction": token}))
        (backup / "LOCAL_VERIFIED.json").chmod(0o600)

        @contextlib.contextmanager
        def acquire(*_args, **_kwargs):
            yield 7

        with patch.object(activation.locks, "operation_lock", side_effect=acquire):
            with self.assertRaisesRegex(RuntimeError, "candidate differs"):
                activation.recover_backup_stage(
                    self.old,
                    token,
                    self.root,
                    current,
                    profile,
                    backup_root,
                    lambda _: {"host": "example", "services": plan["backup"], "scope": "deployment"},
                    lambda: None,
                )
            (backup / "NAS_VERIFIED").unlink()
            with self.assertRaisesRegex(RuntimeError, "NAS verification"):
                activation.recover_backup_stage(
                    self.new,
                    token,
                    self.root,
                    current,
                    profile,
                    backup_root,
                    lambda _: {"host": "example", "services": plan["backup"], "scope": "deployment"},
                    lambda: None,
                )
            (backup / "NAS_VERIFIED").write_text(json.dumps({"manifestSha256": digest}))
            activation.recover_backup_stage(
                self.new,
                token,
                self.root,
                current,
                profile,
                backup_root,
                lambda _: {"host": "example", "services": plan["backup"], "scope": "deployment"},
                lambda: None,
                check_only=True,
            )
            self.assertTrue((self.root / "transaction").exists())
            activation.recover_backup_stage(
                self.new,
                token,
                self.root,
                current,
                profile,
                backup_root,
                lambda _: {"host": "example", "services": plan["backup"], "scope": "deployment"},
                lambda: None,
            )
        self.assertFalse((self.root / "transaction").exists())
        self.assertEqual(json.loads((self.root / f"transaction-recovered-{token}").read_text()), record)

    def test_removal_and_disabled_backups_fail_before_any_mutation(self):
        path = self.new / "etc/homelab/deployment.json"
        for services, backups in [([], True), (["hindsight"], False)]:
            path.write_text(json.dumps({"host": "example", "services": services, "backupsEnabled": backups}))
            with self.assertRaises(ValueError):
                self.run_transaction()
            self.assertFalse((self.root / "transaction").exists())
            self.assertEqual(self.events, [])

    def test_empty_base_needs_no_service_backup_or_reconcile(self):
        for p in [self.old, self.new]:
            (p / "etc/homelab/deployment.json").write_text(
                json.dumps({"host": "example", "services": [], "backupsEnabled": False})
            )
        self.run_transaction()
        self.assertEqual(self.events, ["activation"])

    def test_unchanged_descriptors_skip_backup_and_reconcile_and_record_activation_time(self):
        inputs = {
            "version": 1,
            "shared": {k: "a" * 64 for k in ("host", "safety", "containers", "home-assistant")},
            "services": {"hindsight": {k: "a" * 64 for k in ("configuration", "storage", "secrets")}},
        }
        for path in [self.old, self.new]:
            metadata = path / "etc/homelab/deployment.json"
            value = json.loads(metadata.read_text())
            value["inputs"] = inputs
            metadata.write_text(json.dumps(value))
        receipt = self.run_transaction()
        self.assertEqual(self.events, ["activation"])
        self.assertEqual(set(receipt["timings"]), {"activation"})
        self.assertGreaterEqual(receipt["timings"]["activation"]["durationSeconds"], 0)
        self.assertEqual(receipt["plan"]["backup"], [])

    def test_direct_activation_and_unverified_boot_are_blocked(self):
        current = self.root / "current"
        current.mkdir()
        profile = self.root / "profile"
        profile.symlink_to(self.new)
        with self.assertRaisesRegex(RuntimeError, "Use homelab"):
            activation.guard(self.new, self.root, current, profile)
        current.rmdir()
        with self.assertRaises(FileNotFoundError):
            activation.guard(self.new, self.root, current, profile)
        (self.root / "last-success.json").write_text(json.dumps({"candidate": str(self.new), "phase": "verified"}))
        activation.guard(self.new, self.root, current, profile)
        with self.assertRaisesRegex(RuntimeError, "no verified"):
            activation.guard(self.old, self.root, current, profile)

    def test_current_generation_is_selected_after_acquiring_lock(self):
        current = self.root / "current"
        profile = self.root / "profile"
        profile.symlink_to(self.new)
        locked = False

        @contextlib.contextmanager
        def acquire(_root):
            nonlocal locked
            locked = True
            yield 7
            locked = False

        def resolve(path):
            if path == current:
                self.assertTrue(locked)
                return self.new
            return self.new

        with (
            patch.object(sys, "argv", ["activate", "apply", "--candidate", str(self.new)]),
            patch.object(activation.os, "geteuid", return_value=0),
            patch.object(activation.os, "setsid"),
            patch.object(activation, "ROOT", self.root),
            patch.object(activation, "CURRENT", current),
            patch.object(activation, "PROFILE", profile),
            patch.object(activation, "system_path", side_effect=resolve),
            patch.object(activation.locks, "initialize"),
            patch.object(activation.locks, "operation_lock", side_effect=acquire),
            patch.object(activation, "transaction") as transaction,
        ):
            activation.main()
            self.assertEqual(transaction.call_args.args[1], self.new)

    def test_recovery_cli_checks_before_releasing_the_backup_barrier(self):
        token = "a" * 32
        with (
            patch.object(
                sys,
                "argv",
                ["activate", "recover-backup", "--candidate", str(self.new), "--transaction-id", token, "--check-only"],
            ),
            patch.object(activation.os, "geteuid", return_value=0),
            patch.object(activation, "system_path", return_value=self.new),
            patch.object(activation.locks, "initialize"),
            patch.object(activation, "recover_backup_stage") as recover,
        ):
            activation.main()
        recover.assert_called_once_with(self.new, token, check_only=True)

    def test_hot_bridge_replacement_stops_existing_guest_before_switch_and_reloads_after(self):
        for system, content in ((self.old, "old-bridge"), (self.new, "new-bridge")):
            metadata = system / "etc/homelab/deployment.json"
            value = json.loads(metadata.read_text())
            value["services"] = ["home-assistant"]
            metadata.write_text(json.dumps(value))
            daemons = system / "Library/LaunchDaemons"
            daemons.mkdir(parents=True)
            for name in ("vmnet", "colima"):
                (daemons / f"org.nixos.homelab-ha-{name}.plist").write_text(content)
            (system / "activate").write_text("#!/usr/bin/env -i /nix/store/fixture/bin/bash\n")
        events = []

        def run(command, *args, **kwargs):
            events.append(command)

        with (
            patch.object(activation, "run", side_effect=run),
            patch.object(activation, "unload_ha_launcher", side_effect=lambda *a: events.append(["unload", *a])),
            patch.object(activation, "ensure_ha_launchers", side_effect=lambda: events.append(["reload"])),
            patch.object(activation.children, "run_service", side_effect=lambda *a, **k: events.append(list(a[:1]))),
        ):
            activation.activate(self.new, self.old, 7, "transaction", None)
        self.assertEqual(events[0:2], [["unload"], ["stop-ha"]])
        self.assertEqual(events[2], ["unload", "org.nixos.homelab-ha-vmnet"])
        self.assertIn("nix-env", events[3][0])
        self.assertEqual(events[-1], ["reload"])

    def test_unchanged_ha_bridge_or_non_ha_host_does_not_restart_guest(self):
        self.assertFalse(activation.ha_runtime_changed(self.old, self.new))
        for system in (self.old, self.new):
            metadata = system / "etc/homelab/deployment.json"
            value = json.loads(metadata.read_text())
            value["services"] = ["home-assistant"]
            metadata.write_text(json.dumps(value))
            daemons = system / "Library/LaunchDaemons"
            daemons.mkdir(parents=True)
            for name in ("vmnet", "colima"):
                (daemons / f"org.nixos.homelab-ha-{name}.plist").write_text("same")
        self.assertFalse(activation.ha_runtime_changed(self.old, self.new))

    def test_failed_ha_stop_prevents_profile_switch(self):
        with (
            patch.object(activation, "ha_runtime_changed", return_value=True),
            patch.object(activation, "unload_ha_launcher"),
            patch.object(activation.children, "run_service", side_effect=subprocess.CalledProcessError(1, "stop-ha")),
            patch.object(activation, "run") as switch,
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                activation.activate(self.new, self.old, 7, "transaction", None)
            switch.assert_not_called()

    def test_launcher_unload_waits_for_async_teardown(self):
        with (
            patch.object(activation, "launcher_loaded", side_effect=[True, True, False]),
            patch.object(activation.subprocess, "run") as run,
            patch.object(activation.time, "sleep") as sleep,
        ):
            activation.unload_ha_launcher()
        self.assertEqual(run.call_args.args[0], ["/bin/launchctl", "bootout", "system/org.nixos.homelab-ha-colima"])
        sleep.assert_called_once_with(1)

    def test_unexpected_launchd_failure_is_not_treated_as_an_absent_job(self):
        with patch.object(activation.subprocess, "run", return_value=subprocess.CompletedProcess([], 1)):
            with self.assertRaisesRegex(RuntimeError, "inspect HA launcher"):
                activation.ensure_ha_launchers()

    def test_interrupted_transaction_cannot_be_bypassed_by_a_boot_receipt(self):
        current = self.root / "absent"
        profile = self.root / "profile"
        profile.symlink_to(self.new)
        (self.root / "transaction").write_text(json.dumps({"id": "expected", "candidate": str(self.new)}))
        (self.root / "last-success.json").write_text(json.dumps({"candidate": str(self.new), "phase": "verified"}))
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "Interrupted"):
                activation.guard(self.new, self.root, current, profile)


if __name__ == "__main__":
    unittest.main()
