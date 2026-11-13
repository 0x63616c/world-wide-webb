import importlib.util, io, os, tarfile, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "restore_archive", Path(__file__).parents[1] / "scripts/restore-archive.py"
)
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.archive = self.root / "input.tar"
        self.target = self.root / "output"

    def write(self, entries):
        with tarfile.open(self.archive, "w") as a:
            for name, kind in entries:
                m = tarfile.TarInfo(name)
                m.uid = 1000
                m.gid = 1000
                m.mode = 0o6777
                if kind == "file":
                    m.size = 4
                    a.addfile(m, io.BytesIO(b"data"))
                else:
                    m.type = kind
                    m.linkname = "../escape"
                    a.addfile(m)

    def test_regular_data_restores_privately_without_applying_archive_privileges(self):
        self.write([("data/file", "file")])
        records = restore.extract(self.archive, self.target)
        self.assertEqual((self.target / "data/file").read_bytes(), b"data")
        self.assertEqual((self.target / "data/file").stat().st_mode & 0o7777, 0o600)
        self.assertEqual(records[0]["uid"], 1000)
        with self.assertRaises(ValueError):
            restore.extract(self.archive, self.target)

    def test_beszel_database_history_and_ssh_identity_restore_together(self):
        payloads = {
            "data.db": b"fixture database and historical records",
            "auxiliary.db": b"fixture auxiliary database",
            "id_ed25519": b"synthetic private identity",
        }
        with tarfile.open(self.archive, "w:gz") as archive:
            for name, data in payloads.items():
                member = tarfile.TarInfo("./" + name)
                member.uid = 450
                member.gid = 450
                member.mode = 0o600
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
        records = restore.extract(self.archive, self.target)
        self.assertEqual({record["path"] for record in records}, set(payloads))
        self.assertTrue(all(record["uid"] == 450 and record["gid"] == 450 for record in records))
        for name, data in payloads.items():
            self.assertEqual((self.target / name).read_bytes(), data)
            self.assertEqual((self.target / name).stat().st_mode & 0o777, 0o600)

    def test_unsafe_paths_links_special_files_and_duplicates_are_rejected_before_creation(self):
        for entries in [
            [("../outside", "file")],
            [("/absolute", "file")],
            [("link", tarfile.SYMTYPE)],
            [("hard", tarfile.LNKTYPE)],
            [("fifo", tarfile.FIFOTYPE)],
            [("a/b", "file"), ("a//b", "file")],
        ]:
            with self.subTest(entries=entries):
                self.write(entries)
                with self.assertRaises(ValueError):
                    restore.extract(self.archive, self.target)
                self.assertFalse(self.target.exists())

    def test_size_and_free_space_budgets_are_admission_checks(self):
        self.write([("file", "file")])
        with self.assertRaises(ValueError):
            restore.extract(self.archive, self.target, max_bytes=3)
        with patch.object(restore.shutil, "disk_usage", return_value=type("Disk", (), {"free": 0})()):
            with self.assertRaises(RuntimeError):
                restore.extract(self.archive, self.target)
        self.assertFalse(self.target.exists())

    def test_root_is_rejected_before_any_extraction(self):
        self.write([("file", "file")])
        with patch.object(restore.os, "geteuid", return_value=0):
            with self.assertRaises(RuntimeError):
                restore.extract(self.archive, self.target)
        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main()
