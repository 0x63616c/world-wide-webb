"""Run inside the existing Hindsight container; credentials never leave it."""
import json
import os
from pathlib import Path
import sys


def command(metadata, operation):
    binary = Path(metadata['installation_dir']) / metadata['version'] / 'bin'
    if operation == 'dump':
        return [str(binary / 'pg_dump'), '-h', '127.0.0.1', '-p', str(metadata['port']),
                '-U', metadata['username'], '-d', metadata['database'], '-Fc']
    if operation == 'verify':
        return [str(binary / 'pg_restore'), '-l']
    if operation == 'banks':
        return [str(binary / 'psql'), '-h', '127.0.0.1', '-p', str(metadata['port']),
                '-U', metadata['username'], '-d', metadata['database'], '-At', '-c',
                "select coalesce(json_agg(bank_id order by bank_id), '[]'::json) from banks"]
    raise ValueError('Unknown PostgreSQL backup operation')


def main():
    metadata = json.loads(Path('/home/hindsight/.pg0/instances/hindsight/instance.json').read_text())
    args = command(metadata, sys.argv[1])
    env = dict(os.environ, PGPASSWORD=metadata['password'])
    os.execve(args[0], args, env)


if __name__ == '__main__':
    main()
