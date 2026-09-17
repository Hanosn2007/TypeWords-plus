#!/usr/bin/env python3
"""Mac hourly pull; independent verified archives, no embedded passwords."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', required=True)
    parser.add_argument('--identity', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    if args.host.startswith('-'):
        raise ValueError('Invalid SSH host')
    os.umask(0o077)
    output = Path(args.output).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    with (output / '.pull.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        pull_locked(args, output)


def pull_locked(args, output):
    ssh = ['/usr/bin/ssh', '-i', str(Path(args.identity).expanduser()), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', args.host]
    rows = json.loads(subprocess.check_output(ssh + ['list'], timeout=30))
    received = 0
    for row in rows:
        name = row['file']; digest = row['sha256']
        if not re.fullmatch(r'typewords-\d{8}T\d{12}Z\.tar\.gz', name) or not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise ValueError('Invalid backup manifest')
        destination = output / name
        if destination.exists():
            if hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
                raise RuntimeError('Existing backup checksum mismatch; original retained: ' + name)
        else:
            partial = output / (name + '.partial')
            with partial.open('wb') as stream:
                subprocess.run(ssh + ['download ' + name], stdout=stream, check=True, timeout=1800)
            if partial.stat().st_size != row['bytes'] or hashlib.sha256(partial.read_bytes()).hexdigest() != digest:
                raise RuntimeError('Downloaded backup checksum mismatch; partial retained: ' + name)
            os.replace(partial, destination)
            destination.with_suffix(destination.suffix + '.sha256').write_text(digest + '  ' + name + '\n')
            received += 1
        subprocess.run(ssh + ['ack ' + name], check=True, stdout=subprocess.DEVNULL, timeout=30)
    print(json.dumps({'verifiedArchives': len(rows), 'downloaded': received, 'output': str(output)}))


if __name__ == '__main__':
    main()
