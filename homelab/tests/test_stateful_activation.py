import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

scripts = Path(__file__).parents[1] / 'scripts'
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location('stateful_activation', scripts / 'stateful-activation.py')
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


class StatefulActivationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.old = self.root / 'old'
        self.new = self.root / 'new'
        for p in [self.old, self.new]:
            (p / 'etc/homelab').mkdir(parents=True)
            (p / 'etc/homelab/deployment.json').write_text(json.dumps({'host':'example', 'services':['hindsight'], 'backupsEnabled':True}))
        self.events=[]

    def run_transaction(self, fail=None):
        def event(name):
            def call(*args):
                self.events.append(name)
                if name==fail:raise RuntimeError('injected failure')
            return call
        return activation.transaction(self.new,self.old,self.root,7,event('backup'),event('activation'),event('reconcile'))

    def test_backup_precedes_activation_and_success_follows_health(self):
        receipt=self.run_transaction()
        self.assertEqual(self.events,['backup','activation','reconcile'])
        self.assertEqual(receipt['phase'],'verified')
        self.assertFalse((self.root/'transaction').exists())
        self.assertEqual(json.loads((self.root/'last-success.json').read_text())['candidate'],str(self.new))

    def test_backup_activation_and_health_failures_retain_barrier_and_never_rollback(self):
        for phase,events in [('backup',['backup']),('activation',['backup','activation']),('reconcile',['backup','activation','reconcile'])]:
            with self.subTest(phase=phase):
                self.events=[]
                with self.assertRaisesRegex(RuntimeError,'injected'):
                    self.run_transaction(fail=phase)
                self.assertEqual(self.events,events)
                self.assertEqual(json.loads((self.root/'transaction').read_text())['phase'],phase)
                self.assertFalse((self.root/'last-success.json').exists())

    def test_removal_and_disabled_backups_fail_before_any_mutation(self):
        path=self.new/'etc/homelab/deployment.json'
        for services,backups in [([],True),(['hindsight'],False)]:
            path.write_text(json.dumps({'host':'example','services':services,'backupsEnabled':backups}))
            with self.assertRaises(ValueError):self.run_transaction()
            self.assertFalse((self.root/'transaction').exists())
            self.assertEqual(self.events,[])

    def test_empty_base_needs_no_service_backup_or_reconcile(self):
        for p in [self.old,self.new]:
            (p/'etc/homelab/deployment.json').write_text(json.dumps({'host':'example','services':[],'backupsEnabled':False}))
        self.run_transaction()
        self.assertEqual(self.events,['activation'])

    def test_direct_activation_and_unverified_boot_are_blocked(self):
        current=self.root/'current';current.mkdir()
        profile=self.root/'profile';profile.symlink_to(self.new)
        with self.assertRaisesRegex(RuntimeError,'Use homelab'):
            activation.guard(self.new,self.root,current,profile)
        current.rmdir()
        with self.assertRaises(FileNotFoundError):activation.guard(self.new,self.root,current,profile)
        (self.root/'last-success.json').write_text(json.dumps({'candidate':str(self.new),'phase':'verified'}))
        activation.guard(self.new,self.root,current,profile)
        with self.assertRaisesRegex(RuntimeError,'no verified'):
            activation.guard(self.old,self.root,current,profile)

    def test_current_generation_is_selected_after_acquiring_lock(self):
        current=self.root/'current'
        profile=self.root/'profile';profile.symlink_to(self.new)
        locked=False
        @contextlib.contextmanager
        def acquire(_root):
            nonlocal locked
            locked=True
            yield 7
            locked=False
        def resolve(path):
            if path==current:
                self.assertTrue(locked)
                return self.new
            return self.new
        with patch.object(sys,'argv',['activate','apply','--candidate',str(self.new)]), \
             patch.object(activation.os,'geteuid',return_value=0), \
             patch.object(activation.os,'setsid'), \
             patch.object(activation,'ROOT',self.root), \
             patch.object(activation,'CURRENT',current), \
             patch.object(activation,'PROFILE',profile), \
             patch.object(activation,'system_path',side_effect=resolve), \
             patch.object(activation.locks,'initialize'), \
             patch.object(activation.locks,'operation_lock',side_effect=acquire), \
             patch.object(activation,'transaction') as transaction:
            activation.main()
            self.assertEqual(transaction.call_args.args[1],self.new)

    def test_interrupted_transaction_cannot_be_bypassed_by_a_boot_receipt(self):
        current=self.root/'absent';profile=self.root/'profile';profile.symlink_to(self.new)
        (self.root/'transaction').write_text(json.dumps({'id':'expected','candidate':str(self.new)}))
        (self.root/'last-success.json').write_text(json.dumps({'candidate':str(self.new),'phase':'verified'}))
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaisesRegex(RuntimeError,'Interrupted'):
                activation.guard(self.new,self.root,current,profile)


if __name__=='__main__':unittest.main()
