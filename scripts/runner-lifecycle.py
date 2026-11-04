"""Single-host disposable VM lifecycle; not a scheduler or registration broker.

Only trusted controller code may call this module. Host enablement remains
blocked pending attested admission, storage limits and guest transport.
"""
from contextlib import contextmanager
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import stat
import signal
import subprocess
import uuid

spec = importlib.util.spec_from_file_location('runner_policy', Path(__file__).with_name('runner-policy.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def private_directory(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Runner state directory must be private and owned by the controller')
    return path


class Tart:
    slot_fd = None
    def __init__(self, binary, home, tart_home, helper_path):
        if not Path(binary).is_absolute() or not Path(helper_path).is_absolute():
            raise ValueError('Use absolute, reviewed executable paths')
        self.binary = str(binary)
        self.env = {
            'HOME': str(private_directory(home)),
            'TART_HOME': str(private_directory(tart_home)),
            'PATH': str(helper_path) + ':/usr/bin:/bin:/usr/sbin:/sbin',
            'TART_NO_AUTO_PRUNE': '1',
        }

    def command(self, *args, timeout=60):
        return subprocess.run([self.binary, *args], env=self.env, check=True,
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, timeout=timeout,
                              pass_fds=(self.slot_fd,) if self.slot_fd is not None else ())

    def inventory(self):
        rows = json.loads(self.command('list', '--source', 'local', '--format', 'json').stdout)
        if not isinstance(rows, list):
            raise ValueError('Invalid Tart inventory')
        result = {}
        for row in rows:
            name, state = row['Name'], row['State']
            if not isinstance(name, str) or name in result or state not in ('running', 'stopped', 'suspended'):
                raise ValueError('Invalid or ambiguous Tart inventory')
            result[name] = state
        return result

    def clone(self, image, name, budget):
        self.command('clone', image, name, timeout=1800)
        self.command('set', name, '--cpu', str(budget['cpu']), '--memory',
                     str(budget['memoryMiB']), '--random-mac')

    def start(self, name):
        return subprocess.Popen([self.binary, *policy.run_arguments(name)[1:]],
                                env=self.env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                start_new_session=True, pass_fds=(self.slot_fd,))

    def finish(self, process):
        # Stop even a Tart process which has not yet registered a running VM.
        # Retain the journal if it cannot be reaped; never race deletion/startup.
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGINT)
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=45)

    def stop(self, name):
        self.command('stop', name, '--timeout', '15', timeout=45)

    def delete(self, name):
        self.command('delete', name, timeout=120)


class Lifecycle:
    def __init__(self, directory, backend):
        self.directory = private_directory(directory)
        self.journal = self.directory / 'active.json'
        self.backend = backend

    def sync(self):
        fd = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def record(self, name):
        # O_EXCL prevents replacing an unresolved job or following a symlink.
        fd = os.open(self.journal, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump({'schema': 1, 'name': name}, stream)
            stream.flush()
            os.fsync(stream.fileno())
        self.sync()

    def recorded_name(self):
        try:
            fd = os.open(self.journal, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            return None
        with os.fdopen(fd) as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError('Unsafe runner journal')
            if info.st_size > 1024:
                raise ValueError('Oversized runner journal')
            data = json.load(stream)
        if not isinstance(data, dict) or set(data) != {'schema', 'name'} or data['schema'] != 1:
            raise ValueError('Invalid runner journal')
        policy.run_arguments(data['name'])
        return data['name']

    def recover(self):
        """Called with the slot held; preserve evidence if cleanup cannot finish."""
        name = self.recorded_name()
        inventory = self.backend.inventory()
        # A dedicated TART_HOME may contain cached OCI bases, but no local VMs
        # except the journaled job. Never delete an unknown VM by name prefix.
        if set(inventory) - ({name} if name else set()):
            raise RuntimeError('Unjournaled local VM: manual review required')
        if name is None:
            return
        if name in inventory:
            if inventory[name] != 'stopped':
                self.backend.stop(name)
            after_stop = self.backend.inventory()
            if after_stop.get(name) not in (None, 'stopped'):
                raise RuntimeError('VM has not stopped; retain journal')
            if name in after_stop:
                self.backend.delete(name)
            if name in self.backend.inventory():
                raise RuntimeError('VM deletion incomplete; retain journal')
        self.journal.unlink()
        self.sync()

    @contextmanager
    def slot(self):
        fd = os.open(self.directory / 'slot.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        previous_fd = getattr(self.backend, 'slot_fd', None)
        acquired = False
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError('Unsafe runner lock')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
            self.backend.slot_fd = fd
            self.recover()
            yield
        finally:
            if acquired:
                self.backend.slot_fd = previous_fd
            os.close(fd)

    @contextmanager
    def guest(self, **admission):
        """Hold the slot through cleanup, including cancellation by the caller.

        Yielding means the VM process launched, not that guest boot, networking
        or runner registration succeeded. The future controller must check those.
        """
        with self.slot():
            budget = policy.admit(**admission)
            name = 'homelab-job-' + uuid.uuid4().hex
            self.record(name)
            process = None
            try:
                self.backend.clone(admission['image'], name, budget)
                process = self.backend.start(name)
                yield name, process
            finally:
                if process is not None:
                    self.backend.finish(process)
                self.recover()
