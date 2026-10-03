import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import LocalEngine


class RecognitionTests(unittest.TestCase):
    def setUp(self):
        # Tests de routage et contexte ; aucun faux texte dans le moteur livré.
        self.engine = LocalEngine.__new__(LocalEngine)
        self.engine.beam_size = 3
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

    def test_context_is_bounded_and_reset_on_new_source_and_session(self):
        self.recognized("a" * 900)
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
