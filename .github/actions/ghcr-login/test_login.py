"""Exercise the scoped credential handoff using synthetic executables only."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class LoginTests(unittest.TestCase):
    def test_only_selected_field_reaches_docker_stdin_and_no_decrypted_content_is_logged(self):
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
                [sys.executable, str(Path(__file__).with_name('login.py'))],
                env={'PATH': str(tools) + os.pathsep + os.defpath, 'GITHUB_WORKSPACE': str(root)},
                capture_output=True, text=True, check=True,
            )
            self.assertNotIn('synthetic-publication-input', result.stdout + result.stderr)
            self.assertIn('confirmed', result.stdout)


if __name__ == '__main__':
    unittest.main()
