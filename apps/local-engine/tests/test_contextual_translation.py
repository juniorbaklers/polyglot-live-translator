import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from contextual_translation import contextual_translation
from engine import LocalEngine


class ContextualTests(unittest.TestCase):
    def setUp(self):
        self.backend = Mock()
        tokenizer = SimpleNamespace(encode=lambda text: text.split(), decode=lambda tokens: ' '.join(tokens))
        self.package = SimpleNamespace(pkg=SimpleNamespace(tokenizer=tokenizer, target_prefix=''), translator=self.backend)
        self.translation = SimpleNamespace(underlying=self.package)
        self.history = [('This is FME.', 'Voici FME.')]
        self.backend.translate_batch.return_value = [SimpleNamespace(hypotheses=[['Voici', 'FME.', 'Il', 'transforme', 'les', 'données.']])]

    def test_uses_source_context_and_target_prefix_without_repeating_old_lines(self):
        value = contextual_translation(self.translation, 'It transforms data.', self.history)
        self.assertEqual(value, 'Il transforme les données.')
        call = self.backend.translate_batch.call_args
        self.assertEqual(call.args[0], [['This', 'is', 'FME.', 'It', 'transforms', 'data.']])
        self.assertEqual(call.kwargs['target_prefix'], [['Voici', 'FME.']])
        self.assertEqual(call.kwargs['beam_size'], 1)

    def test_rejects_empty_truncated_and_mismatched_prefix_results(self):
        for tokens in ([], ['Voici', 'FME.'], ['Autre', 'texte'], ['Voici', 'FME.'] + ['mot'] * 128):
            self.backend.translate_batch.return_value = [SimpleNamespace(hypotheses=[tokens])]
            self.assertIsNone(contextual_translation(self.translation, 'It transforms data.', self.history))

    def test_retains_package_language_token_but_not_in_display(self):
        self.package.pkg.target_prefix = '<fr>'
        self.backend.translate_batch.return_value = [SimpleNamespace(hypotheses=[['<fr>', 'Voici', 'FME.', 'Un', 'outil.']])]
        self.assertEqual(contextual_translation(self.translation, 'A tool.', self.history), 'Un outil.')

    def test_oversized_context_and_pivot_do_not_call_backend(self):
        self.assertIsNone(contextual_translation(self.translation, 'word ' * 350, self.history))
        self.assertIsNone(contextual_translation(SimpleNamespace(t1=self.translation), 'A tool.', self.history))
        self.assertIsNone(contextual_translation(self.translation, 'A tool.', []))
        self.backend.translate_batch.assert_not_called()

    def test_deadline_rejects_result_and_callback_stops_decoding(self):
        with patch('contextual_translation.time.monotonic', side_effect=[0, 1]):
            self.assertIsNone(contextual_translation(self.translation, 'A tool.', self.history))
        callback = self.backend.translate_batch.call_args.kwargs['callback']
        with patch('contextual_translation.time.monotonic', return_value=1):
            self.assertFalse(callback(None))

    def test_provisional_uses_normal_translation_and_final_refines_same_id(self):
        engine = LocalEngine.__new__(LocalEngine)
        engine.context_limit = 160
        engine.reset_session()
        engine.uncertain_words = []
        engine.languages = {'en': SimpleNamespace(get_translation=lambda _: self.translation), 'fr': object()}
        self.translation.hypotheses = Mock(return_value=[SimpleNamespace(value='Texte rapide.')])
        engine.translation_history = list(self.history)
        engine.translation_pair = ('en', 'fr')
        provisional = engine.result('It transforms data.', 'en', 'fr', False)
        self.backend.translate_batch.assert_not_called()
        final = engine.result('It transforms data.', 'en', 'fr', True)
        self.assertEqual(provisional['id'], final['id'])
        self.assertEqual(final['translation'], 'Il transforme les données.')
        self.assertGreater(final['revision'], provisional['revision'])
        self.assertTrue(final['final'])
        engine.reset_session()
        self.assertEqual(engine.translation_history, [])

    def test_failure_falls_back_and_language_change_discards_previous_context(self):
        engine = LocalEngine.__new__(LocalEngine)
        engine.context_limit = 160
        engine.reset_session()
        engine.languages = {'en': SimpleNamespace(get_translation=lambda _: self.translation), 'fr': object(), 'es': object()}
        self.translation.hypotheses = Mock(return_value=[SimpleNamespace(value='Secours.')])
        engine.translation_history = list(self.history)
        engine.translation_pair = ('en', 'fr')
        self.backend.translate_batch.side_effect = RuntimeError('decoder error')
        self.assertEqual(engine.translate_text('A tool.', 'en', 'fr', final=True), 'Secours.')
        self.backend.translate_batch.reset_mock()
        engine.translate_text('A tool.', 'en', 'es', final=True)
        self.backend.translate_batch.assert_not_called()
        self.assertEqual(engine.translation_history, [])

    def test_unconfirmed_fragment_clears_context(self):
        engine = LocalEngine.__new__(LocalEngine)
        engine.context_limit = 160
        engine.reset_session()
        engine.languages = {'en': SimpleNamespace(get_translation=lambda _: self.translation), 'fr': object()}
        self.translation.hypotheses = Mock(return_value=[SimpleNamespace(value='Fragment')])
        engine.result('Fragment', 'en', 'fr', True, bounded=True)
        self.assertEqual(engine.translation_history, [])

    def test_caption_finalization_and_seek_reset_context_even_after_completed_line(self):
        from caption_buffer import CaptionBuffer
        fast = Mock(return_value='Provisoire')
        final = Mock(return_value='Finalisée')
        reset = Mock()
        captions = CaptionBuffer(fast, final, reset)
        first = captions.process('This is', 'en', 'fr', 0, 2)[0]
        self.assertFalse(first['final'])
        completed = captions.process('FME.', 'en', 'fr', 2, 4)[0]
        self.assertEqual(completed['id'], first['id'])
        self.assertEqual(completed['translation'], 'Finalisée')
        final.assert_called_with('This is FME.', 'en', 'fr', False)
        captions.process('Next.', 'en', 'fr', 4, 6)
        reset.assert_not_called()
        captions.process('Earlier.', 'en', 'fr', 0, 2)
        reset.assert_called_once()
        captions.process('Más.', 'es', 'fr', 2, 4)
        self.assertEqual(reset.call_count, 2)

    def test_context_history_is_limited_and_uncertain_recognition_is_discarded(self):
        engine = LocalEngine.__new__(LocalEngine)
        engine.context_limit = 160
        engine.reset_session()
        for index in range(4):
            engine.remember_translation(str(index), 'Texte', 'en', 'fr', False)
        self.assertEqual([item[0] for item in engine.translation_history], ['2', '3'])
        engine.remember_translation('Maybe FME.', 'Peut-être FME.', 'en', 'fr', False, ['FME'])
        self.assertEqual(engine.translation_history, [])


if __name__ == '__main__':
    unittest.main()
