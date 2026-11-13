"""Real Git equivalence across the import and unrelated verification changes."""

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("input_hash", Path(__file__).with_name("input_hash.py"))
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class InputHashTests(unittest.TestCase):
    def test_native_inputs_survive_import_and_ignore_backend_tests_and_docs(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=repo, text=True).strip()

            def write(name, contents):
                path = repo / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(contents)

            def commit():
                git("add", ".")
                git("commit", "-qm", "Fixture")
                return git("rev-parse", "HEAD")

            git("init", "-q")
            git("config", "user.name", "Input hash test")
            git("config", "user.email", "test@example.invalid")
            git("config", "commit.gpgsign", "false")
            write("apps/ios/App/Screen.swift", "native source")
            legacy = commit()
            expected = module.input_hash("folding.native", legacy, repo)
            (repo / "projects/folding/apps").mkdir(parents=True)
            git("mv", "apps/ios", "projects/folding/apps/ios")
            moved = commit()
            self.assertEqual(expected, module.input_hash("folding.native", moved, repo))
            write("projects/folding/apps/ios/BuildTests/AppTests.swift", "changed test")
            write("projects/folding/backend/crates/worker/src/lib.rs", "changed backend")
            write("projects/folding/README.md", "changed docs")
            unrelated = commit()
            self.assertEqual(expected, module.input_hash("folding.native", unrelated, repo))
            write("projects/folding/apps/ios/App/Screen.swift", "changed native source")
            changed = commit()
            self.assertNotEqual(expected, module.input_hash("folding.native", changed, repo))


if __name__ == "__main__":
    unittest.main()
