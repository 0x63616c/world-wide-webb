"""Exercise the scoped credential handoff using synthetic executables only."""
import os
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path


class LoginTests(unittest.TestCase):
    def test_synthetic_interpreters_retain_the_required_shared_library_path(self):
        with tempfile.TemporaryDirectory(prefix="login-loader-") as temporary:
            interpreter = Path(temporary) / "python-runtime"
            loader_path = str(Path(temporary) / "synthetic-library")
            if os.environ.get("LD_LIBRARY_PATH"):
                loader_path += os.pathsep + os.environ["LD_LIBRARY_PATH"]
            interpreter.write_text(
                '#!/bin/sh\n'
                + '[ "${LD_LIBRARY_PATH:-}" = ' + shlex.quote(loader_path) + ' ] || exit 127\n'
                + 'exec ' + shlex.quote(sys.executable) + ' "$@"\n'
            )
            interpreter.chmod(0o755)
            with patch.dict(os.environ, {"LD_LIBRARY_PATH": loader_path}):
                self._exercise_login(str(interpreter))

    def test_only_selected_field_reaches_docker_stdin_and_no_decrypted_content_is_logged(self):
        self._exercise_login(sys.executable)

    def _exercise_login(self, interpreter):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'secrets').mkdir()
            (root / 'secrets/vault.yaml').write_text('synthetic ciphertext')
            tools = root / 'tools'
            tools.mkdir()
            sops = tools / 'sops'
            sops.write_text(f'#!{sys.executable}\n' + '''import sys
from pathlib import Path
assert sys.argv[1:4] == ['--decrypt', '--extract', '["GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN"]']
assert Path(sys.argv[4]).read_text() == 'synthetic ciphertext'
print('synthetic-publication-input')
''')
            docker = tools / 'docker'
            docker.write_text(f'#!{sys.executable}\n' + '''import sys
assert sys.argv[1:] == ['login', 'ghcr.io', '-u', '0x63616c', '--password-stdin']
assert sys.stdin.read() == 'synthetic-publication-input'
print('Synthetic container authentication confirmed')
''')
            for command in (sops, docker):
                command.chmod(0o755)
            result = subprocess.run(
                [interpreter, str(Path(__file__).with_name('login.py'))],
                # setup-python's Linux interpreter needs its shared-library location;
                # inherit that runtime setting without exposing credential variables.
                env={'PATH': str(tools) + os.pathsep + os.defpath, 'GITHUB_WORKSPACE': str(root),
                     **({'LD_LIBRARY_PATH': os.environ['LD_LIBRARY_PATH']} if 'LD_LIBRARY_PATH' in os.environ else {})},
                capture_output=True, text=True, check=True,
            )
            self.assertNotIn('synthetic-publication-input', result.stdout + result.stderr)
            self.assertIn('confirmed', result.stdout)


if __name__ == '__main__':
    unittest.main()
