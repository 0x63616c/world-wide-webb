import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("migration", Path(__file__).with_name("migrate-d1.py"))
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


class NestedMigrationSourceTests(unittest.TestCase):
    def test_committed_migrations_prepare_from_a_nested_product_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            product = repository / "projects/folding"
            migrations = product / "backend/migrations"
            migrations.mkdir(parents=True)
            (migrations / "0001_fixture.sql").write_text("CREATE TABLE fixture (id INTEGER);\n")
            package = product / "backend/node_modules/wrangler/package.json"
            package.parent.mkdir(parents=True)
            package.write_text(json.dumps({"version": migration.VERSION}))
            cli = package.parent / "wrangler-dist/cli.js"
            cli.parent.mkdir()
            cli.write_text("// Synthetic CLI identity; prepare does not execute it.\n")

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=repository, text=True).strip()

            git("init", "-q")
            git("config", "user.name", "Migration test")
            git("config", "user.email", "test@example.invalid")
            git("config", "commit.gpgsign", "false")
            git("add", ".")
            git("commit", "-qm", "Fixture")
            config = repository / "configuration.json"
            config.write_text(
                json.dumps(
                    {
                        "account_id": "a" * 32,
                        "compatibility_date": "2026-11-07",
                        "vars": {"DEPLOYMENT": "production", "WORKER_VERSION": git("rev-parse", "HEAD")},
                        "d1_databases": [
                            {
                                "binding": "DB",
                                "database_name": "folding-production",
                                "database_id": "00000000-0000-4000-8000-000000000001",
                            }
                        ],
                    }
                )
            )
            original = migration.ROOT
            migration.ROOT = product
            try:
                migration.prepare(config, "production", repository / "prepared", True)
                self.assertTrue((repository / "prepared/migrations/0001_fixture.sql").is_file())
            finally:
                migration.ROOT = original


if __name__ == "__main__":
    unittest.main()
