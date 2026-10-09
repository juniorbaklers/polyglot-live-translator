import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from install_models import install_translation_models
from languages import MODEL_PAIRS, BASE_PAIRS
from preferences import validate_preferences


class LanguageInstallationTests(unittest.TestCase):
    def test_existing_languages_are_kept_and_only_missing_chinese_models_download(self):
        packages = Mock()
        available = [SimpleNamespace(from_code=a, to_code=b, download=Mock(return_value=f'{a}-{b}')) for a, b in MODEL_PAIRS]
        packages.get_available_packages.return_value = available
        packages.get_installed_packages.return_value = available[:len(BASE_PAIRS)]
        install_translation_models(packages)
        self.assertEqual([call.args[0] for call in packages.install_from_path.call_args_list], ['en-zh', 'zh-en'])
        for package in available[:len(BASE_PAIRS)]:
            package.download.assert_not_called()

    def test_missing_chinese_catalog_entry_is_an_explicit_error(self):
        packages = Mock()
        packages.get_available_packages.return_value = []
        packages.get_installed_packages.return_value = [SimpleNamespace(from_code=a, to_code=b) for a, b in BASE_PAIRS]
        with self.assertRaisesRegex(RuntimeError, 'en → zh'):
            install_translation_models(packages)
        packages.install_from_path.assert_not_called()

    def test_personal_correction_accepts_chinese_pair_and_preserves_han(self):
        item = dict(original='你好', translation='Bonjour', source='zh', target='fr')
        self.assertEqual(validate_preferences({'corrections':[item]})['corrections'], [item])
