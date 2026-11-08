#!/usr/bin/env python3
"""Validate the app's explicit semantic-key String Catalog (no third-party dependencies)."""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
LOCALES = {'en', 'de', 'fr', 'es', 'es-419', 'ja', 'ko', 'pt-BR', 'zh-Hans', 'zh-Hant'}
# Explicit typed interpolation mapping: reject any new interpolation until its format is reviewed.
INTERPOLATIONS = {
    'results.percentile': (r'\(percentile)%', '%lld%%'),
    'leaderboard.pending': (r'\(value.pendingFolds)', '%lld'),
    'leaderboard.periodTimezone': (r'\(periodTitle)', '%@'),
}
LITERAL = r'"((?:[^"\\]|\\.)*)"'
SOURCE_PATTERN = re.compile(
    r'(?:String\(\s*localized:\s*|LocalizedStringResource\(\s*)' + LITERAL
    + r'\s*,\s*defaultValue:\s*' + LITERAL, re.S)
FORMAT = re.compile(r'%(?:(\d+)\$)?(lld|llu|ld|lu|d|u|f|g|@)')


def source_strings(directory: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    paths = list(directory.rglob('*.swift'))
    if directory == ROOT / 'apps/ios/App':
        paths += list((ROOT / 'apps/ios/Widgets').rglob('*.swift'))
    for path in sorted(paths):
        for match in SOURCE_PATTERN.finditer(path.read_text()):
            key, value = match.groups()
            if key in INTERPOLATIONS:
                swift, printf = INTERPOLATIONS[key]
                value = value.replace(swift, printf)
            if '\\(' in value:
                raise ValueError(f'{path}: {key}: unreviewed interpolation')
            value = value.replace(r'\"', '"').replace(r'\n', '\n').replace(r'\\', '\\')
            if key in result and result[key] != value:
                raise ValueError(f'{path}: {key}: conflicting English defaults')
            result[key] = value
    if not result:
        raise ValueError('No source strings found')
    return result


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f'Duplicate JSON key: {key}')
        value[key] = item
    return value


def placeholders(value: str) -> Counter:
    clean = value.replace('%%', '')
    matches = list(FORMAT.finditer(clean))
    if '%' in FORMAT.sub('', clean):
        raise ValueError(f'Unrecognized format placeholder: {value}')
    return Counter((int(m.group(1) or index), m.group(2))
                   for index, m in enumerate(matches, 1))


def units(localization: dict, key: str, locale: str) -> list[str]:
    if set(localization) == {'stringUnit'}:
        unit = localization['stringUnit']
        if unit.get('state') != 'translated' or not isinstance(unit.get('value'), str) or not unit['value'].strip():
            raise ValueError(f'{key}/{locale}: empty or incomplete string')
        return [unit['value']]
    if set(localization) != {'variations'} or set(localization['variations']) != {'plural'}:
        raise ValueError(f'{key}/{locale}: unsupported catalog structure')
    variants = localization['variations']['plural']
    if 'other' not in variants:
        raise ValueError(f'{key}/{locale}: plural missing other')
    if locale not in {'ja', 'ko', 'zh-Hans', 'zh-Hant'} and 'one' not in variants:
        raise ValueError(f'{key}/{locale}: plural missing one')
    if set(variants) - {'zero', 'one', 'two', 'few', 'many', 'other'}:
        raise ValueError(f'{key}/{locale}: invalid plural category')
    return [value for item in variants.values() for value in units(item, key, locale)]


def validate(catalog: dict, sources: dict[str, str]) -> None:
    if catalog.get('sourceLanguage') != 'en' or catalog.get('version') != '1.0':
        raise ValueError('Expected English String Catalog version 1.0')
    strings = catalog['strings']
    if set(sources) != set(strings):
        raise ValueError(f'Key coverage: missing={sorted(set(sources) - set(strings))}; stale={sorted(set(strings) - set(sources))}')
    for key, default in sources.items():
        entry = strings[key]
        if not entry.get('comment', '').strip():
            raise ValueError(f'{key}: missing translator context')
        localizations = entry['localizations']
        if set(localizations) != LOCALES:
            raise ValueError(f'{key}: incorrect locale coverage')
        english = localizations['en']
        if 'variations' in english:
            english = english['variations']['plural']['other']
        if english['stringUnit']['value'] != default:
            raise ValueError(f'{key}: English default differs from source')
        expected = placeholders(default)
        for locale, localization in localizations.items():
            for value in units(localization, key, locale):
                if placeholders(value) != expected:
                    raise ValueError(f'{key}/{locale}: placeholder mismatch')
                if '\\(' in value:
                    raise ValueError(f'{key}/{locale}: uncompiled Swift interpolation')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, default=ROOT / 'apps/ios/App/Localizable.xcstrings')
    parser.add_argument('--sources', type=Path, default=ROOT / 'apps/ios/App')
    args = parser.parse_args()
    try:
        catalog = json.loads(args.catalog.read_text(), object_pairs_hook=unique_object)
        sources = source_strings(args.sources)
        validate(catalog, sources)
    except (ValueError, KeyError, OSError, TypeError) as error:
        print(f'Localization check failed: {error}', file=sys.stderr)
        return 1
    print(f'Localization passed: {len(sources)} semantic keys × {len(LOCALES)} locales.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
