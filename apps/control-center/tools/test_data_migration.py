import importlib.util
import json
import sqlite3
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

spec = importlib.util.spec_from_file_location("migration", Path(__file__).with_name("data_migration.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / "target.sqlite"
        self.archive = self.root / "archive.sqlite"
        self.export = self.root / "source.jsonl"
        with sqlite3.connect(self.target) as db:
            db.executescript("CREATE TABLE sample(id TEXT PRIMARY KEY, value TEXT, stamp TEXT, flag INTEGER);")
        self.columns = {
            "kind": "columns",
            "schema": "public",
            "table": "sample",
            "columns": [
                {"name": "id", "type": "text"},
                {"name": "value", "type": "jsonb"},
                {"name": "stamp", "type": "timestamp with time zone"},
                {"name": "flag", "type": "boolean"},
            ],
        }
        self.row = {
            "kind": "row",
            "schema": "public",
            "table": "sample",
            "value": {
                "id": "sample_1",
                "value": {"nested": [None, False, "hello"]},
                "stamp": "2026-11-07T12:30:00.123456-08:00",
                "flag": True,
            },
        }

    def write(self, items):
        self.export.write_text("".join(json.dumps(x) + "\n" for x in items))

    def run_import(self):
        return m.import_snapshot(self.export, self.target, self.archive)

    def count(self):
        with sqlite3.connect(self.target) as db:
            return db.execute("SELECT count(*) FROM sample").fetchone()[0]

    def test_roundtrip_microseconds_json_null_and_archive(self):
        self.write([self.columns, self.row, {"kind": "complete"}])
        report = self.run_import()
        self.assertEqual(report["tables"][0]["rows"], 1)
        with sqlite3.connect(self.target) as db:
            row = db.execute("SELECT * FROM sample").fetchone()
        self.assertEqual(row[2:], ("2026-11-07T20:30:00.123456Z", 1))
        self.assertEqual(json.loads(row[1]), self.row["value"]["value"])
        with sqlite3.connect(self.archive) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM source_record").fetchone()[0], 3)

    def test_duplicate_id_rolls_back_every_insert(self):
        self.write([self.columns, self.row, self.row, {"kind": "complete"}])
        with self.assertRaises(sqlite3.IntegrityError):
            self.run_import()
        self.assertEqual(self.count(), 0)

    def test_truncated_export_rolls_back(self):
        self.write([self.columns, self.row])
        with self.assertRaises(ValueError):
            self.run_import()
        self.assertEqual(self.count(), 0)

    def test_unknown_table_refused(self):
        self.columns["table"] = "unexpected"
        self.write([self.columns, {"kind": "complete"}])
        with self.assertRaises(ValueError):
            self.run_import()

    def test_existing_data_not_overwritten(self):
        with sqlite3.connect(self.target) as db:
            db.execute("INSERT INTO sample(id) VALUES ('existing')")
        self.write([self.columns, self.row, {"kind": "complete"}])
        with self.assertRaises(ValueError):
            self.run_import()
        self.assertEqual(self.count(), 1)

    def test_retired_data_archived(self):
        self.columns["table"] = "wake_photo"
        self.row["table"] = "wake_photo"
        self.write([self.columns, self.row, {"kind": "complete"}])
        report = self.run_import()
        self.assertEqual(report["tables"][0]["disposition"], "archive")
        self.assertEqual(report["tables"][0]["rows"], 1)

    def test_precise_numeric_json_preserved(self):
        self.assertEqual(m.convert({"n": Decimal("0.123456789012345678901")}, "jsonb"), '{"n":0.123456789012345678901}')

    def test_postgres_short_fraction(self):
        self.assertEqual(
            m.convert("2026-07-20T16:23:17.96+00:00", "timestamp with time zone"), "2026-07-20T16:23:17.960000Z"
        )

    def test_overflow_and_unknown_types_rejected(self):
        with self.assertRaises(ValueError):
            m.convert(2**63, "bigint")
        with self.assertRaises(ValueError):
            m.convert("2026-11-07 12:00:00", "timestamp without time zone")

    def test_media_hashes_and_symlink_rejection(self):
        media = self.root / "media"
        media.mkdir()
        (media / "frame").write_bytes(b"fixture")
        report = m.media_manifest(media, self.root / "manifest.jsonl")
        self.assertEqual((report["files"], report["bytes"]), (1, 7))
        (media / "link").symlink_to(media / "frame")
        with self.assertRaises(ValueError):
            m.media_manifest(media, self.root / "invalid.jsonl")

    def test_archive_cannot_be_overwritten(self):
        self.archive.touch()
        self.write([self.columns, {"kind": "complete"}])
        with self.assertRaises(ValueError):
            self.run_import()


if __name__ == "__main__":
    unittest.main()
