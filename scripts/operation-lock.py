#!/usr/bin/env python3
"""One host-wide lock and persistent maintenance hold for stateful operations."""
import argparse
from contextlib import contextmanager
import fcntl
import os
from pathlib import Path
import stat
import subprocess
import importlib.util

spec = importlib.util.spec_from_file_location('durable', Path(__file__).with_name('durable.py'))
durable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(durable)

ROOT = Path('/var/lib/homelab-operations')


class OperationDeferred(Exception):
    pass


def validate_directory(root, owner=0):
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
        raise RuntimeError('Operation directory must be root-owned and not writable by services')


def initialize(root=ROOT):
    if os.geteuid() != 0:
        raise RuntimeError('Only root may initialize operation state')
    root.mkdir(mode=0o755, exist_ok=True)
    validate_directory(root)
    root.chmod(0o755)
    fd = os.open(root / 'operation.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o660)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1:
            raise RuntimeError('Unsafe operation lock file')
        # Preserve the inode: activation must not break a lock held by another job.
        os.fchown(fd, 0, 350)
        os.fchmod(fd, 0o660)
        os.fsync(fd)
    finally:
        os.close(fd)
    durable.sync_directory(root)
    durable.sync_directory(root.parent)


@contextmanager
def operation_lock(root=ROOT, owner=0, inherited_fd=None):
    validate_directory(root, owner)
    reference = os.open(root / 'operation.lock', os.O_RDWR | os.O_NOFOLLOW)
    fd = reference
    try:
        if inherited_fd is not None:
            inherited = os.fstat(inherited_fd)
            expected = os.fstat(reference)
            if (inherited.st_dev, inherited.st_ino) != (expected.st_dev, expected.st_ino):
                raise RuntimeError('Inherited descriptor is not the host operation lock')
            fd = os.dup(inherited_fd)
            os.close(reference)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != owner or info.st_nlink != 1 or info.st_mode & 0o007:
            raise RuntimeError('Unsafe operation lock file')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise OperationDeferred('Another stateful operation is running') from error
        # Check under the lock, including when a hold was added while waiting.
        if (root / 'hold').exists():
            raise OperationDeferred('Maintenance hold is set')
        if inherited_fd is None and (root / 'transaction').exists():
            raise OperationDeferred('Interrupted or active deployment transaction requires its inherited lock')
        yield fd
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--initialize', action='store_true')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.initialize:
        if args.command:
            parser.error('Initialization does not execute commands')
        initialize()
        return
    command = args.command
    if command[:1] == ['--']:
        command = command[1:]
    if not command:
        parser.error('Specify a command after --')
    try:
        inherited = os.environ.get('HOMELAB_OPERATION_FD')
        if inherited is not None and (not inherited.isdecimal() or int(inherited) < 3):
            raise RuntimeError('Invalid inherited operation descriptor')
        with operation_lock(inherited_fd=int(inherited) if inherited is not None else None) as fd:
            # The child retains the lock if this supervisor is terminated.
            env = dict(os.environ, HOMELAB_OPERATION_FD=str(fd))
            result = subprocess.run(command, pass_fds=(fd,), env=env, check=False)
            raise SystemExit(result.returncode)
    except OperationDeferred as error:
        print(str(error))
        raise SystemExit(75)


if __name__ == '__main__':
    main()
