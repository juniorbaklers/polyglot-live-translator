import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from african_translation import AfricanTranslator, AfricanTranslation, translation_route, MODEL_IDS, TOKENS
from engine import LocalEngine
from languages import LANGUAGES, AUDIO_LANGUAGES, AFRICAN_LANGUAGES
from preferences import validate_preferences
from resources import GIB


class AfricanTests(unittest.TestCase):
    def test_iso_codes_are_explicit_and_not_akan_or_bambara(self):
        self.assertEqual(AFRICAN_LANGUAGES,{'dyu','bci','wol'})
        self.assertFalse(AFRICAN_LANGUAGES & AUDIO_LANGUAGES)
        self.assertEqual(TOKENS['dyu'],'dyu_Latn'); self.assertEqual(TOKENS['bci'],'bci_Latn')
        for code in AFRICAN_LANGUAGES:
            item=dict(original='texte original',translation='texte traduit',source='fr',target=code)
            self.assertEqual(validate_preferences({'corrections':[item]})['corrections'],[item])

    def test_all_pairs_have_valid_routes_and_baoule_only_uses_french_bridge(self):
        for source in LANGUAGES:
            for target in LANGUAGES:
                route=translation_route(source,target)
                if source==target:
                    self.assertEqual(route,[]);continue
                self.assertEqual(route[0][1],source);self.assertEqual(route[-1][2],target)
                for current,following in zip(route,route[1:]): self.assertEqual(current[2],following[1])
                for backend,a,b in route:
                    if backend=='baoule':self.assertEqual({a,b},{'bci','fr'})
                    if backend=='argos':self.assertLessEqual({a,b},AUDIO_LANGUAGES)
        self.assertEqual(translation_route('en','bci'),[('argos','en','fr'),('baoule','fr','bci')])
        self.assertEqual(translation_route('bci','dyu'),[('baoule','bci','fr'),('nllb','fr','dyu')])
        self.assertEqual(translation_route('fr','wol'),[('nllb','fr','wol')])

    def test_missing_models_fail_locally_without_importing_remote_libraries(self):
        with tempfile.TemporaryDirectory() as root:
            manager=AfricanTranslator(root)
            with self.assertRaisesRegex(ValueError,'INSTALLER_LANGUES_AFRICAINES'): manager.require_pair('auto','dyu')
            manager.require_pair('bci','bci')

    def test_installed_metadata_and_pivot_require_both_models(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root)
            for name in MODEL_IDS:
                folder=root/name;folder.mkdir()
                for file in ('model.bin','config.json','tokenizer.json'):(folder/file).touch()
                (folder/'polyglot-model.json').write_text(json.dumps({'format':1,'model':MODEL_IDS[name]}))
            manager=AfricanTranslator(root);manager.require_pair('bci','wol')
            (root/'nllb'/'polyglot-model.json').write_text('{"format":1,"model":"unknown"}')
            with self.assertRaisesRegex(ValueError,'incompatible'):manager.require_pair('bci','wol')

    def test_pivot_translation_preserves_direction_and_text_order(self):
        manager=AfricanTranslator('/unused');manager.require_pair=Mock()
        calls=[]
        def direct(text,name,a,b):calls.append((name,a,b,text));return text+'-'+b
        manager.direct=direct
        def classic(text,a,b):calls.append(('argos',a,b,text));return text+'-'+b
        result=AfricanTranslation(manager,'en','bci',classic).hypotheses('Hello')[0].value
        self.assertEqual(result,'Hello-fr-bci')
        self.assertEqual(calls,[('argos','en','fr','Hello'),('baoule','fr','bci','Hello-fr')])

    def test_engine_routes_african_pairs_away_from_argos_and_ollama(self):
        engine=LocalEngine.__new__(LocalEngine)
        engine.configure_session({'translationEngine':'ollama','corrections':[]});engine.reset_session()
        engine.languages={}
        engine.african=Mock();engine.african.translate.return_value='Traduction africaine'
        engine.expert=Mock()
        self.assertEqual(engine.translate_text('Bonjour','fr','dyu',True),'Traduction africaine')
        engine.african.translate.assert_called_once();engine.expert.translate.assert_not_called()
        engine.configure_session({'corrections':[dict(source='fr',target='dyu',original='Bonjour',translation='Terme préféré')]})
        self.assertEqual(engine.translate_text('Bonjour','fr','dyu',True),'Terme préféré')

    def test_african_source_audio_is_refused_before_whisper_or_model_loading(self):
        engine=LocalEngine.__new__(LocalEngine)
        for code in AFRICAN_LANGUAGES:
            with self.assertRaisesRegex(ValueError,'sous-titres'):engine.process(b'fake',code,'fr')

    def test_direct_tokenizer_does_not_truncate_and_uses_language_prefix(self):
        manager=AfricanTranslator('/unused');manager.loaded_name='nllb'
        tokenizer=Mock();tokenizer.encode.return_value=SimpleNamespace(tokens=['x']*400)
        tokenizer.token_to_id.side_effect=lambda token: {'dyu_Latn':1,'fra_Latn':2,'result':3}.get(token)
        tokenizer.decode.return_value='sortie'
        manager.tokenizer=tokenizer;manager.translator=Mock()
        manager.translator.translate_batch.return_value=[SimpleNamespace(hypotheses=[['dyu_Latn','result']])]
        self.assertEqual(manager.direct('texte','nllb','fr','dyu'),'sortie sortie sortie')
        calls=manager.translator.translate_batch.call_args_list
        self.assertEqual(len(calls),3)
        self.assertEqual(sum(len(call.args[0][0])-2 for call in calls),400)
        for call in calls:
            self.assertEqual(call.args[0][0][0],'fra_Latn');self.assertEqual(call.args[0][0][-1],'</s>')
            self.assertEqual(call.kwargs['target_prefix'],[['dyu_Latn']])
        tokenizer.encode.assert_called_once_with('texte',add_special_tokens=False)

    def test_runtime_does_not_load_with_insufficient_memory(self):
        manager=AfricanTranslator('/unused')
        with patch('african_translation.detect_resources',return_value=SimpleNamespace(available=GIB,cpus=2)):
            with self.assertRaisesRegex(ValueError,'Mémoire'):manager.load('nllb')


if __name__=='__main__':unittest.main()
