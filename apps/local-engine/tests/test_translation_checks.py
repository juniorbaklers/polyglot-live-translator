import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from translation_checks import translation_issues
from ai_experts import LocalExpert
from preferences import validate_preferences


class TranslationChecksTests(unittest.TestCase):
    def test_digits_decimals_repetitions_and_signs(self):
        self.assertEqual(translation_issues('10.5 km, 3 maps', '10,5 km, 3 cartes', 'en', 'fr'), [])
        for source, target in [('10 years', '11 ans'), ('3 maps, 3 layers', '3 cartes'), ('-10', '10'), ('100.0', '1000')]:
            self.assertIn('numbers', translation_issues(source, target, 'en', 'fr'))

    def test_negations_across_languages_and_not_only_exception(self):
        self.assertEqual(translation_issues('This is not useful.', 'Ce n’est pas utile.', 'en', 'fr'), [])
        self.assertIn('negation', translation_issues('This is not useful.', 'C’est utile.', 'en', 'fr'))
        self.assertIn('negation', translation_issues('No funciona.', 'Cela fonctionne.', 'es', 'fr'))
        self.assertEqual(translation_issues('Not only maps.', 'Les cartes et bien plus.', 'en', 'fr'), [])
        self.assertEqual(translation_issues('Une personne.', 'A person.', 'fr', 'en'), [])
        self.assertEqual(translation_issues('Text', 'Texte', 'dyu', 'fr'), [])

    def test_expert_rejects_changed_numbers_or_lost_negation(self):
        for source, translated in [('We have 3 maps.', 'Nous avons 30 cartes.'), ('Do not delete.', 'Supprimez.')]:
            expert = LocalExpert(validate_preferences({'translationEngine': 'ollama'})); expert.model = 'local'
            import json
            with patch('ai_experts.local_request', return_value={'message': {'content': json.dumps({'translation': translated})}}):
                self.assertIsNone(expert.translate(source, 'en', 'fr', 'general', [], []))
            self.assertTrue(expert.disabled)
            self.assertIn('contrôle', expert.warning)

    def test_same_phrase_with_different_context_is_not_reused_from_cache(self):
        from engine import LocalEngine
        from types import SimpleNamespace
        from unittest.mock import Mock
        engine=LocalEngine.__new__(LocalEngine);engine.configure_session({'translationEngine':'ollama'});engine.reset_session()
        engine.languages={code:SimpleNamespace(get_translation=lambda _:Mock()) for code in ('en','fr')}
        expert=Mock();expert.warning=None;expert.translate.side_effect=['Il fonctionne.','Elle fonctionne.'];engine.expert=expert
        engine.translation_pair=('en','fr');engine.translation_history=[('The engine.','Le moteur.')]
        self.assertEqual(engine.translate_text('It works.','en','fr',True),'Il fonctionne.')
        engine.translation_history=[('The application.','L’application.')]
        self.assertEqual(engine.translate_text('It works.','en','fr',True),'Elle fonctionne.')
        self.assertEqual(expert.translate.call_count,2)
