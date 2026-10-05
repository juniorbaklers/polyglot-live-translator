import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_translate import DirectTranslation, Language, PivotTranslation
from verification_legere import compare


class LightTests(unittest.TestCase):
    def setUp(self):
        self.settings = SimpleNamespace(inter_threads=1, intra_threads=2, compute_type='auto', batch_size=32, beam_size=4)
        self.pkg = SimpleNamespace(package_path=Path('test-model'), target_prefix='',
                                   tokenizer=SimpleNamespace(encode=lambda text: text.split(), decode=lambda tokens:' '.join(tokens)))
        self.backend = Mock()
        self.backend.translate_batch.side_effect = lambda texts, **kw: [SimpleNamespace(hypotheses=[tokens],scores=[-1.0]) for tokens in texts]
        self.factory = Mock(return_value=self.backend)
        self.translation = DirectTranslation(self.pkg, self.settings, self.factory)

    def test_model_settings_and_segmentation_match_current_argos_path(self):
        self.assertEqual(self.translation.translate('First sentence. Second sentence.\nAnother paragraph.'),
                         'First sentence. Second sentence.\nAnother paragraph.')
        self.factory.assert_called_once_with('test-model/model',device='cpu',inter_threads=1,intra_threads=2,compute_type='auto')
        options = self.backend.translate_batch.call_args.kwargs
        self.assertEqual(options['beam_size'],4)
        self.assertEqual(options['length_penalty'],.2)
        self.assertTrue(options['replace_unknowns'])
        self.assertTrue(options['return_scores'])
        self.translation.translate('Again.')
        self.factory.assert_called_once()

    def test_chinese_and_language_prefix_are_preserved(self):
        self.pkg.target_prefix = '<zh>'
        self.backend.translate_batch.side_effect = lambda texts, **kw: [SimpleNamespace(hypotheses=[['<zh>']+tokens],scores=[0]) for tokens in texts]
        self.assertEqual(self.translation.translate('你好。'), '你好。')
        self.assertEqual(self.backend.translate_batch.call_args.kwargs['target_prefix'], [['<zh>']])

    def test_pivot_preserves_order_and_direct_route_is_preferred(self):
        en_fr = Mock(); en_fr.hypotheses.return_value=[SimpleNamespace(value='français',score=-1)]
        zh_en = Mock(); zh_en.hypotheses.return_value=[SimpleNamespace(value='English',score=-2)]
        graph={('zh','en'):zh_en,('en','fr'):en_fr}
        source=Language('zh',graph); target=Language('fr',graph)
        translator=source.get_translation(target)
        self.assertIsInstance(translator,PivotTranslation)
        value=translator.hypotheses('中文')[0]
        self.assertEqual((value.value,value.score),('français',-3))
        en_fr.hypotheses.assert_called_with('English',1)
        direct=Mock();graph['zh','fr']=direct
        self.assertIs(source.get_translation(target),direct)
        self.assertIsNone(source.get_translation(Language('xx',graph)))
        self.assertEqual(source.get_translation(source).translate('中文'),'中文')

    def test_reference_comparison_detects_changes_instead_of_approving_them(self):
        translator=Mock();translator.translate.return_value='Autre traduction'
        module=SimpleNamespace(get_installed_languages=lambda:[SimpleNamespace(code='en',get_translation=lambda _:translator),SimpleNamespace(code='fr')])
        item={'source':'en','target':'fr','text':'Hello.','translation':'Bonjour.'}
        failures=compare(module,[item])
        self.assertEqual(len(failures),1)
        self.assertEqual(failures[0]['light'],'Autre traduction')
        translator.translate.return_value='Bonjour.'
        self.assertEqual(compare(module,[item]),[])
