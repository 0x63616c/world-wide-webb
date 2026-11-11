#!/usr/bin/env python3
"""Recover a services guest that Colima reports Running but cannot finish booting."""
import importlib.util
import subprocess
import sys
import time
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('operation_lock', Path(__file__).with_name('operation-lock.py'))
operation = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(operation)

STARTUP_SECONDS = 180


def recovery_lock():
    return operation.operation_lock()


def run(command, seconds=10, lock_fd=None):
    # GNU timeout bounds the complete probe group, including colima -> limactl -> ssh.
    return subprocess.run(
        ['timeout', '--signal=KILL', str(seconds), *command],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
        pass_fds=() if lock_fd is None else (lock_fd,),
    ).returncode == 0


def stop_launcher(child):
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()


def supervise(arguments):
    child = subprocess.Popen(['colima', 'start', '--profile', 'services', '--foreground', *arguments])
    deadline = time.monotonic() + STARTUP_SECONDS
    previous = None
    while not run(['docker', 'info']):
        if time.monotonic() < deadline:
            time.sleep(5)
            continue
        try:
            with recovery_lock() as fd:
                # A backup, deployment or maintenance hold may have delayed recovery.
                # Recheck under the shared lock before touching the VM.
                if run(['docker', 'info']):
                    break
                if run(['colima', 'ssh', '--profile', 'services', '--', 'true']):
                    message = 'Services guest responds; Docker is unavailable. Leaving the VM running.'
                else:
                    print('Services guest failed to boot; restarting it under the operation lock.', flush=True)
                    stop_launcher(child)
                    if not run(['colima', 'stop', '--profile', 'services', '--force'], seconds=60, lock_fd=fd):
                        print('Could not stop the services VM; launchd will retry.', file=sys.stderr, flush=True)
                    # launchd retries the same declared start command. Never delete/recreate disks.
                    return 1
        except operation.OperationDeferred as error:
            message = f'Services VM recovery deferred: {error}'
        if message != previous:
            print(message, file=sys.stderr, flush=True)
            previous = message
        time.sleep(30)
    print('Services VM Docker is ready.', flush=True)
    return child.wait()


if __name__ == '__main__':
    raise SystemExit(supervise(sys.argv[1:]))
