import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pull', Path(__file__).with_name('pull-sync-backups.py'))
pull = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pull)


class BackupPullTest(unittest.TestCase):
    def test_offline_backlog_verified_once_and_acknowledged(self):
        with tempfile.TemporaryDirectory() as folder:
            data = b'verified synthetic archive'
            row = {'file': 'typewords-20260914T120000000000Z.tar.gz', 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
            downloads = []
            def run(args, **kwargs):
                if args[-1].startswith('download '):
                    downloads.append(args[-1]); kwargs['stdout'].write(data)
            with patch.object(sys, 'argv', ['pull', '--host', 'backup@test', '--identity', '/unused', '--output', folder]), patch.object(pull.subprocess, 'check_output', return_value=json.dumps([row]).encode()), patch.object(pull.subprocess, 'run', side_effect=run):
                pull.main(); pull.main()
            self.assertEqual(len(downloads), 1)
            self.assertEqual((Path(folder) / row['file']).read_bytes(), data)

    def test_bad_checksum_never_promotes_partial_or_acknowledges(self):
        with tempfile.TemporaryDirectory() as folder:
            row = {'file': 'typewords-20260914T120000000000Z.tar.gz', 'sha256': '0' * 64, 'bytes': 3}
            calls = []
            def run(args, **kwargs):
                calls.append(args[-1]); kwargs['stdout'].write(b'bad')
            with patch.object(sys, 'argv', ['pull', '--host', 'backup@test', '--identity', '/unused', '--output', folder]), patch.object(pull.subprocess, 'check_output', return_value=json.dumps([row]).encode()), patch.object(pull.subprocess, 'run', side_effect=run):
                with self.assertRaises(RuntimeError): pull.main()
            self.assertFalse((Path(folder) / row['file']).exists())
            self.assertTrue((Path(folder) / (row['file'] + '.partial')).exists())
            self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
