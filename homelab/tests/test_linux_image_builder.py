import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "linux_image_builder", Path(__file__).parents[1] / "runner/images/linux/build-image.py"
)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PublishedImageTests(unittest.TestCase):
    def test_refresh_identifies_new_digest_alongside_its_cached_base(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            base = "sha256:" + "a" * 64
            corrected = "sha256:" + "b" * 64
            (cache / base).mkdir()
            previous = builder.cached_digests(cache)
            (cache / corrected).mkdir()
            (cache / "source-tag").symlink_to(corrected, target_is_directory=True)
            self.assertEqual(builder.published_digest(cache, previous), corrected)

    def test_fresh_publication_identifies_its_only_new_digest(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            corrected = "sha256:" + "b" * 64
            (cache / corrected).mkdir()
            self.assertEqual(builder.published_digest(cache, set()), corrected)

    def test_no_new_or_multiple_new_digests_never_claim_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            base = "sha256:" + "a" * 64
            (cache / base).mkdir()
            with self.assertRaises(RuntimeError):
                builder.published_digest(cache, {base})
            for value in ["b", "c"]:
                (cache / ("sha256:" + value * 64)).mkdir()
            with self.assertRaises(RuntimeError):
                builder.published_digest(cache, {base})
