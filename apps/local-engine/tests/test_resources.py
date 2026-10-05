import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from resources import Resources, Profile, GIB, choose_profile, load_model, detect_resources


class ResourceTests(unittest.TestCase):
    def test_small_pc_never_forces_precision(self):
        for resources in (Resources(2, 8 * GIB), Resources(8, 2 * GIB), Resources(4, None)):
            self.assertEqual(choose_profile(resources, 'precision').model, 'tiny')

    def test_available_memory_and_cpu_both_required(self):
        self.assertEqual(choose_profile(Resources(4, 6 * GIB)).model, 'base')
        self.assertEqual(choose_profile(Resources(6, 6 * GIB)).model, 'small')
        self.assertEqual(choose_profile(Resources(4, 4 * GIB), 'precision').model, 'small')
        self.assertEqual(choose_profile(Resources(8, 3 * GIB), 'precision').model, 'base')
        self.assertEqual(choose_profile(Resources(1, 8 * GIB)).threads, 1)
        self.assertEqual(choose_profile(Resources(128, 64 * GIB)).threads, 6)

    def cache(self, root, name):
        path = root / f'models--Systran--faster-whisper-{name}' / 'snapshots' / 'revision'
        path.mkdir(parents=True)
        for file in ('model.bin', 'config.json', 'tokenizer.json'):
            (path / file).touch()

    def test_missing_small_uses_installed_base_offline(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.cache(root, 'base')
            factory = Mock(return_value=object())
            model, profile = load_model(factory, root, Profile('small', 4, 3, 700))
            self.assertEqual(profile.model, 'base'); self.assertEqual(profile.beam, 1)
            self.assertTrue(factory.call_args.kwargs['local_files_only'])

    def test_allocation_failure_falls_back_but_other_error_surfaces(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('tiny', 'base', 'small'): self.cache(root, name)
            factory = Mock(side_effect=[RuntimeError('std::bad_alloc'), MemoryError(), object()])
            _, profile = load_model(factory, root, Profile('small', 4, 3, 700))
            self.assertEqual(profile.model, 'tiny')
            self.assertEqual([call.args[0] for call in factory.call_args_list], ['small', 'base', 'tiny'])
            with self.assertRaisesRegex(RuntimeError, 'corrupt'):
                load_model(Mock(side_effect=RuntimeError('corrupt')), root, Profile('base', 2, 1, 160))

    def test_tiny_does_not_load_heavier_model(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.cache(root, 'base')
            factory = Mock()
            with self.assertRaisesRegex(RuntimeError, 'INSTALLER'):
                load_model(factory, root, Profile('tiny', 1, 1, 160))
            factory.assert_not_called()

    def test_detection_respects_affinity(self):
        with patch('psutil.Process') as process, patch('psutil.cpu_count', return_value=8), patch('os.cpu_count', return_value=16):
            process.return_value.cpu_affinity.return_value = [2, 3]
            self.assertEqual(detect_resources().cpus, 2)


if __name__ == '__main__': unittest.main()
