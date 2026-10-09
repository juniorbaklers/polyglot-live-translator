import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import LocalEngine, translation_input
from preferences import validate_preferences
from benchmark import word_error_rate


class PreferencesTests(unittest.TestCase):
    def engine(self):
        engine = LocalEngine.__new__(LocalEngine)
        engine.configure_session({"domain": "geographie", "glossary": "Sentinel-2"})
        engine.context_limit = 160
        engine.reset_session()
        translator = Mock()
        translator.hypotheses.return_value = [SimpleNamespace(value="Traduction du modèle")]
        engine.languages = {code: SimpleNamespace(get_translation=lambda _: translator) for code in ('en','fr','es')}
        return engine, translator

    def test_domain_and_glossary_survive_session_reset(self):
        engine, _ = self.engine()
        self.assertIn('QGIS', engine.session_vocabulary)
        self.assertIn('Sentinel-2', engine.session_vocabulary)
        engine.reset_session()
        self.assertIn('Sentinel-2', engine.session_vocabulary)
        engine.configure_session({})
        self.assertEqual(engine.session_vocabulary, '')

    def test_exact_correction_respects_language_pair_and_does_not_replace_substrings(self):
        engine, translator = self.engine()
        engine.configure_session({"corrections": [{"original": "The map.", "translation": "La carte.", "source": "en", "target": "fr"}]})
        self.assertEqual(engine.translate_text(' THE   MAP. ', 'en', 'fr'), 'La carte.')
        translator.hypotheses.assert_not_called()
        self.assertEqual(engine.translate_text('The map. More text.', 'en', 'fr'), 'Traduction du modèle')
        self.assertEqual(engine.translate_text('The map.', 'en', 'es'), 'Traduction du modèle')
        self.assertEqual(engine.translate_text('Un texte', 'fr', 'fr'), 'Un texte')

    def test_preferences_are_bounded_and_validate_language_and_types(self):
        invalid = [{"glossary": 'x' * 1501}, {"domain": "inconnu"}, {"corrections": [None]},
                   {"corrections": [{}]}, {"corrections": [{"original":"x","translation":"y","source":"auto","target":"fr"}]},
                   {"corrections": [] * 0, "glossary": None}]
        for options in invalid:
            with self.subTest(options=str(options)[:30]), self.assertRaises(ValueError): validate_preferences(options)
        self.assertEqual(validate_preferences({})['domain'], 'general')

    def test_political_meaning_is_explicit_only_in_selected_domain(self):
        text = 'Which party will win? Political parties are competing.'
        self.assertEqual(translation_input(text, 'en', 'general'), text)
        self.assertEqual(translation_input(text, 'fr', 'sondages'), text)
        self.assertEqual(translation_input(text, 'en', 'sondages'),
                         'Which political party will win? Political parties are competing.')
        engine, translator = self.engine()
        engine.configure_session({'domain': 'sondages'})
        engine.translate_text('Which party will win?', 'en', 'fr')
        translator.hypotheses.assert_called_with('Which political party will win?', num_hypotheses=1)
        self.assertEqual(engine.translate_text('Which party will win?', 'en', 'en'), 'Which party will win?')

    def test_recognition_quality_is_validated(self):
        self.assertEqual(validate_preferences({'recognitionQuality':'precise'})['recognitionQuality'], 'precise')
        for value in ('unknown', None, 1):
            with self.assertRaises(ValueError): validate_preferences({'recognitionQuality':value})

    def test_wer_measures_missing_wrong_and_extra_words_without_punctuation(self):
        self.assertEqual(word_error_rate('Hello, WORLD!', 'hello world')['wer'], 0)
        self.assertEqual(word_error_rate('one two three', 'one four')['errors'], 2)
        self.assertEqual(word_error_rate('one', 'one two three')['wer'], 2)
        with self.assertRaises(ValueError): word_error_rate('', 'word')
