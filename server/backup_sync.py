#!/usr/bin/env python3
"""Online SQLite backup; verify a separate restored copy before publishing it.

Optional offsite delivery uses an already configured SSH connection (BatchMode).
No passwords are accepted or stored by this script. Failed offsite delivery exits
nonzero and keeps the local backup for a later retry.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tarfile
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', default='/var/lib/typewords/typewords.db')
    parser.add_argument('--output', default='/opt/typewords/backups/daily')
    parser.add_argument('--offsite', default=os.environ.get('TYPEWORDS_BACKUP_OFFSITE', ''))
    args = parser.parse_args()
    os.umask(0o077)
    source = Path(args.database).resolve(strict=True)
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    with tempfile.TemporaryDirectory(prefix='typewords-verify-') as temp:
        folder = Path(temp)
        backup = folder / 'typewords.db'
        original = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
        copy = sqlite3.connect(backup)
        original.backup(copy)
        original.close()
        if copy.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or copy.execute('PRAGMA foreign_key_check').fetchall():
            raise RuntimeError('Backup integrity verification failed')
        restored = sqlite3.connect(folder / 'restore-check.db')
        copy.backup(restored)
        if restored.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise RuntimeError('Independent restore verification failed')
        def summary(db):
            result = {}
            for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
                rows = sorted(repr(tuple(row)) for row in db.execute('SELECT * FROM "' + table.replace('"', '""') + '"'))
                result[table] = {'rows': len(rows), 'sha256': hashlib.sha256('\n'.join(rows).encode()).hexdigest()}
            return result
        tables = summary(copy)
        if summary(restored) != tables:
            raise RuntimeError('Restored rows differ')
        copy.close(); restored.close()
        manifest = {'createdAt': stamp, 'source': str(source), 'tables': tables, 'restoreVerified': True}
        (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        destination = output / ('typewords-' + stamp + '.tar.gz')
        partial = output / (destination.name + '.partial')
        with tarfile.open(partial, 'w:gz') as tar:
            tar.add(backup, arcname='typewords.db')
            tar.add(folder / 'manifest.json', arcname='manifest.json')
        os.replace(partial, destination)
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        checksum = destination.with_suffix(destination.suffix + '.sha256')
        checksum.write_text(digest + '  ' + destination.name + '\n')
        latest = output / 'latest.json.partial'
        latest.write_text(json.dumps({'file': destination.name, 'sha256': digest, 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'restoreVerified': True}))
        os.replace(latest, output / 'latest.json')
        if args.offsite:
            if args.offsite.startswith('-') or ':' not in args.offsite:
                raise ValueError('Offsite must be an existing SSH destination: host:/directory/')
            subprocess.run(['scp', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', str(destination), str(checksum), args.offsite], check=True)
        # Never silently purge older backups. Operators can move them to an archive
        # after checking disk use; sync_history itself has bounded retention.
        print(json.dumps({'backup': str(destination), 'sha256': digest, 'restoreVerified': True, 'offsiteCopied': bool(args.offsite)}))


if __name__ == '__main__':
    main()
