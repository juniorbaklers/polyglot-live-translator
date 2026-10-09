import sys
import unittest
from enum import Enum
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import LocalSentenceSplitter, configure_local_translation


class SentenceSplitterTests(unittest.TestCase):
    def test_short_transcript_preserves_sentences_and_accents(self):
        splitter = LocalSentenceSplitter(None)
        self.assertEqual(splitter.split_sentences("Bonjour ! Bienvenue. ¿Cómo estás? Très bien."),
                         ["Bonjour !", "Bienvenue.", "¿Cómo estás?", "Très bien."])
        self.assertEqual(splitter.split_sentences(" "), [])
        self.assertEqual(splitter.split_sentences("Une phrase sans ponctuation"),
                         ["Une phrase sans ponctuation"])

    def test_chinese_punctuation_without_whitespace(self):
        self.assertEqual(LocalSentenceSplitter(None).split_sentences('你好。欢迎！准备好了吗？下一句'),
                         ['你好。', '欢迎！', '准备好了吗？', '下一句'])

    def test_forces_local_segmentation_despite_user_settings(self):
        class ChunkType(Enum):
            STANZA = 3
            SPACY = 4
        module = SimpleNamespace(settings=SimpleNamespace(ChunkType=ChunkType,
                                                         chunk_type=ChunkType.SPACY),
                                 StanzaSentencizer=object)
        configure_local_translation(module)
        self.assertIs(module.settings.chunk_type, ChunkType.STANZA)
        self.assertIs(module.StanzaSentencizer, LocalSentenceSplitter)


if __name__ == "__main__":
    unittest.main()
