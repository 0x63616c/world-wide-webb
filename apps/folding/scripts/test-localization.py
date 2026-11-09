#!/usr/bin/env python3
"""Regression checks for localization failures that must block a release."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE = importlib.util.spec_from_file_location('localization', Path(__file__).with_name('check-localization.py'))
localization = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(localization)


class LocalizationTests(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads((localization.ROOT / 'apps/ios/App/Localizable.xcstrings').read_text())
        self.sources = localization.source_strings(localization.ROOT / 'apps/ios/App')

    def test_current_catalog(self):
        localization.validate(self.catalog, self.sources)

    def test_missing_locale(self):
        del self.catalog['strings']['action.done']['localizations']['es-419']
        with self.assertRaisesRegex(ValueError, 'locale coverage'):
            localization.validate(self.catalog, self.sources)

    def test_changed_default(self):
        self.sources['action.done'] = 'Changed default'
        with self.assertRaisesRegex(ValueError, 'English default'):
            localization.validate(self.catalog, self.sources)

    def plural_fixture(self):
        self.sources['test.count'] = '%lld items'
        self.catalog['strings']['test.count'] = {
            'comment': 'Synthetic plural validation fixture',
            'localizations': {locale: {'variations': {'plural': {
                category: {'stringUnit': {'state': 'translated', 'value': '%lld items'}}
                for category in ('one', 'other')
            }}} for locale in localization.LOCALES},
        }
        return self.catalog['strings']['test.count']['localizations']

    def test_plural_placeholder_type(self):
        entry = self.plural_fixture()['de']
        entry['variations']['plural']['one']['stringUnit']['value'] = '%@ ausstehend'
        with self.assertRaisesRegex(ValueError, 'placeholder mismatch'):
            localization.validate(self.catalog, self.sources)

    def test_plural_missing_other(self):
        entry = self.plural_fixture()['ja']
        del entry['variations']['plural']['other']
        with self.assertRaisesRegex(ValueError, 'missing other'):
            localization.validate(self.catalog, self.sources)

    def test_duplicate_json_keys(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'):
            json.loads('{"en": 1, "en": 2}', object_pairs_hook=localization.unique_object)

    def test_missing_source_key(self):
        self.sources['new.key'] = 'New text'
        with self.assertRaisesRegex(ValueError, 'Key coverage'):
            localization.validate(self.catalog, self.sources)

    def test_new_interpolation_requires_type_review(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'View.swift').write_text('String(localized: "new.count", defaultValue: "Count: \\(count)")')
            with self.assertRaisesRegex(ValueError, 'unreviewed interpolation'):
                localization.source_strings(Path(directory))

    def test_conflicting_source_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'View.swift').write_text('String(localized: "key", defaultValue: "First")\nString(localized: "key", defaultValue: "Second")')
            with self.assertRaisesRegex(ValueError, 'conflicting English'):
                localization.source_strings(Path(directory))

    def test_positional_placeholders_reorder_without_type_loss(self):
        self.assertEqual(localization.placeholders('%@ %lld'), localization.placeholders('%2$lld %1$@'))
        self.assertNotEqual(localization.placeholders('%@ %lld'), localization.placeholders('%2$@ %1$lld'))
        self.assertEqual(localization.placeholders('100%%'), {})


if __name__ == '__main__':
    unittest.main()
