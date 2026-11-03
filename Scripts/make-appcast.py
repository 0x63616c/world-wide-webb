#!/usr/bin/env python3
"""Sign the exact notarized release archive and produce a validated Sparkle feed."""
import os
import plistlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

version, archive_name = sys.argv[1:]
archive = Path(archive_name).resolve()
with zipfile.ZipFile(archive) as zipped:
    metadata = plistlib.loads(zipped.read('Callkeep.app/Contents/Info.plist'))
expected = plistlib.loads(Path('Resources/Info.plist').read_bytes())
assert metadata['SUPublicEDKey'] == expected['SUPublicEDKey'], 'Archive contains the wrong update public key'
assert metadata['SUFeedURL'] == expected['SUFeedURL'], 'Archive contains the wrong update feed'
tools = list(Path('build/SourcePackages/artifacts').glob('*/Sparkle/bin/generate_appcast'))
if len(tools) != 1:
    raise SystemExit('Expected one resolved Sparkle appcast generator')
generator = tools[0].resolve()
secret = os.environ.get('SPARKLE_PRIVATE_KEY')
if not secret:
    raise SystemExit('Missing Sparkle update-signing secret')
with tempfile.TemporaryDirectory(prefix='callkeep-appcast-') as directory:
    work = Path(directory)
    key = work / 'signing.key'
    key.write_text(secret)
    key.chmod(0o600)
    updates = work / 'updates'
    updates.mkdir()
    shutil.copy2(archive, updates / archive.name)
    prefix = f'https://github.com/0x63616c/callkeep/releases/download/v{version}/'
    subprocess.run([
        str(generator), '--ed-key-file', str(key), '--download-url-prefix', prefix,
        '--maximum-deltas', '0', '--maximum-versions', '1',
        '--link', 'https://github.com/0x63616c/callkeep', str(updates),
    ], check=True)
    feed = updates / 'appcast.xml'
    item = ET.parse(feed).find('channel/item')
    sparkle = '{http://www.andymatuschak.org/xml-namespaces/sparkle}'
    assert item is not None, 'Appcast contains no update'
    assert item.findtext(sparkle + 'version') == version.split('.')[-1], 'Wrong build counter'
    assert item.findtext(sparkle + 'shortVersionString') == version, 'Wrong release version'
    enclosure = item.find('enclosure')
    assert enclosure is not None and enclosure.get('url') == prefix + archive.name, 'Wrong archive URL'
    assert int(enclosure.get('length', '0')) == archive.stat().st_size, 'Wrong archive size'
    signature = enclosure.get(sparkle + 'edSignature')
    assert signature, 'Update archive must be EdDSA signed'
    subprocess.run([str(generator.parent / 'sign_update'), '--verify', '--ed-key-file', str(key), str(archive), signature], check=True)
    shutil.copy2(feed, 'appcast.xml')
print('Sparkle appcast and release archive signature verified.')
