import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import LocalEngine, SentenceBuffer
import numpy as np


class RecognitionTests(unittest.TestCase):
    def setUp(self):
        # Tests de routage et contexte ; aucun faux texte dans le moteur livré.
        self.engine = LocalEngine.__new__(LocalEngine)
        self.engine.audio_decoder = lambda *args, **kwargs: np.ones(16000 * 5, dtype=np.float32)
        self.engine.batch_seconds = 0
        self.engine.beam_size = 3
        self.engine.context_limit = 700
        self.engine.vocabulary = ""
        self.engine.reset_session()
        self.engine.model = Mock()
        self.translator = Mock()
        self.translator.hypotheses.return_value = [SimpleNamespace(value="Texte traduit")]
        self.engine.languages = {code: SimpleNamespace(get_translation=lambda _: self.translator)
                                 for code in ("en", "fr", "es")}

    def recognized(self, text, language="en", probability=0.9):
        self.engine.model.transcribe.return_value = (
            iter([SimpleNamespace(text=text)]) if text else iter([]),
            SimpleNamespace(language=language, language_probability=probability))

    def test_context_guides_next_chunk_and_only_one_translation_is_requested(self):
        self.recognized("First sentence.")
        self.assertEqual(self.engine.process(b"audio", "en", "fr"),
                         ("First sentence.", "Texte traduit"))
        self.recognized("Second sentence.")
        self.engine.process(b"audio", "en", "fr")
        options = self.engine.model.transcribe.call_args.kwargs
        self.assertEqual(options["initial_prompt"], "First sentence.")
        self.assertEqual(options["beam_size"], 3)
        self.assertEqual(options["temperature"], 0.0)
        self.assertEqual(options["language"], "en")
        self.translator.hypotheses.assert_called_with("Second sentence.", num_hypotheses=1)

    def test_unknown_auto_detection_is_skipped_and_next_chunk_recovers(self):
        self.recognized("Noise", "te")
        self.assertEqual(self.engine.process(b"audio", "auto", "fr"), ("", ""))
        self.assertEqual(self.engine.context, "")
        self.translator.hypotheses.assert_not_called()
        self.recognized("Hello.")
        self.assertEqual(self.engine.process(b"audio", "auto", "fr")[0], "Hello.")
        self.assertEqual(self.engine.detected_language, "en")
        self.recognized("Welcome.", "te")
        self.engine.process(b"audio", "auto", "fr")
        self.assertEqual(self.engine.model.transcribe.call_args.kwargs["language"], "en")

    def test_silence_emits_nothing_and_does_not_translate_prompt(self):
        self.engine.vocabulary = "QGIS, ETL"
        self.recognized("")
        self.assertEqual(self.engine.process(b"audio", "en", "fr"), ("", ""))
        self.translator.hypotheses.assert_not_called()

    def test_empty_translation_preserves_source_and_capture(self):
        for result in ([], [SimpleNamespace(value="   ")]):
            self.recognized("Important words.")
            self.translator.hypotheses.return_value = result
            self.assertEqual(self.engine.process(b"audio", "en", "fr"), ("Important words.", ""))

    def test_light_mode_limits_prompt_and_preserves_vad_padding(self):
        self.engine.beam_size = 1
        self.engine.context_limit = 160
        self.recognized("a" * 900 + ".")
        self.engine.process(b"audio", "en", "fr")
        self.assertEqual(len(self.engine.context), 160)
        options = self.engine.model.transcribe.call_args.kwargs
        self.assertEqual(options["beam_size"], 1)
        self.assertEqual(options["vad_parameters"], {"threshold": 0.35, "speech_pad_ms": 400})

    def test_audio_chunks_are_combined_in_order_before_transcription(self):
        self.engine.batch_seconds = 9
        self.engine.audio_decoder = Mock(side_effect=[np.ones(80000, dtype=np.float32),
                                                      np.full(80000, 2, dtype=np.float32)])
        self.recognized("A complete sentence.")
        self.assertEqual(self.engine.process(b"first", "en", "fr"), ("", ""))
        self.engine.model.transcribe.assert_not_called()
        self.assertEqual(self.engine.process(b"second", "en", "fr")[0], "A complete sentence.")
        audio = self.engine.model.transcribe.call_args.args[0]
        self.assertEqual(len(audio), 160000)
        np.testing.assert_array_equal(audio[:80000], 1)
        np.testing.assert_array_equal(audio[80000:], 2)
        self.assertEqual(self.engine.audio_samples, 0)

    def test_sentence_tail_is_joined_with_next_batch(self):
        self.recognized("One sentence. This is the")
        self.assertEqual(self.engine.process(b"audio", "en", "fr")[0], "One sentence.")
        self.recognized("rest of the sentence.")
        self.assertEqual(self.engine.process(b"audio", "en", "fr")[0],
                         "This is the rest of the sentence.")
        self.translator.hypotheses.assert_called_with("This is the rest of the sentence.", num_hypotheses=1)

    def test_new_source_discards_previous_audio_and_partial_phrase(self):
        self.engine.batch_seconds = 9
        self.engine.process(b"first", "en", "fr")
        self.engine.sentences.add("Previous course fragment")
        self.engine.process(b"next", "es", "fr")
        self.assertEqual(self.engine.audio_samples, 80000)
        self.assertEqual(self.engine.sentences.text, "")
        self.engine.model.transcribe.assert_not_called()

    def test_partial_phrase_on_silence_is_preserved_without_translation(self):
        self.recognized("A phrase without an ending")
        self.assertEqual(self.engine.process(b"audio", "en", "fr"), ("", ""))
        self.recognized("")
        self.assertEqual(self.engine.process(b"audio", "en", "fr"),
                         ("A phrase without an ending", ""))
        self.translator.hypotheses.assert_not_called()

    def test_phrase_wait_is_bounded_without_fabricating_an_ending(self):
        buffer = SentenceBuffer()
        self.assertEqual(buffer.add("First part"), ("", True))
        self.assertEqual(buffer.add("and next part"), ("First part and next part", False))
        self.assertEqual(buffer.add(""), ("", True))

    def test_context_is_bounded_and_reset_on_new_source_and_session(self):
        self.recognized("a" * 900 + ".")
        self.engine.process(b"audio", "en", "fr")
        self.assertEqual(len(self.engine.context), 700)
        self.recognized("Bonjour.", "fr")
        self.engine.process(b"audio", "fr", "en")
        self.assertIsNone(self.engine.model.transcribe.call_args.kwargs["initial_prompt"])
        self.engine.reset_session()
        self.assertEqual(self.engine.context, "")
        self.assertIsNone(self.engine.detected_language)


if __name__ == "__main__":
    unittest.main()
