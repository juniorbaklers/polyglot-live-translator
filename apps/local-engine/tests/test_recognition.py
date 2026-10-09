import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import LocalEngine, stable_passage_boundary


class RecognitionTests(unittest.TestCase):
    def test_clause_boundary_requires_repeated_punctuation_and_complete_context(self):
        prefix = 'This software processes geographic data efficiently,'
        self.assertTrue(stable_passage_boundary(prefix, prefix + ' and exports maps', 'and exports maps', 'en'))
        for previous, following, language in [
            (prefix.replace(',', ''), 'and exports maps', 'en'),
            (prefix, 'and', 'en'), (prefix, 'and exports maps', 'zh')]:
            self.assertFalse(stable_passage_boundary(prefix, previous, following, language))
        for fragment in ['If you have experience in geographic data,',
                         'Une fois que vous avez obtenu la certification,',
                         'This software can work with the,',
                         'The listed measurements are 100 200 300,']:
            self.assertFalse(stable_passage_boundary(fragment, fragment + ' next words here', 'next words here', 'en'))

    def test_short_stable_passage_keeps_tail_audio_and_final_text_unchanged(self):
        def words(text, low=False):
            return [SimpleNamespace(word=(' ' if i else '') + token,
                                    end=(i + 1) * .25,
                                    probability=.3 if low and i == 3 else .95)
                    for i, token in enumerate(text.split())]
        prefix = 'This software processes geographic data efficiently,'
        initial = prefix + ' and exports maps'
        initial_words = words(initial)
        initial_words[-1].end = 2.95
        first = self.feed(initial, 2.95, words=initial_words)[0]
        current = initial + ' for our customers'
        current_words = words(current)
        current_words[-1].end = 5.95
        events = self.feed(current, 5.95, words=current_words)
        self.assertEqual(events[0]['id'], first['id'])
        self.assertEqual(events[0]['original'], prefix)
        self.assertTrue(events[0]['final'])
        self.assertFalse(events[0]['bounded'])
        self.assertEqual(events[1]['original'], 'and exports maps for our customers')
        self.assertEqual((events[0]['start'], events[0]['end']), (0, 1.5))
        self.assertEqual(len(self.engine.window), int((6 - 1.5) * 16000))
        frozen = dict(events[0])
        tail = self.feed('and exports maps for our customers worldwide', 6.95)[0]
        self.assertNotEqual(tail['id'], frozen['id'])
        self.assertEqual(events[0], frozen)

    def test_uncertain_clause_waits_instead_of_becoming_final(self):
        text = 'This software processes geographic data efficiently, and exports maps'
        words = [SimpleNamespace(word=(' ' if i else '') + token, end=(i + 1) * .25,
                                 probability=.3 if i == 3 else .95)
                 for i, token in enumerate(text.split())]
        self.feed(text, 2.95, words=words)
        events = self.feed(text + ' for customers', 5.95, words=words + [SimpleNamespace(word=' for customers', end=5.95)])
        self.assertEqual(len(events), 1)
        self.assertFalse(events[0]['final'])

    def setUp(self):
        self.engine = LocalEngine.__new__(LocalEngine)
        self.engine.audio_decoder = lambda *args, **kwargs: np.ones(48000, dtype=np.float32)
        self.engine.beam_size = 1
        self.engine.context_limit = 160
        self.engine.vocabulary = ""
        self.engine.reset_session()
        self.engine.model = Mock()
        self.translator = Mock()
        self.translator.hypotheses.side_effect = lambda text, **kwargs: [SimpleNamespace(value="Traduit : " + text)]
        self.engine.languages = {code: SimpleNamespace(get_translation=lambda _: self.translator)
                                 for code in ("en", "fr", "es", "zh")}

    def recognize(self, text, end, language="en", probability=0.9, words=None):
        self.engine.model.transcribe.return_value = (
            iter([SimpleNamespace(text=text, end=end, words=words)]) if text else iter([]),
            SimpleNamespace(language=language, language_probability=probability))

    def feed(self, text, end, **kwargs):
        self.recognize(text, end, **kwargs)
        return self.engine.process(b"audio", "en", "fr")

    def test_final_only_recognizes_revisions_but_translates_once(self):
        self.engine.translate_drafts = False
        first = self.feed("A map of the", 2.95)[0]
        self.assertEqual(first["translation"], "")
        self.translator.hypotheses.assert_not_called()
        final = self.feed("A map of the world.", 4.9)[0]
        self.assertEqual(final["id"], first["id"])
        self.assertTrue(final["final"])
        self.assertEqual(final["translation"], "Traduit : A map of the world.")
        self.translator.hypotheses.assert_called_once()

    def test_first_chunk_is_displayed_and_same_phrase_is_corrected(self):
        first = self.feed("A map of the see", 2.95)[0]
        self.assertFalse(first["final"])
        second = self.feed("A map of the sea coast", 5.95)[0]
        self.assertEqual(first["id"], second["id"])
        self.assertGreater(second["revision"], first["revision"])
        self.assertEqual(second["original"], "A map of the sea coast")
        self.assertFalse(second["final"])
        self.assertEqual(len(self.engine.model.transcribe.call_args.args[0]), 96000)

    def test_pause_finalizes_current_line_then_starts_new_id(self):
        first = self.feed("Hello", 2.95)[0]
        final = self.feed("Hello everyone.", 4.9)[0]
        self.assertTrue(final["final"])
        self.assertFalse(final["bounded"])
        self.assertEqual(first["id"], final["id"])
        self.assertIsNone(self.engine.window)
        new = self.feed("Next sentence", 2.95)[0]
        self.assertNotEqual(new["id"], final["id"])
        self.assertEqual(self.engine.model.transcribe.call_args.kwargs["initial_prompt"], "Hello everyone.")

    def test_stable_sentence_prefix_is_finalized_without_losing_following_words(self):
        def word(text, end): return SimpleNamespace(word=text, end=end)
        first = self.feed("Hello everyone. This", 2.95, words=[word("Hello", .6), word(" everyone.", 1.3), word(" This", 2.95)])[0]
        events = self.feed("Hello everyone. This is a course", 5.95,
                           words=[word("Hello", .6), word(" everyone.", 1.3), word(" This", 2.95),
                                  word(" is", 3.7), word(" a", 4), word(" course", 5.95)])
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["id"], first["id"])
        self.assertEqual(events[0]["original"], "Hello everyone.")
        self.assertTrue(events[0]["final"])
        self.assertEqual(events[1]["original"], "This is a course")
        self.assertFalse(events[1]["final"])
        self.assertNotEqual(events[0]["id"], events[1]["id"])
        self.assertEqual(len(self.engine.window), int(96000 - 1.3 * 16000))

    def test_window_is_bounded_for_uninterrupted_speech(self):
        last = None
        for i in range(4):
            last = self.feed("Very long uninterrupted sentence", 3 * (i + 1) - .05)[0]
        self.assertTrue(last["final"])
        self.assertTrue(last["bounded"])
        self.assertIsNone(self.engine.window)

    def test_finish_finalizes_latest_correction_only_once(self):
        first = self.feed("Current words", 2.95)[0]
        events = self.engine.finish("fr")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["id"], first["id"])
        self.assertTrue(events[0]["final"])
        self.assertEqual(self.engine.finish("fr"), [])

    def test_silence_emits_nothing_and_finalizes_existing_proposal(self):
        self.assertEqual(self.feed("", 3), [])
        self.translator.hypotheses.assert_not_called()
        first = self.feed("Recognized words", 2.95)[0]
        final = self.feed("", 6)[0]
        self.assertEqual(first["id"], final["id"])
        self.assertTrue(final["final"])

    def test_unknown_auto_language_does_not_stop_session_and_recovers(self):
        self.recognize("Noise", 2.95, language="te")
        self.assertEqual(self.engine.process(b"audio", "auto", "fr"), [])
        self.recognize("Actual words", 5.95)
        self.assertEqual(self.engine.process(b"audio", "auto", "fr")[0]["original"], "Actual words")
        self.assertEqual(self.engine.detected_language, "en")
        self.recognize("More words", 8.95, language="te")
        self.engine.process(b"audio", "auto", "fr")
        self.assertEqual(self.engine.model.transcribe.call_args.kwargs["language"], "en")

    def test_new_source_resets_audio_context_and_phrase_identity(self):
        first = self.feed("English words", 2.95)[0]
        self.recognize("Palabras nuevas", 2.95, language="es")
        other = self.engine.process(b"audio", "es", "fr")[0]
        self.assertNotEqual(first["id"], other["id"])
        self.assertEqual(len(self.engine.window), 48000)
        self.assertIsNone(self.engine.model.transcribe.call_args.kwargs["initial_prompt"])

    def test_empty_translation_keeps_original_without_raising(self):
        self.translator.hypotheses.side_effect = None
        for result in ([], [SimpleNamespace(value=" ")]):
            self.translator.hypotheses.return_value = result
            event = self.feed("Important words", 2.95)[0]
            self.assertEqual(event["original"], "Important words")
            self.assertEqual(event["translation"], "")

    def test_capture_timeline_advances_across_silence_and_stable_prefix(self):
        self.feed("", 3)
        first = self.feed("Hello", 2.95)[0]
        self.assertEqual((first['start'], first['end']), (3, 6))
        final = self.feed("Hello everyone.", 4.9)[0]
        self.assertEqual((final['start'], final['end']), (3, 9))
        next_row = self.feed("Next", 2.95)[0]
        self.assertEqual((next_row['start'], next_row['end']), (9, 12))

    def test_low_probability_words_are_flagged_without_claiming_translation_confidence(self):
        words = [SimpleNamespace(word="Hello", end=.5, probability=.9), SimpleNamespace(word=" QGIS", end=2.95, probability=.3)]
        event = self.feed("Hello QGIS", 2.95, words=words)[0]
        self.assertEqual(event['uncertainWords'], ['QGIS'])
        self.assertNotIn('translationConfidence', event)
        self.assertEqual(event['sourceLanguage'], 'en')

    def test_short_pause_inside_unpunctuated_phrase_keeps_context(self):
        first = self.feed("This is a", 2.1)[0]
        self.assertFalse(first['final'])
        complete = self.feed("This is a map.", 4.9)[0]
        self.assertEqual(first['id'], complete['id'])
        self.assertTrue(complete['final'])

    def test_identical_recognition_reuses_translation_but_metadata_advances(self):
        first = self.feed("Same words", 2.95)[0]
        second = self.feed("Same words", 5.95)[0]
        self.assertEqual(first['translation'], second['translation'])
        self.assertGreater(second['revision'], first['revision'])
        self.assertEqual(self.translator.hypotheses.call_count, 1)
        self.engine.reset_session()
        self.feed("Same words", 2.95)
        self.assertEqual(self.translator.hypotheses.call_count, 2)

    def test_recognition_settings_preserve_local_context_and_timestamps(self):
        self.feed("Hello", 2.95)
        options = self.engine.model.transcribe.call_args.kwargs
        self.assertEqual(options["beam_size"], 1)
        self.assertTrue(options["word_timestamps"])
        self.assertEqual(options["vad_parameters"], {"threshold": .35, "speech_pad_ms": 400})
        self.translator.hypotheses.assert_called_with("Hello", num_hypotheses=1)

    def test_digital_silence_finalizes_once_without_new_model_inference(self):
        first = self.feed('Current words', 2.95)[0]
        self.engine.audio_decoder = lambda *args, **kwargs: np.zeros(48000, dtype=np.float32)
        calls = self.engine.model.transcribe.call_count
        final = self.engine.process(b'silent', 'en', 'fr')[0]
        self.assertEqual(final['id'], first['id'])
        self.assertTrue(final['final'])
        self.assertEqual(self.engine.window_start, 6.0)
        self.assertEqual(self.engine.model.transcribe.call_count, calls)
        self.assertEqual(self.engine.process(b'silent', 'en', 'fr'), [])
        self.assertEqual(self.engine.window_start, 9.0)
        self.assertEqual(self.engine.model.transcribe.call_count, calls)

    def test_nonzero_quiet_audio_is_still_recognized(self):
        self.engine.audio_decoder = lambda *args, **kwargs: np.full(48000, 1e-7, dtype=np.float32)
        self.feed('Quiet words', 2.95)
        self.engine.model.transcribe.assert_called_once()

    def test_chinese_auto_detection_pause_and_uncertainty(self):
        self.recognize('这是地图。', 2.0, language='zh',
                       words=[SimpleNamespace(word='地图', end=2.0, probability=.3)])
        result = self.engine.process(b'audio', 'auto', 'fr')[0]
        self.assertTrue(result['final'])
        self.assertFalse(result['bounded'])
        self.assertEqual(result['sourceLanguage'], 'zh')
        self.assertEqual(result['uncertainWords'], ['地图'])
        self.assertEqual(self.engine.detected_language, 'zh')

    def test_chinese_stable_prefix_without_spaces_keeps_next_phrase(self):
        def word(text, end): return SimpleNamespace(word=text, end=end)
        self.recognize('这是地图。下一', 2.95, language='zh',
                       words=[word('这是', .6), word('地图。', 1.3), word('下一', 2.95)])
        first = self.engine.process(b'audio', 'zh', 'fr')[0]
        self.recognize('这是地图。下一句话', 5.95, language='zh',
                       words=[word('这是', .6), word('地图。', 1.3), word('下一', 2.95), word('句话', 5.95)])
        events = self.engine.process(b'audio', 'zh', 'fr')
        self.assertEqual(events[0]['id'], first['id'])
        self.assertTrue(events[0]['final'])
        self.assertEqual(events[0]['original'], '这是地图。')
        self.assertEqual(events[1]['original'], '下一句话')
        self.assertFalse(events[1]['final'])

    def test_missing_chinese_models_gives_installation_instruction(self):
        del self.engine.languages['zh']
        with self.assertRaisesRegex(ValueError, 'INSTALLER.cmd'):
            self.engine.process(b'audio', 'zh', 'fr')
        self.assertEqual(self.feed('Still supported.', 2.0)[0]['sourceLanguage'], 'en')


if __name__ == "__main__":
    unittest.main()
