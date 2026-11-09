"""Run the real dependency bootstrap with isolated release transports."""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import textwrap
import unittest
from pathlib import Path


class DependencyDownloadTests(unittest.TestCase):
    def exercise(self, mode):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tools = root / "tools"
            tools.mkdir()
            shutil.copy2(Path(__file__).with_name("check_dependencies.sh"), tools)
            (tools / "versions.json").write_text('{"cargo-deny":"0.20.2"}')
            name = "cargo-deny-0.20.2-aarch64-unknown-linux-musl"
            payload = root / "cargo-deny"
            payload.write_text("#!/bin/sh\ntest \"$1\" = check\nprintf 'dependency gate executed\\n'\n")
            payload.chmod(0o755)
            archive = root / "payload.tar.gz"
            with tarfile.open(archive, "w:gz") as bundle:
                bundle.add(payload, arcname=name + "/cargo-deny")
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            (root / "checksum").write_text(("0" * 64 if mode == "bad-checksum" else digest) + "  " + name + ".tar.gz\n")
            (root / "metadata").write_text(
                json.dumps(
                    {
                        "assets": [
                            {"id": 111, "name": name + ".tar.gz"},
                            {"id": 222, "name": name + ".tar.gz.sha256"},
                        ]
                    }
                )
            )
            bin_dir = root / "bin"
            bin_dir.mkdir()
            uname = bin_dir / "uname"
            uname.write_text('#!/bin/sh\nif [ "$1" = -s ]; then echo Linux; else echo aarch64; fi\n')
            uname.chmod(0o755)
            curl = bin_dir / "curl"
            curl.write_text(
                f"#!{sys.executable}\n"
                + textwrap.dedent("""\
                import os, pathlib, shutil, sys
                root = pathlib.Path(os.environ['FIXTURE'])
                mode = os.environ['MODE']
                args = sys.argv[1:]
                url = next(a for a in args if a.startswith('https://'))
                with (root / 'requests').open('a') as log:
                    log.write(url + '\\n')
                if 'api.github.com' in url and mode == 'api-down':
                    sys.exit(22)
                if '/releases/download/' in url and mode != 'api-down':
                    raise AssertionError('The healthy API must not use the failing browser route')
                if '/tags/' in url:
                    source = 'metadata'
                elif url.endswith('/222') or url.endswith('.sha256'):
                    source = 'checksum'
                else:
                    source = 'payload.tar.gz'
                if '/assets/' in url:
                    assert 'Accept: application/octet-stream' in args
                shutil.copyfile(root / source, args[args.index('-o') + 1])
                """)
            )
            curl.chmod(0o755)
            result = subprocess.run(
                ["bash", str(tools / "check_dependencies.sh")],
                env=dict(
                    os.environ,
                    PATH=str(bin_dir) + os.pathsep + os.environ["PATH"],
                    XDG_CACHE_HOME=str(root / "cache"),
                    FIXTURE=temporary,
                    MODE=mode,
                ),
                capture_output=True,
                text=True,
                check=False,
            )
            requests = (root / "requests").read_text().splitlines()
            installed = (
                root / "cache/world-wide-webb/cargo-deny/0.20.2/aarch64-unknown-linux-musl/cargo-deny"
            ).exists()
            return result, requests, installed

    def test_api_bytes_and_checksum_run_the_original_dependency_gate(self):
        result, requests, installed = self.exercise("healthy-api")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(requests), 3)
        self.assertTrue(all("api.github.com" in url for url in requests))
        self.assertTrue(installed)
        self.assertIn("dependency gate executed", result.stdout)

    def test_browser_fallback_keeps_the_gate_available_when_api_is_unavailable(self):
        result, requests, installed = self.exercise("api-down")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sum("/releases/download/" in url for url in requests), 2)
        self.assertTrue(installed)

    def test_corrupt_checksum_never_installs_or_executes_the_tool(self):
        result, _, installed = self.exercise("bad-checksum")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(installed)
        self.assertNotIn("dependency gate executed", result.stdout)


if __name__ == "__main__":
    unittest.main()
