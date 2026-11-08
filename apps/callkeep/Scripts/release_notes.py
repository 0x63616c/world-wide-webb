"""Build cumulative Sparkle HTML notes from the same tags used by release CI."""
import html
import re
import subprocess
import xml.etree.ElementTree as ET


def add_release_notes(feed, notes):
    document = ET.parse(feed)
    item = document.find('channel/item')
    if item is None:
        raise ValueError('Appcast contains no update')
    sparkle = 'http://www.andymatuschak.org/xml-namespaces/sparkle'
    ET.SubElement(item, 'description').text = notes
    ET.SubElement(item, '{' + sparkle + '}fullReleaseNotesLink').text = 'https://github.com/0x63616c/callkeep/releases'
    ET.register_namespace('sparkle', sparkle)
    document.write(feed, encoding='utf-8', xml_declaration=True)
    assert ET.parse(feed).findtext('channel/item/description') == notes, 'Release notes did not survive XML encoding'


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def release_notes(version, revision="HEAD"):
    match = re.fullmatch(r"1\.0\.(\d+)", version)
    if not match:
        raise ValueError("Expected a Callkeep release counter (1.0.N)")
    counter = int(match[1])
    releases = []
    for tag in git("tag", "--list", "v1.0.*").splitlines():
        found = re.fullmatch(r"v1\.0\.(\d+)", tag)
        if not found or int(found[1]) >= counter:
            continue
        # Ignore tags from branches that are not part of this release.
        ancestor = subprocess.run(["git", "merge-base", "--is-ancestor", tag, revision], check=False)
        if ancestor.returncode == 1:
            continue
        ancestor.check_returncode()
        releases.append((int(found[1]), tag))
    releases.sort()
    releases.append((counter, revision))
    sections = []
    previous = None
    for build, ref in releases:
        changes = git("log", "--no-merges", "--reverse", "--format=%s", f"{previous}..{ref}" if previous else ref).splitlines()
        items = "".join(f"<li>{html.escape(subject)}</li>" for subject in changes)
        if not items:
            items = "<li>Maintenance update.</li>"
        sections.append(f'<section data-sparkle-version="{build}"><h2>Build {build} (1.0.{build})</h2><ul>{items}</ul></section>')
        previous = ref
    # Sparkle marks the installed CFBundleVersion, so its own notes and older
    # siblings disappear while all skipped newer releases remain visible.
    return """<!doctype html><html><head><meta charset="utf-8">
<meta name="color-scheme" content="light dark"><style>
body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; color: CanvasText; background: Canvas; margin: 0; padding: 16px; }
section { margin-bottom: 24px; } h2 { font-size: 15px; margin: 0 0 8px; }
ul { margin: 0; padding-left: 20px; } li { margin: 6px 0; }
section.sparkle-installed-version, section.sparkle-installed-version ~ section { display: none; }
</style></head><body>""" + "".join(reversed(sections)) + "</body></html>"
