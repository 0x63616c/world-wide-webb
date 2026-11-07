"""Trusted root-to-service command boundary for the pending update transaction."""
import os
from pathlib import Path
import pwd
import signal
import subprocess

COMMANDS = {
    'backup': 'homelab-backup-now',
    'reconcile': 'homelab-reconcile-all',
    'health': 'homelab-health',
}


def run_service(operation, lock_fd, timeout, system=Path('/run/current-system')):
    if os.geteuid() != 0:
        raise RuntimeError('Only the root updater may invoke service children')
    if operation not in COMMANDS:
        raise ValueError('Unapproved service operation')
    user = pwd.getpwnam('_containers')
    if (user.pw_uid, user.pw_gid, user.pw_dir) != (450, 450, '/var/lib/_containers'):
        raise RuntimeError('Service account differs from the reviewed identity')
    resolved = system.resolve(strict=True)
    if resolved.parent != Path('/nix/store'):
        raise ValueError('Service commands must come from a built Nix system')
    command = resolved / 'sw/bin' / COMMANDS[operation]
    env = {
        'HOME': user.pw_dir, 'USER': '_containers', 'LOGNAME': '_containers',
        'PATH': '/usr/bin:/bin:/usr/sbin:/sbin',
        'HOMELAB_OPERATION_FD': str(lock_fd),
    }
    process = subprocess.Popen([str(command)], env=env, cwd='/', user=450, group=450,
                               extra_groups=[450], umask=0o077, pass_fds=(lock_fd,),
                               start_new_session=True)
    try:
        result = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        # Stop the complete synchronous group while its leader is still unreaped,
        # so the group ID cannot be recycled before the signal. Interrupted
        # backups leave their persisted restart-required markers for inspection.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        raise
    if result:
        raise subprocess.CalledProcessError(result, str(command))
