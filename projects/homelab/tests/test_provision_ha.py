import copy
import hashlib
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import yaml

ROOT = Path(__file__).parents[3]
SERVICE = ROOT / "projects/homelab/services/home-assistant"
INVENTORY = ROOT / "projects/control-center/server/config/vacuum.json"
spec = importlib.util.spec_from_file_location("provision_ha", ROOT / "projects/homelab/scripts/provision-ha.py")
provision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provision)


def bundle():
    return {
        "assets": [],
        "templates": {p.name: p.read_text() for p in (SERVICE / "managed").glob("*.yaml")},
        "vacuum": json.loads(INVENTORY.read_text()),
    }


class ProvisionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.config = self.root / "configuration.yaml"
        self.config.write_text("# owner comment\ndefault_config:\nautomation: !include automations.yaml\n")

    def test_missing_restore_and_symlink_fail_before_writing(self):
        self.config.unlink()
        with self.assertRaisesRegex(ValueError, "Restored HA"):
            provision.provision(self.root, bundle())
        elsewhere = self.root / "private.yaml"
        elsewhere.write_text("default_config:\n")
        self.config.symlink_to(elsewhere)
        with self.assertRaisesRegex(ValueError, "Symlink"):
            provision.provision(self.root, bundle())
        self.assertEqual(elsewhere.read_text(), "default_config:\n")

    def test_preserves_existing_config_and_requires_only_one_restart(self):
        original = self.config.read_bytes()
        self.assertTrue(provision.provision(self.root, bundle()))
        after = self.config.read_bytes()
        self.assertTrue(after.startswith(original))
        backups = list((self.root / ".homelab-vacuum-backups").rglob("configuration.yaml"))
        self.assertEqual(backups[0].read_bytes(), original)
        # A failed Compose leaves this marker; a healthy reconcile clears it.
        self.assertTrue(provision.provision(self.root, bundle()))
        (self.root / ".homelab-vacuum-dirty").unlink()
        self.assertFalse(provision.provision(self.root, bundle()))
        self.assertEqual(self.config.read_bytes(), after)
        self.config.write_text("# new owner comment\n" + after.decode())
        self.assertFalse(provision.provision(self.root, bundle()))
        self.assertTrue(self.config.read_text().startswith("# new owner comment\n"))

    def test_existing_packages_are_extended_without_reserializing(self):
        original = "homeassistant:\n  name: Home\n  packages:\n    existing: !include existing.yaml\n"
        self.config.write_text(original)
        provision.provision(self.root, bundle())
        result = self.config.read_text()
        self.assertIn("    existing: !include existing.yaml", result)
        self.assertIn("    homelab_vacuum: !include homelab-vacuum/vacuum.yaml", result)
        self.assertIn("  name: Home", result)
        self.assertTrue(provision.provision(self.root, bundle()))
        self.assertEqual(self.config.read_text(), result)

    def test_existing_package_directory_is_reused(self):
        original = "homeassistant:\n  packages: !include_dir_named packages\n"
        self.config.write_text(original)
        provision.provision(self.root, bundle())
        self.assertTrue(self.config.read_text().startswith(original))
        self.assertEqual(
            (self.root / "packages/homelab_vacuum.yaml").read_text(), "!include ../homelab-vacuum/vacuum.yaml\n"
        )
        self.assertTrue(provision.provision(self.root, bundle()))

    def test_conflicting_config_fails_without_mutation(self):
        for text in [
            "homeassistant: !include home.yaml\n",
            "homeassistant:\n  packages: !include packages.yaml\n",
            "lovelace:\n  resources: []\n",
            "lovelace:\n  mode: yaml\n",
            "frontend:\n  extra_module_url: []\n",
            "default_config:\ndefault_config:\n",
            "defaults: &home\n  name: Home\nhomeassistant: *home\n",
        ]:
            self.config.write_text(text)
            with self.assertRaises(ValueError):
                provision.provision(self.root, bundle(), modern_resources=False)
            self.assertEqual(self.config.read_text(), text)
            self.assertFalse((self.root / ".homelab-vacuum-dirty").exists())

    def test_owner_edit_of_managed_file_is_not_clobbered(self):
        provision.provision(self.root, bundle())
        target = self.root / "homelab-vacuum/vacuum.yaml"
        target.write_text("owner modified\n")
        with self.assertRaisesRegex(ValueError, "refusing to overwrite"):
            provision.provision(self.root, bundle())
        self.assertEqual(target.read_text(), "owner modified\n")

    def test_yaml_resource_mode_preserves_default_and_storage_resources(self):
        storage = self.root / ".storage/lovelace_resources"
        storage.parent.mkdir()
        storage.write_text(json.dumps({"data": {"items": [{"id": "one", "url": "/local/owner.js", "type": "module"}]}}))
        provision.provision(self.root, bundle())
        config = self.config.read_text()
        self.assertIn("resource_mode: yaml", config)
        self.assertIn("/local/owner.js", config)
        self.assertNotIn("  mode: yaml\nresources", config)
        # Older HA loads the module via frontend, keeping storage resources.
        fallback = provision.configuration("default_config:\n", False, [])
        parsed = yaml.compose(fallback)
        root = provision.mapping(parsed)
        self.assertNotIn("resources", provision.mapping(root["lovelace"]))
        self.assertIn("extra_module_url", provision.mapping(root["frontend"]))

    def test_release_checksum_and_archive_paths_fail_closed(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("../escape.py", "bad")
        content = buffer.getvalue()
        asset = {
            "name": "fixture",
            "url": "https://example.invalid/fixture.zip",
            "target": "custom_components/fixture",
            "sha256": "0" * 64,
        }
        with self.assertRaisesRegex(ValueError, "checksum"):
            provision.asset_files(asset, content)
        asset["sha256"] = hashlib.sha256(content).hexdigest()
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            provision.asset_files(asset, content)

    def test_interrupted_install_resumes_and_unchanged_assets_do_not_download(self):
        material = b"fixture card"
        data = bundle()
        data["assets"] = [
            {
                "name": "card",
                "url": "https://example.invalid/card.js",
                "target": "www/card.js",
                "sha256": hashlib.sha256(material).hexdigest(),
            }
        ]
        real_atomic = provision.atomic
        failed = False

        def interrupted(path, content):
            nonlocal failed
            real_atomic(path, content)
            if path.name == "card.js" and not failed:
                failed = True
                raise OSError("simulated interruption after writing asset")

        with patch.object(provision, "atomic", side_effect=interrupted):
            with self.assertRaises(OSError):
                provision.provision(self.root, data, fetch=lambda _: material)
        self.assertTrue(provision.provision(self.root, data, fetch=lambda _: material))
        with patch.object(provision, "download", side_effect=AssertionError("unexpected fetch")):
            self.assertTrue(provision.provision(self.root, data, fetch=provision.download))
        (self.root / "www/card.js").write_text("owner change")
        with self.assertRaisesRegex(ValueError, "asset changed"):
            provision.provision(self.root, data)

    def test_unmanaged_assets_are_adopted_and_preserved_outside_ha_paths(self):
        hacs_target = self.root / "custom_components/hacs"
        hacs_target.mkdir(parents=True)
        (hacs_target / "manifest.json").write_text('{"domain":"hacs"}')
        (hacs_target / "old.py").write_text("old integration")
        card_target = self.root / "www/community/card.js"
        card_target.parent.mkdir(parents=True)
        card_target.write_text("old card")
        storage = self.root / ".storage"
        storage.mkdir()
        (storage / "hacs.data").write_bytes(b"private HACS state\x00")
        (storage / "hacs.auth").write_bytes(b"private HACS authorization\x00")
        (storage / "unrelated").write_bytes(b"other state")
        storage_before = {p.name: p.read_bytes() for p in storage.iterdir()}
        hacs = b"pinned hacs"
        card = b"pinned card"
        hacs_archive = io.BytesIO()
        with zipfile.ZipFile(hacs_archive, "w") as archive:
            archive.writestr("manifest.json", "pinned manifest")
            archive.writestr("new.py", "pinned integration")
        hacs = hacs_archive.getvalue()
        data = bundle()
        data["assets"] = [
            {"name": "hacs", "url": "https://example.invalid/hacs.zip", "target": "custom_components/hacs", "sha256": hashlib.sha256(hacs).hexdigest()},
            {"name": "card", "url": "https://example.invalid/card.js", "target": "www/community/card.js", "sha256": hashlib.sha256(card).hexdigest()},
        ]

        def fetch(asset):
            if asset["name"] == "hacs":
                return hacs
            return card

        self.assertTrue(provision.provision(self.root, data, fetch=fetch))
        backups = list((self.root / ".homelab-vacuum-backups").glob("adopted-*/custom_components/hacs"))
        card_backups = list((self.root / ".homelab-vacuum-backups").glob("adopted-*/www/community/card.js"))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / "old.py").read_text(), "old integration")
        self.assertEqual((backups[0] / "manifest.json").read_text(), '{"domain":"hacs"}')
        self.assertTrue(backups[0].relative_to(self.root / ".homelab-vacuum-backups").parts[0].startswith("adopted-"))
        self.assertEqual(card_backups[0].read_text(), "old card")
        self.assertEqual((self.root / "custom_components/hacs/new.py").read_text(), "pinned integration")
        self.assertEqual((self.root / "www/community/card.js").read_bytes(), card)
        record = json.loads((self.root / ".homelab-vacuum.json").read_text())
        self.assertIn("custom_components/hacs/new.py", record["files"])
        self.assertEqual({p.name: p.read_bytes() for p in storage.iterdir()}, storage_before)
        (self.root / ".homelab-vacuum-dirty").unlink()
        self.assertFalse(provision.provision(self.root, data, fetch=lambda _: self.fail("unexpected download")))
        self.assertEqual({p.name: p.read_bytes() for p in storage.iterdir()}, storage_before)

    def test_adoption_resumes_after_move_before_install(self):
        target = self.root / "custom_components/hacs"
        target.mkdir(parents=True)
        (target / "old.py").write_text("original")
        material = b"pinned"
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("manifest.json", "{}")
            output.writestr("new.py", material)
        content = archive.getvalue()
        data = bundle()
        data["assets"] = [{"name": "hacs", "url": "https://example.invalid/hacs.zip", "target": "custom_components/hacs", "sha256": hashlib.sha256(content).hexdigest()}]
        real_atomic = provision.atomic
        failed = False

        def interrupted(path, bytes_):
            nonlocal failed
            if path.name == "manifest.json" and not failed:
                failed = True
                raise OSError("simulated stop after adoption")
            real_atomic(path, bytes_)

        with patch.object(provision, "atomic", side_effect=interrupted):
            with self.assertRaises(OSError):
                provision.provision(self.root, data, fetch=lambda _: content)
        self.assertFalse(target.exists())
        self.assertEqual(len(list((self.root / ".homelab-vacuum-backups").glob("adopted-*/custom_components/hacs/old.py"))), 1)
        provision.provision(self.root, data, fetch=lambda _: content)
        self.assertEqual((target / "new.py").read_bytes(), material)

    def test_adoption_resumes_when_journal_precedes_move(self):
        target = self.root / "www/card.js"
        target.parent.mkdir(parents=True)
        target.write_text("original card")
        content = b"pinned card"
        data = bundle()
        data["assets"] = [{"name": "card", "url": "https://example.invalid/card.js", "target": "www/card.js", "sha256": hashlib.sha256(content).hexdigest()}]
        with patch.object(provision.os, "rename", side_effect=OSError("simulated stop before move")):
            with self.assertRaisesRegex(OSError, "before move"):
                provision.provision(self.root, data, fetch=lambda _: content)
        self.assertEqual(target.read_text(), "original card")
        journal = json.loads((self.root / ".homelab-vacuum-pending.json").read_text())
        self.assertIn("www/card.js", journal["adoptions"])
        provision.provision(self.root, data, fetch=lambda _: content)
        backups = list((self.root / ".homelab-vacuum-backups").glob("adopted-*/www/card.js"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), "original card")
        self.assertEqual(target.read_bytes(), content)

    def test_adoption_resumes_when_journal_precedes_move(self):
        target = self.root / "www/card.js"
        target.parent.mkdir(parents=True)
        target.write_text("original card")
        content = b"pinned card"
        data = bundle()
        data["assets"] = [{"name": "card", "url": "https://example.invalid/card.js", "target": "www/card.js", "sha256": hashlib.sha256(content).hexdigest()}]
        with patch.object(provision.os, "rename", side_effect=OSError("simulated stop before move")):
            with self.assertRaisesRegex(OSError, "before move"):
                provision.provision(self.root, data, fetch=lambda _: content)
        self.assertEqual(target.read_text(), "original card")
        journal = json.loads((self.root / ".homelab-vacuum-pending.json").read_text())
        self.assertIn("www/card.js", journal["adoptions"])
        provision.provision(self.root, data, fetch=lambda _: content)
        backups = list((self.root / ".homelab-vacuum-backups").glob("adopted-*/www/card.js"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), "original card")
        self.assertEqual(target.read_bytes(), content)

    def test_unmanaged_target_symlink_is_refused(self):
        actual = self.root / "outside"
        actual.write_text("do not move")
        target = self.root / "www/card.js"
        target.parent.mkdir()
        target.symlink_to(actual)
        data = bundle()
        content = b"card"
        data["assets"] = [{"name": "card", "url": "https://example.invalid/card.js", "target": "www/card.js", "sha256": hashlib.sha256(content).hexdigest()}]
        with self.assertRaisesRegex(ValueError, "Symlink"):
            provision.provision(self.root, data, fetch=lambda _: content)
        self.assertEqual(actual.read_text(), "do not move")
        self.assertTrue(target.is_symlink())

    def test_symlink_inside_unmanaged_asset_is_refused(self):
        target = self.root / "custom_components/hacs"
        target.mkdir(parents=True)
        outside = self.root / "outside.py"
        outside.write_text("do not move")
        (target / "linked.py").symlink_to(outside)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("manifest.json", "{}")
        zipped = archive.getvalue()
        data = bundle()
        data["assets"] = [{"name": "hacs", "url": "https://example.invalid/hacs.zip", "target": "custom_components/hacs", "sha256": hashlib.sha256(zipped).hexdigest()}]
        with self.assertRaisesRegex(ValueError, "Symlink"):
            provision.provision(self.root, data, fetch=lambda _: zipped)
        self.assertTrue((target / "linked.py").is_symlink())
        self.assertEqual(outside.read_text(), "do not move")

    def test_interrupted_upgrade_can_finish_removing_old_owned_files(self):
        material = b"fixture card"
        data = bundle()
        data["assets"] = [
            {
                "name": "card",
                "url": "https://example.invalid/card.js",
                "target": "www/card.js",
                "sha256": hashlib.sha256(material).hexdigest(),
            }
        ]
        provision.provision(self.root, data, fetch=lambda _: material)
        data["assets"][0]["target"] = "www/new-card.js"
        real_atomic = provision.atomic

        def interrupted(path, content):
            if path.name == ".homelab-vacuum.json":
                raise OSError("simulated interruption after deleting obsolete asset")
            real_atomic(path, content)

        with patch.object(provision, "atomic", side_effect=interrupted):
            with self.assertRaises(OSError):
                provision.provision(self.root, data, fetch=lambda _: material)
        self.assertFalse((self.root / "www/card.js").exists())
        self.assertTrue(provision.provision(self.root, data, fetch=lambda _: material))
        self.assertEqual((self.root / "www/new-card.js").read_bytes(), material)

    def test_host_reconcile_restarts_only_when_dirty_and_acknowledges_after_health(self):
        for status in ("restart", "unchanged"):
            with patch.object(provision.subprocess, "run") as run:
                run.return_value = subprocess.CompletedProcess([], 0, stdout=status + "\n", stderr="")
                provision.host(SERVICE, INVENTORY)
                commands = [call.args[0] for call in run.call_args_list]
                compile(run.call_args_list[1].kwargs["input"], "streamed-provision.py", "exec")
                self.assertEqual(commands[0], ["docker", "volume", "inspect", "ha_config"])
                self.assertIn("type=volume,src=ha_config,dst=/config", commands[1])
                self.assertEqual("--force-recreate" in commands[2], status == "restart")
                self.assertIn("--wait", commands[2])
                self.assertIn("exec", commands[3])
        with patch.object(provision.subprocess, "run") as run:
            run.side_effect = [
                subprocess.CompletedProcess([], 0),
                subprocess.CompletedProcess([], 0, stdout="restart\n", stderr=""),
                subprocess.CalledProcessError(1, "compose"),
            ]
            with self.assertRaises(subprocess.CalledProcessError):
                provision.host(SERVICE, INVENTORY)
            self.assertEqual(run.call_count, 3)  # no dirty-marker acknowledgement

    def test_dashboard_and_actions_share_the_entity_inventory(self):
        data = bundle()
        rendered = provision.render(data["templates"], data["vacuum"])
        entities = set(data["vacuum"]["entities"].values())
        referenced = set()

        def visit(value, key=None):
            if isinstance(value, dict):
                for k, v in value.items():
                    visit(v, k)
            elif isinstance(value, list):
                for item in value:
                    visit(item, key)
            elif isinstance(value, str) and key != "service":
                domains = ("vacuum", "camera", "sensor", "select", "switch", "input_boolean", "script")
                if value.startswith(tuple(domain + "." for domain in domains)):
                    referenced.add(value)

        for content in rendered.values():
            visit(yaml.safe_load(content))
        self.assertLessEqual(referenced, entities)
        package = yaml.safe_load(rendered["homelab-vacuum/vacuum.yaml"])
        helper = package["input_boolean"][data["vacuum"]["entities"]["schedule"].split(".")[1]]
        self.assertNotIn("initial", helper)
        self.assertEqual(package["automation"][0]["condition"][0]["state"], "on")
        confirmation = data["vacuum"]["entities"]["rooms_confirmed"].split(".")[1]
        self.assertFalse(package["input_boolean"][confirmation]["initial"])
        confirmed = copy.deepcopy(data)
        confirmed["vacuum"]["rooms_confirmed"] = True
        dashboard_yaml = provision.render(confirmed["templates"], confirmed["vacuum"])
        dashboard = yaml.safe_load(dashboard_yaml["homelab-vacuum/dashboard-vacuum.yaml"])
        modes = dashboard["views"][0]["cards"][0]["map_modes"]
        self.assertEqual([m["template"] for m in modes], ["vacuum_clean_segment", "vacuum_clean_zone"])
        self.assertEqual(
            [r["id"] for r in modes[0]["predefined_selections"]],
            [str(r["segment"]) for r in data["vacuum"]["rooms"]],
        )
