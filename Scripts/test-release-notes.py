import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET

from release_notes import add_release_notes, release_notes


class ReleaseNotesTests(unittest.TestCase):
    def setUp(self):
        self.original = Path.cwd()
        self.temp = tempfile.TemporaryDirectory()
        os.chdir(self.temp.name)
        self.addCleanup(self.restore)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Release notes test')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        self.git('config', 'tag.gpgsign', 'false')

    def restore(self):
        os.chdir(self.original)
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', *args], text=True).strip()

    def commit(self, message, tag=None):
        self.git('commit', '-q', '--allow-empty', '-m', message)
        if tag:
            self.git('tag', tag)

    def test_skipped_releases_are_grouped_newest_first_without_duplicate_commits(self):
        self.commit('First release', 'v1.0.4')
        self.commit('Improve recording', 'v1.0.5')
        self.commit('Show release notes')
        notes = release_notes('1.0.6')
        self.assertLess(notes.index('data-sparkle-version="6"'), notes.index('data-sparkle-version="5"'))
        self.assertLess(notes.index('data-sparkle-version="5"'), notes.index('data-sparkle-version="4"'))
        for subject in ('First release', 'Improve recording', 'Show release notes'):
            self.assertEqual(notes.count(f'<li>{subject}</li>'), 1)
        self.git('tag', 'v1.0.6')
        self.assertEqual(release_notes('1.0.6'), notes)  # Idempotent release retries.

    def test_commit_subjects_are_escaped_as_text(self):
        self.commit('<script>alert("unsafe")</script> & a fix', 'v1.0.4')
        notes = release_notes('1.0.5')
        self.assertNotIn('<script>', notes)
        self.assertIn('&lt;script&gt;', notes)
        self.assertIn('&amp; a fix', notes)

    def test_unrelated_tags_are_ignored(self):
        self.commit('Initial', 'v1.0.4')
        initial = self.git('rev-parse', 'HEAD')
        self.commit('Other branch change', 'v1.0.5')
        self.git('checkout', '-q', '--detach', initial)
        self.commit('Main change')
        notes = release_notes('1.0.6')
        self.assertNotIn('Other branch change', notes)
        self.assertNotIn('data-sparkle-version="5"', notes)
        self.assertIn('Main change', notes)

    def test_embedding_preserves_archive_signature_and_html(self):
        self.commit('Fix A & B', 'v1.0.4')
        notes = release_notes('1.0.5')
        feed = Path('appcast.xml')
        feed.write_text('<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><item><sparkle:version>5</sparkle:version><enclosure url="https://example.invalid/Callkeep.zip" length="123" sparkle:edSignature="archive-signature"/></item></channel></rss>')
        before = ET.parse(feed).find('channel/item/enclosure').attrib.copy()
        add_release_notes(feed, notes)
        after = ET.parse(feed)
        self.assertEqual(after.find('channel/item/enclosure').attrib, before)
        self.assertEqual(after.findtext('channel/item/description'), notes)
        self.assertEqual(after.findtext('channel/item/{http://www.andymatuschak.org/xml-namespaces/sparkle}version'), '5')


if __name__ == '__main__':
    unittest.main()
