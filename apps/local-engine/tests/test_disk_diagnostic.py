import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from diagnostic_espace import collect, format_report, measure


class DiskDiagnosticTests(unittest.TestCase):
    def test_sizes_are_measured_and_files_remain_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = root / '.venv/Lib/site-packages'
            for name, size in [('torch', 100), ('stanza', 25), ('ctranslate2', 40)]:
                folder = site / name; folder.mkdir(parents=True)
                (folder / 'binary').write_bytes(b'x' * size)
            (root / 'models').mkdir(); (root / 'models/model.bin').write_bytes(b'a' * 50)
            before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            report = collect(root)
            self.assertEqual(report['venv']['bytes'], 165)
            self.assertEqual(report['models']['bytes'], 50)
            self.assertEqual([c['component'] for c in report['components']], ['torch', 'ctranslate2', 'stanza'])
            after = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            self.assertEqual(before, after)
            self.assertIn('Aucun nettoyage', format_report(report))

    def test_missing_environment_is_reported_not_deleted_or_recreated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = collect(root)
            self.assertFalse(report['present']['venv'])
            self.assertIn('.venv absent', format_report(report))
            self.assertEqual(list(root.iterdir()), [])

    def test_links_to_other_folders_are_not_counted_or_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); model = root / 'models'; model.mkdir()
            outside = root / 'other'; outside.mkdir(); (outside / 'binary').write_bytes(b'x' * 100)
            try:
                (model / 'link').symlink_to(outside, target_is_directory=True)
            except OSError:
                self.skipTest('Symlinks unavailable')
            self.assertEqual(measure(model)['bytes'], 0)
            self.assertTrue((outside / 'binary').exists())
