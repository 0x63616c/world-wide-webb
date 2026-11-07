#!/usr/bin/env python3
"""Offline migration of a restored PostgreSQL snapshot. Never connects to production.

Private exports/archives contain user data. Output is aggregate counts only.
The target must be an empty database initialized by the Rust migrator.
"""
import argparse
import datetime as dt
from decimal import Decimal
import hashlib
import json
import os
import re
from pathlib import Path
import sqlite3
import subprocess
import sys

ARCHIVE_ONLY = {('public', 'wake_photo'), ('drizzle', '__drizzle_migrations')}


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def export_snapshot(args):
    if not args.host.startswith('/'):
        raise ValueError('Only a local Unix socket for an isolated restored database is allowed')
    sql = r"""
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SELECT json_build_object('kind','columns','schema',table_schema,'table',table_name,
 'columns',json_agg(json_build_object('name',column_name,'type',data_type) ORDER BY ordinal_position))
 FROM information_schema.columns
 WHERE table_schema NOT IN ('information_schema','pg_catalog')
 AND table_name IN (SELECT table_name FROM information_schema.tables t WHERE t.table_schema=columns.table_schema AND t.table_type='BASE TABLE')
 GROUP BY table_schema,table_name ORDER BY table_schema,table_name;
SELECT format('SELECT json_build_object(''kind'',''row'',''schema'',%L,''table'',%L,''value'',to_jsonb(t)) FROM %I.%I t;',schemaname,tablename,schemaname,tablename)
 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename
\gexec
SELECT format('SELECT json_build_object(''kind'',''sequence'',''schema'',%L,''name'',%L,''last_value'',last_value,''is_called'',is_called) FROM %I.%I;',schemaname,sequencename,schemaname,sequencename)
 FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,sequencename
\gexec
SELECT json_build_object('kind','complete');
COMMIT;
"""
    output = Path(args.output)
    fd = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            result = subprocess.run([args.psql, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                                     '-h', args.host, '-p', str(args.port), '-d', args.database],
                                    input=sql.encode(), stdout=stream, stderr=subprocess.PIPE)
        if result.returncode:
            raise RuntimeError('Snapshot export failed; private partial file retained for investigation')
    except BaseException:
        raise
    print(json.dumps({'export_bytes': output.stat().st_size, 'sha256': file_hash(output)}))


