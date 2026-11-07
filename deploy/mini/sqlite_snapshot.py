"""Consistent SQLite backups shared by nightly and cutover workflows."""
import sqlite3


def sqlite_snapshot(source, destination):
    """SQLite backup API includes committed WAL data; never overwrite a backup."""
    if not source.is_file():
        raise FileNotFoundError('SQLite source does not exist')
    destination.touch(exist_ok=False, mode=0o600)
    # The SQLite URI escapes paths containing question marks or percent signs.
    with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as src:
        with sqlite3.connect(destination) as target:
            src.backup(target)
            if target.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                raise RuntimeError('SQLite backup integrity check failed')
            if target.execute('PRAGMA foreign_key_check').fetchone() is not None:
                raise RuntimeError('SQLite backup foreign key check failed')



if __name__ == '__main__':
    from pathlib import Path
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    sqlite_snapshot(args.source, args.destination)
