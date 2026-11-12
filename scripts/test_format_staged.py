import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("format-staged.py")


class StagedFormattingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "Test")
        self.tool_dir = self.root / "bin"
        self.tool_dir.mkdir()
        formatter = self.tool_dir / "xcrun"
        formatter.write_text(
            "#!/bin/sh\n"
            '[ "$1" = swift-format ] || exit 2\n'
            'if [ "$2" = format ] && [ "$3" = --in-place ]; then printf "formatted\\n" > "$4"; exit 0; fi\n'
            '[ "$2" = lint ] && [ "$3" = --strict ] && [ "$4" = example.swift ] || exit 2\n'
        )
        formatter.chmod(0o755)

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root)

    def run_script(self):
        env = os.environ.copy()
        env["PATH"] = f"{self.tool_dir}:{env['PATH']}"
        return subprocess.run([sys.executable, SCRIPT], cwd=self.root, env=env, capture_output=True)

    def test_formatted_file_is_staged_into_same_commit(self):
        source = self.root / "example.swift"
        source.write_text("unformatted\n")
        self.git("add", "example.swift")
        self.assertEqual(self.run_script().returncode, 0)
        self.assertEqual(self.git("show", ":example.swift"), b"formatted\n")
        self.assertEqual(source.read_text(), "formatted\n")

    def test_unstaged_changes_are_not_silently_committed(self):
        source = self.root / "example.swift"
        source.write_text("staged\n")
        self.git("add", "example.swift")
        source.write_text("unstaged\n")
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"partially staged", result.stderr)
        self.assertEqual(self.git("show", ":example.swift"), b"staged\n")
        self.assertEqual(source.read_text(), "unstaged\n")

    def test_other_text_files_still_get_whitespace_check(self):
        source = self.root / "note.md"
        source.write_text("bad trailing space \n")
        self.git("add", "note.md")
        self.assertNotEqual(self.run_script().returncode, 0)


if __name__ == "__main__":
    unittest.main()