def file_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def canonical_json(value):
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError('Non-finite JSON number')
        return str(value)
    if isinstance(value, dict):
        return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + canonical_json(v) for k, v in sorted(value.items())) + '}'
    if isinstance(value, list):
        return '[' + ','.join(map(canonical_json, value)) + ']'
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def convert(value, kind):
    if value is None:
        return None
    if kind in ('timestamp with time zone', 'timestamp without time zone'):
        if kind == 'timestamp without time zone':
            raise ValueError('Naive timestamp needs explicit timezone mapping')
        normalized = value.replace('Z', '+00:00')
        normalized = re.sub(r'(\.\d{1,6})(?=[+-]\d{2}:\d{2}$)', lambda match: match[0].ljust(7, '0'), normalized)
        t = dt.datetime.fromisoformat(normalized)
        if t.tzinfo is None:
            raise ValueError('Missing timezone')
        return t.astimezone(dt.timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')
    if kind in ('json', 'jsonb'):
        return canonical_json(value)
    if kind == 'boolean':
        if not isinstance(value, bool):
            raise ValueError('Invalid boolean')
        return int(value)
    if kind in ('integer', 'smallint', 'bigint'):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError('Invalid integer')
        if not -(2**63) <= value < 2**63:
            raise ValueError('Integer outside SQLite range')
        return value
    if kind in ('text', 'character varying', 'uuid', 'date'):
        if not isinstance(value, str):
            raise ValueError('Invalid string')
        return value
    raise ValueError('Unmapped PostgreSQL type; explicit lossless mapping required')


def import_snapshot(export, target, archive):
    """All target inserts and verification are one transaction. Existing target rows are rejected."""
    if not Path(target).is_file():
        raise ValueError('Initialize the target with the server migrator first')
    if Path(archive).exists():
        raise ValueError('Archive already exists; never overwrite migration evidence')
    fd = os.open(archive, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    db = sqlite3.connect(target)
    db.execute('PRAGMA foreign_keys=ON')
    raw = sqlite3.connect(archive)
    raw.execute('CREATE TABLE source_record (ordinal INTEGER PRIMARY KEY, envelope TEXT NOT NULL, sha256 TEXT NOT NULL)')
    raw.execute('CREATE TABLE evidence (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    columns, counts, checks = {}, {}, {}
    source_digest = hashlib.sha256()
    imported = {}
    sequence = None
    complete = False
    try:
        db.execute('BEGIN IMMEDIATE')
        raw.execute('BEGIN')
        with open(export, 'rb') as stream:
            for ordinal, line in enumerate(stream, 1):
                source_digest.update(line)
                # Store the original JSON before interpretation; preserves exact numeric tokens and all metadata.
                envelope = line.decode('utf-8').rstrip('\r\n')
                raw.execute('INSERT INTO source_record VALUES(?,?,?)',
                            (ordinal, envelope, hashlib.sha256(line).hexdigest()))
                if complete:
                    raise ValueError('Records after completion marker')
                item = json.loads(envelope, parse_float=Decimal)
                kind = item['kind']
                if kind == 'complete':
                    complete = True
                    continue
                if kind == 'sequence':
                    if item['schema'] == 'public' and item['name'] == 'notification_revision':
                        sequence = item['last_value']
                    continue
                key = (item['schema'], item['table'])
                if kind == 'columns':
                    if key in columns:
                        raise ValueError('Duplicate table metadata')
                    columns[key] = item['columns']
                    counts[key] = 0
                    if key in ARCHIVE_ONLY or item['table'] == '__drizzle_migrations':
                        continue
                    if item['schema'] != 'public':
                        raise ValueError('Unexpected source schema requires explicit disposition')
                    info = db.execute('PRAGMA table_info(' + quoted(item['table']) + ')').fetchall()
                    names = [c['name'] for c in item['columns']]
                    if {r[1] for r in info} != set(names):
                        raise ValueError('Target/source columns differ for ' + item['table'])
                    if db.execute('SELECT count(*) FROM ' + quoted(item['table'])).fetchone()[0]:
                        raise ValueError('Target is not empty: ' + item['table'])
                    # A semantic digest in original source order is verified by primary key for each insert.
                    pk = [r[1] for r in sorted(info, key=lambda r: r[5]) if r[5]]
                    if not pk:
                        raise ValueError('Target requires a primary key for reconciliation')
                    imported[key] = (names, pk)
                    checks[key] = hashlib.sha256()
                    continue
                if kind != 'row' or key not in columns:
                    raise ValueError('Invalid record or missing metadata')
                counts[key] += 1
                if key not in imported:
                    continue
                names, pk = imported[key]
                values = [convert(item['value'][c['name']], c['type']) for c in columns[key]]
                table = quoted(item['table'])
                db.execute('INSERT INTO ' + table + '(' + ','.join(map(quoted, names)) + ') VALUES (' + ','.join('?' for _ in names) + ')', values)
                returned = db.execute('SELECT ' + ','.join(map(quoted, names)) + ' FROM ' + table + ' WHERE ' + ' AND '.join(quoted(c) + '=?' for c in pk),
                                      [values[names.index(c)] for c in pk]).fetchone()
                if returned != tuple(values):
                    raise ValueError('Content reconciliation failed')
                checks[key].update(json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode() + b'\n')
        if not complete:
            raise ValueError('Incomplete source export')
        if sequence is not None:
            db.execute('UPDATE notification_revision SET value=max(value,?) WHERE id=1', (sequence,))
        if db.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('Foreign key reconciliation failed')
        for key in imported:
            if db.execute('SELECT count(*) FROM ' + quoted(key[1])).fetchone()[0] != counts[key]:
                raise ValueError('Count reconciliation failed')
        report = {'source_sha256': source_digest.hexdigest(), 'tables': [
            {'schema': k[0], 'table': k[1], 'rows': n,
             'disposition': 'active' if k in imported else 'archive',
             'content_sha256': checks[k].hexdigest() if k in checks else None}
            for k, n in sorted(counts.items())]}
        raw.execute('INSERT INTO evidence VALUES(?,?)', ('report', json.dumps(report)))
        raw.commit()
        # Commit active DB last. A failed active commit leaves an archive, never a falsely accepted target.
        db.commit()
        return report
    except BaseException:
        db.rollback()
        raw.rollback()
        raise
    finally:
        db.close()
        raw.close()


def media_manifest(root, output):
    root = Path(root).resolve()
    count = total = 0
    with open(output, 'x', encoding='utf-8') as stream:
        os.chmod(output, 0o600)
        for path in sorted(root.rglob('*')):
            if path.is_symlink():
                raise ValueError('Media symlink requires explicit review')
            if not path.is_file():
                continue
            n = path.stat().st_size
            stream.write(json.dumps({'path': str(path.relative_to(root)), 'bytes': n, 'sha256': file_hash(path)}) + '\n')
            count += 1
            total += n
    return {'files': count, 'bytes': total, 'manifest_sha256': file_hash(output)}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    ex = sub.add_parser('export')
    ex.add_argument('--host', required=True, help='Local isolated PostgreSQL Unix socket directory')
    ex.add_argument('--port', type=int, required=True)
    ex.add_argument('--database', required=True)
    ex.add_argument('--psql', default='psql')
    ex.add_argument('--output', required=True)
    im = sub.add_parser('import')
    im.add_argument('--export', required=True)
    im.add_argument('--target', required=True)
    im.add_argument('--archive', required=True)
    me = sub.add_parser('media')
    me.add_argument('--root', required=True)
    me.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'export':
            export_snapshot(args)
        elif args.command == 'import':
            print(json.dumps(import_snapshot(args.export, args.target, args.archive)))
        else:
            print(json.dumps(media_manifest(args.root, args.output)))
    except Exception as error:
        # Avoid leaking SQL constraint values, filenames or private row data in logs.
        print('Migration failed: ' + type(error).__name__ + '; target transaction rolled back where applicable. Inspect privately.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
