#!/usr/bin/env python3
"""Restricted SSH forced command for this Mac's backup-only key."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import datetime

ROOT = Path('/opt/typewords/backups/daily')
command = os.environ.get('SSH_ORIGINAL_COMMAND', '').split()
pattern = r'typewords-\d{8}T\d{12}Z\.tar\.gz'

if command == ['list']:
    result = []
    for file in sorted(ROOT.glob('typewords-*.tar.gz')):
        checksum = file.with_suffix(file.suffix + '.sha256')
        if re.fullmatch(pattern, file.name) and checksum.is_file() and not file.is_symlink():
            result.append({'file': file.name, 'sha256': checksum.read_text().split()[0], 'bytes': file.stat().st_size})
    print(json.dumps(result))
elif len(command) == 2 and command[0] in ('download', 'ack') and re.fullmatch(pattern, command[1]):
    file = ROOT / command[1]
    if not file.is_file() or file.is_symlink():
        raise SystemExit('Backup not found')
    if command[0] == 'download':
        with file.open('rb') as stream:
            shutil.copyfileobj(stream, sys.stdout.buffer)
    else:
        os.umask(0o077)
        value = {'file': file.name, 'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sha256': file.with_suffix(file.suffix + '.sha256').read_text().split()[0]}
        partial = ROOT / 'last-mac-copy.json.partial'
        partial.write_text(json.dumps(value)); os.replace(partial, ROOT / 'last-mac-copy.json')
        print('ok')
else:
    raise SystemExit('Only list, download and ack of verified TypeWords archives are allowed')
