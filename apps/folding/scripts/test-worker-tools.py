#!/usr/bin/env python3
"""Exercise Worker helper integrity and installation without provider access."""

import hashlib
import importlib.util
import io
import json
import shlex
import tarfile
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("worker_tools", Path(__file__).with_name("prepare-worker-tools.py"))
tools = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tools)


class WorkerToolTests(unittest.TestCase):
    def prepare(self, root, *, corrupt=False, wrong_version=False, escape=False):
        marker = root / "executed"
        payloads = {}
        metadata = {}
        for index, (name, version, archive) in enumerate(
            [
                ("wasm-bindgen", "0.2.129", "wasm-bindgen-0.2.129-aarch64-unknown-linux-musl.tar.gz"),
                ("wasm-opt", "132", "binaryen-version_132-aarch64-linux.tar.gz"),
            ],
            1,
        ):
            reported = "0.2.130" if wrong_version and index == 1 else version
            prefix = "wasm-bindgen " if index == 1 else "wasm-opt version "
            script = f"#!/bin/sh\nprintf '%s\\n' '{prefix}{reported}'\n: > {shlex.quote(str(marker))}\n".encode()
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode="w:gz") as bundle:
                for path, content in [(f"package/bin/{name}", script), ("package/lib/sidecar.txt", b"retained")]:
                    member = tarfile.TarInfo("../escape" if escape else path)
                    member.size = len(content)
                    member.mode = 0o755
                    bundle.addfile(member, io.BytesIO(content))
            payloads[index] = buffer.getvalue()
            digest = "0" * 64 if corrupt else hashlib.sha256(payloads[index]).hexdigest()
            metadata[index] = {"assets": [{"name": archive, "id": index, "digest": "sha256:" + digest}]}

        def download(url, accept):
            self.assertTrue(url.startswith("https://api.github.com/repos/"))
            if "/tags/" in url:
                self.assertEqual(accept, "application/vnd.github+json")
                return json.dumps(metadata[1 if "wasm-bindgen/wasm-bindgen" in url else 2]).encode()
            self.assertEqual(accept, "application/octet-stream")
            return payloads[int(url.rsplit("/", 1)[1])]

        result = tools.prepare(root / "tools", "0.2.129", "132", "Linux", "aarch64", download)
        return result, marker

    def test_exact_helpers_preserve_libraries_and_reuse_without_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result, marker = self.prepare(root)
            self.assertTrue(marker.exists())
            self.assertEqual(set(result), {"WASM_BINDGEN_BIN", "WASM_OPT_BIN"})
            for binary in result.values():
                self.assertEqual((binary.parent.parent / "lib/sidecar.txt").read_text(), "retained")

            def no_download(*_):
                raise AssertionError("Exact prepared helpers must not be downloaded again")

            again = tools.prepare(root / "tools", "0.2.129", "132", "Linux", "aarch64", no_download)
            self.assertEqual(result, again)

    def test_checksum_failure_cannot_execute_or_publish_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                self.prepare(root, corrupt=True)
            self.assertFalse((root / "executed").exists())
            self.assertFalse((root / "tools").exists())

    def test_valid_archive_with_wrong_tool_version_is_not_published(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "version differs"):
                self.prepare(root, wrong_version=True)
            self.assertFalse(any((root / "tools").glob("wasm-bindgen-*")))

    def test_archive_cannot_escape_its_staging_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(tarfile.FilterError):
                self.prepare(root, escape=True)
            self.assertFalse((root / "tools/escape").exists())
            self.assertFalse((root / "executed").exists())


if __name__ == "__main__":
    unittest.main()
