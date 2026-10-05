import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from caption_buffer import CaptionBuffer


class CaptionTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def translate(text, source, target):
            self.calls.append((text, source, target)); return 'Traduction : ' + text
        self.buffer = CaptionBuffer(translate)

    def test_fragments_revise_same_row_until_complete_sentence(self):
        first = self.buffer.process('This is a', 'en', 'fr', 0, 2)[0]
        second = self.buffer.process('map of the world.', 'en', 'fr', 2, 5)[0]
        self.assertFalse(first['final'])
        self.assertTrue(second['final'])
        self.assertEqual(second['id'], first['id'])
        self.assertEqual(second['original'], 'This is a map of the world.')
        self.assertEqual(second['start'], 0)
        self.assertEqual(second['end'], 5)
        self.assertIsNone(self.buffer.pending)

    def test_overlapping_cumulative_track_does_not_repeat_prefix(self):
        self.buffer.process('A map', 'en', 'fr', 0, 3)
        result = self.buffer.process('A map of France.', 'en', 'fr', 1, 4)[0]
        self.assertEqual(result['original'], 'A map of France.')

    def test_real_repeated_word_in_adjacent_cues_is_preserved(self):
        self.buffer.process('yes', 'en', 'fr', 0, 1)
        result = self.buffer.process('yes.', 'en', 'fr', 1, 2)[0]
        self.assertEqual(result['original'], 'yes yes.')

    def test_gap_and_stop_finalize_once_with_explicit_boundary_warning(self):
        first = self.buffer.process('Unfinished', 'en', 'fr', 0, 2)[0]
        events = self.buffer.process('Another', 'en', 'fr', 4, 6)
        self.assertEqual(events[0]['id'], first['id'])
        self.assertTrue(events[0]['bounded'])
        self.assertNotEqual(events[1]['id'], first['id'])
        final = self.buffer.finish()
        self.assertEqual(final[0]['original'], 'Another')
        self.assertEqual(self.buffer.finish(), [])

    def test_seek_and_language_switch_do_not_join_unrelated_phrases(self):
        self.buffer.process('Current', 'en', 'fr', 10, 12)
        events = self.buffer.process('Earlier', 'en', 'fr', 2, 4)
        self.assertEqual(len(events), 2)
        events = self.buffer.process('Bonjour', 'fr', 'en', 4, 6)
        self.assertEqual(events[-1]['original'], 'Bonjour')
        self.assertEqual(events[-1]['sourceLanguage'], 'fr')

    def test_overlap_does_not_drop_words_that_only_share_letters(self):
        self.buffer.process('A', 'en', 'fr', 0, 3)
        result = self.buffer.process('Apple', 'en', 'fr', 1, 4)[0]
        self.assertEqual(result['original'], 'A Apple')
        self.buffer = CaptionBuffer(lambda text, *_: text)
        self.buffer.process('cart', 'en', 'fr', 0, 3)
        result = self.buffer.process('art', 'en', 'fr', 1, 4)[0]
        self.assertEqual(result['original'], 'cart art')

    def test_chinese_caption_finalizes_at_ideographic_punctuation(self):
        first = self.buffer.process('你好', 'zh', 'fr', 0, 2)[0]
        final = self.buffer.process('欢迎。', 'zh', 'fr', 2, 4)[0]
        self.assertFalse(first['final'])
        self.assertEqual(final['id'], first['id'])
        self.assertTrue(final['final'])
        self.assertFalse(final['bounded'])
