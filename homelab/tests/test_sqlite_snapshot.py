import importlib.util
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('sqlite_snapshot', Path(__file__).parents[1] / 'scripts/sqlite-snapshot.py')
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


class SQLiteRecoveryTests(unittest.TestCase):
    def test_cold_copy_includes_committed_wal_and_restores_rows(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            db = sqlite3.connect(root / 'live.sqlite')
            try:
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('CREATE TABLE records(id INTEGER PRIMARY KEY, name TEXT)')
                db.execute('INSERT INTO records(name) VALUES (?)', ('家 — restored',))
                db.commit()
                copied = root / 'cold'
                copied.mkdir()
                # Model a cold container copy retaining the complete WAL set.
                for file in root.glob('live.sqlite*'):
                    shutil.copyfile(file, copied / file.name)
                output = root / 'backup.sqlite'
                snapshot.snapshot_database(copied / 'live.sqlite', output)
                with sqlite3.connect(output) as restored:
                    self.assertEqual(restored.execute('SELECT name FROM records').fetchall(), [('家 — restored',)])
                self.assertEqual(output.stat().st_mode & 0o777, 0o600)
                with self.assertRaisesRegex(ValueError, 'already exists'):
                    snapshot.snapshot_database(copied / 'live.sqlite', output)
            finally:
                db.close()

    def test_corrupt_database_and_foreign_key_violation_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            corrupt = root / 'bad.sqlite'
            corrupt.write_bytes(b'corrupt')
            with self.assertRaises(sqlite3.DatabaseError):
                snapshot.snapshot_database(corrupt, root / 'bad-backup.sqlite')
            source = root / 'fk.sqlite'
            with sqlite3.connect(source) as db:
                db.executescript('CREATE TABLE parent(id PRIMARY KEY); CREATE TABLE child(id REFERENCES parent(id)); INSERT INTO child VALUES(1);')
            with self.assertRaisesRegex(RuntimeError, 'foreign keys'):
                snapshot.snapshot_database(source, root / 'fk-backup.sqlite')


if __name__ == '__main__':
    unittest.main()
