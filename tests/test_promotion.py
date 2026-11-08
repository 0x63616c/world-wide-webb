import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('promotion', Path(__file__).parents[1] / 'scripts/promote-control-center.py')
promotion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promotion)


class PromotionTests(unittest.TestCase):
    def setUp(self):
        self.current = json.loads((Path(__file__).parents[1] / 'services/control-center/release.json').read_text())

    def test_committed_manifest_validates(self):
        promotion.validate(self.current)

    def test_promotion_changes_app_without_changing_database(self):
        updated = promotion.promote(self.current, 'a' * 40,
                                    'ghcr.io/0x63616c/www-control-center-mini@sha256:' + 'b' * 64)
        self.assertEqual(updated['databaseEngine'], self.current['databaseEngine'])
        self.assertEqual(updated['sourceRevision'], 'a' * 40)
        self.assertNotEqual(updated['image'], self.current['image'])

    def test_mutable_or_foreign_image_and_branch_are_rejected(self):
        for revision, image in (
            ('main', self.current['image']),
            ('a' * 40, 'ghcr.io/0x63616c/www-control-center-mini:latest'),
            ('a' * 40, 'ghcr.io/other/app@sha256:' + 'b' * 64),
        ):
            with self.subTest(image=image), self.assertRaises(ValueError):
                promotion.promote(self.current, revision, image)

    def test_unknown_fields_and_repository_are_rejected(self):
        for changes in ({'command': 'untrusted'}, {'sourceRepository': 'other/repo'}, {'schemaVersion': 1}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                promotion.validate({**self.current, **changes})


if __name__ == '__main__':
    unittest.main()
