#!/usr/bin/env bash
# Assemble only explicitly public static roots into an empty output directory.
set -euo pipefail
cd "$(dirname "$0")/.."
out=${1:?usage: build-site.sh <empty-output-directory>}
python3 - "$out" << 'PYTHON'
from pathlib import Path
import re, shutil, sys
source = Path('sites')
out = Path(sys.argv[1]).resolve()
if out == source.resolve() or source.resolve() in out.parents:
    raise SystemExit('Output must stay outside site sources')
out.mkdir(parents=True, exist_ok=True)
if any(out.iterdir()):
    raise SystemExit('Output directory must be empty')
names = [line.strip() for line in (source / '.pages').read_text().splitlines()
         if line.strip() and not line.lstrip().startswith('#')]
allowed = {'.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
           '.ico', '.woff', '.woff2', '.ttf', '.txt', '.xml', '.webmanifest'}

def copy_public(path, destination):
    if path.is_symlink():
        raise SystemExit('Public site inputs must be regular files/directories')
    if path.is_dir():
        destination.mkdir(parents=True, exist_ok=True)
        for child in path.iterdir():
            copy_public(child, destination / child.name)
    elif path.is_file() and path.suffix.lower() in allowed and not path.name.startswith('.'):
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
    else:
        raise SystemExit('Unexpected nonpublic input in a published static site')

for name in names:
    if not re.fullmatch(r'[a-z][a-z0-9-]*', name) or not (source / name / 'index.html').is_file():
        raise SystemExit('Invalid public static site root')
    copy_public(source / name, out / name)
if (source / 'index.html').is_file():
    copy_public(source / 'index.html', out / 'index.html')
if (source / '.legacy-root').exists():
    legacy = (source / '.legacy-root').read_text().strip()
    if legacy not in names:
        raise SystemExit('Legacy root must name an explicitly public site')
    for path in (source / legacy).iterdir():
        copy_public(path, out / path.name)
(out / '.nojekyll').touch()
PYTHON
