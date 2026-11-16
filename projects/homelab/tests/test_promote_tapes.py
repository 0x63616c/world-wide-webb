import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("promote_tapes", Path(__file__).parents[1] / "scripts/promote-tapes.py")
promotion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promotion)

IMAGE = "ghcr.io/0x63616c/www-tapes@sha256:" + "b" * 64


class TapesPromotionTests(unittest.TestCase):
    def test_first_pin_needs_no_existing_manifest(self):
        self.assertEqual(
            promotion.promote("a" * 40, IMAGE),
            {
                "schemaVersion": 1,
                "sourceRepository": "0x63616c/world-wide-webb",
                "sourceRevision": "a" * 40,
                "image": IMAGE,
            },
        )

    def test_mutable_foreign_or_unbound_images_are_rejected(self):
        for revision, image in (
            ("main", IMAGE),
            ("a" * 40, "ghcr.io/0x63616c/www-tapes:latest"),
            ("a" * 40, "ghcr.io/0x63616c/www-control-center-mini@sha256:" + "b" * 64),
        ):
            with self.subTest(revision=revision, image=image), self.assertRaises(ValueError):
                promotion.promote(revision, image)

    def test_unknown_fields_schema_and_repository_are_rejected(self):
        valid = promotion.promote("a" * 40, IMAGE)
        for changes in ({"databaseEngine": "sqlite"}, {"sourceRepository": "other/repo"}, {"schemaVersion": 2}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                promotion.validate({**valid, **changes})


if __name__ == "__main__":
    unittest.main()
