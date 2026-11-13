import importlib.util
import sqlite3
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "published_build", Path(__file__).with_name("register-published-build.py")
)
policy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(policy)


class PublishedBuildTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        schema = policy.ROOT / "backend/migrations/0023_published_ios_builds.sql"
        self.db.executescript(schema.read_text())
        self.addCleanup(self.db.close)

    def execute(self, sql, parameters):
        try:
            cursor = self.db.execute(sql, parameters)
            self.db.commit()
            return [dict(row) for row in cursor.fetchall()]
        except sqlite3.Error as error:
            self.db.rollback()
            raise RuntimeError("D1 query failed") from error

    def test_registration_retries_reuse_identity_and_cannot_rebind_a_build(self):
        first = policy.register(self.execute, "production", "TEAM.app.folding", "43", "a" * 40)
        retry = policy.register(self.execute, "production", "TEAM.app.folding", "43", "a" * 40)
        self.assertEqual(first, retry)
        with self.assertRaisesRegex(RuntimeError, "differs"):
            policy.register(self.execute, "production", "TEAM.app.folding", "43", "b" * 40)
        self.assertEqual(self.db.execute("SELECT source_commit FROM published_ios_builds").fetchone()[0], "a" * 40)

    def test_lost_write_response_uses_readback_without_repeating_the_write(self):
        writes = []

        def execute(sql, parameters):
            rows = self.execute(sql, parameters)
            if sql == policy.REGISTER_SQL:
                writes.append(1)
                raise RuntimeError("Write committed, response lost")
            return rows

        result = policy.register(execute, "production", "TEAM.app.folding", "43", "a" * 40)
        self.assertEqual(result["build_number"], 43)
        self.assertEqual(len(writes), 1)

    def test_distribution_readback_never_reauthorizes_a_removed_build(self):
        policy.register(self.execute, "production", "TEAM.app.folding", "43", "a" * 40)
        self.db.execute("DELETE FROM published_ios_builds")
        self.db.commit()
        with self.assertRaisesRegex(RuntimeError, "missing"):
            policy.confirm(self.execute, "production", "TEAM.app.folding", "43", "a" * 40)
        self.assertEqual(self.db.execute("SELECT count(*) FROM published_ios_builds").fetchone()[0], 0)

    def test_apps_have_independent_policy_keys(self):
        for environment, app in [
            ("production", "TEAM.app.folding"),
            ("production", "TEAM.other"),
        ]:
            policy.register(self.execute, environment, app, "43", "a" * 40)
        self.assertEqual(self.db.execute("SELECT count(*) FROM published_ios_builds").fetchone()[0], 2)


if __name__ == "__main__":
    unittest.main()
