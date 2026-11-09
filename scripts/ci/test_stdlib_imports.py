"""Keep test discovery paths from replacing Python's native I/O modules."""

import subprocess
import sys
import unittest
from pathlib import Path


class StandardLibraryImportTests(unittest.TestCase):
    def test_fresh_selector_import_after_discovery_path_is_added(self):
        code = """
import importlib.machinery
import importlib.util
import subprocess
import sys
sys.modules.pop('select', None)
sys.modules.pop('selectors', None)
sys.path.insert(0, sys.argv[1])
# Linux's select is a path-loaded native extension; Darwin builds can make it
# builtin. Exercise the path lookup too so Darwin cannot hide this collision.
spec = importlib.machinery.PathFinder.find_spec('select')
if spec is not None:
    module = importlib.util.module_from_spec(spec)
    sys.modules['select'] = module
    spec.loader.exec_module(module)
import selectors
with selectors.SelectSelector() as selector:
    assert selector.select(0) == []
"""
        result = subprocess.run(
            [sys.executable, "-c", code, str(Path(__file__).parent)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
