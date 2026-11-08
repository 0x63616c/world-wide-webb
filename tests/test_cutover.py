import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

scripts = Path(__file__).parents[1] / 'scripts'
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location('cutover', scripts / 'cutover.py')
cutover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutover)


class CutoverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.destination = Path(self.temp.name) / 'snapshot'
        self.running = True
        self.restart = 'unless-stopped'
        self.commands = []

    def facts(self, docker, name):
        return {'running': self.running, 'image': 'sha256:' + 'a'*64,
                'restart': {'Name': self.restart},
                'mounts': [{'Destination': '/app/data'}, {'Destination': '/app/media'}]}

    def execute(self, command, **kwargs):
        self.commands.append(command)
        if 'update' in command: self.restart = 'no'
        if 'stop' in command: self.running = False
        if 'cp' in command:
            self.assertFalse(self.running)
            kwargs['stdout'].write(b'synthetic cold archive')

    def test_final_copy_disables_restart_and_leaves_source_stopped(self):
        with patch.object(cutover, 'facts', self.facts), patch.object(cutover, 'run', self.execute):
            receipt = cutover.cutover('control-center', self.destination, ['docker'])
        self.assertEqual(receipt['phase'], 'source-stopped')
        self.assertEqual(set(receipt['archives']), {'sqlite.tar', 'media.tar'})
        self.assertFalse(self.running)
        self.assertEqual(self.restart, 'no')
        self.assertTrue(all('start' not in c for c in self.commands))
        self.assertEqual((self.destination / 'sqlite.tar').stat().st_mode & 0o777, 0o600)

    def test_copy_failure_does_not_restart_or_mark_complete(self):
        def run(command, **kwargs):
            if 'cp' in command:raise OSError('disk full')
            return self.execute(command, **kwargs)
        with patch.object(cutover, 'facts', self.facts), patch.object(cutover, 'run', run):
            with self.assertRaisesRegex(OSError, 'disk full'):
                cutover.cutover('control-center', self.destination, ['docker'])
        self.assertFalse(self.running)
        self.assertNotIn('source-stopped', (self.destination / 'cutover.json').read_text())
        self.assertFalse(any('start' in c for c in self.commands))

    def test_stop_timeout_preserves_inspection_journal_without_copy(self):
        def run(command, **kwargs):
            if 'stop' in command:raise cutover.subprocess.TimeoutExpired(command, 180)
            return self.execute(command, **kwargs)
        with patch.object(cutover, 'facts', self.facts), patch.object(cutover, 'run', run):
            with self.assertRaises(cutover.subprocess.TimeoutExpired):
                cutover.cutover('control-center', self.destination, ['docker'])
        self.assertFalse(any('cp' in c for c in self.commands))
        self.assertEqual(self.restart, 'no')
        self.assertTrue((self.destination / 'cutover.json').exists())

    def test_preflight_failure_and_existing_attempt_never_mutate_source(self):
        self.running = False
        with patch.object(cutover, 'facts', self.facts), patch.object(cutover, 'run', self.execute):
            with self.assertRaisesRegex(RuntimeError, 'initially running'):
                cutover.cutover('control-center', self.destination, ['docker'])
            with self.assertRaisesRegex(ValueError, 'new cutover'):
                cutover.cutover('control-center', self.destination, ['docker'])
        self.assertEqual(self.commands, [])


if __name__ == '__main__':unittest.main()
