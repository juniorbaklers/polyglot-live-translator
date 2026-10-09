import sys
import unittest
import json
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from terminology import validate_terms, matching_terms, translate_with_terms
from preferences import validate_preferences
from ai_experts import LocalExpert, choose_installed_model, local_request
from engine import LocalEngine
from neural_voice import NeuralVoice
from resources import GIB


def terms(source='en', target='fr', term='deep learning', translation='apprentissage profond', domain='*'):
    return validate_terms({'version': 1, 'entries': [dict(source=source,target=target,term=term,translation=translation,domain=domain)]})


class TerminologyTests(unittest.TestCase):
    def test_future_language_codes_and_schema_roundtrip(self):
        value = terms('de', 'pt-br', 'Neuron', 'neurônio')
        self.assertEqual(validate_preferences({'terminology': json.loads(json.dumps(value))})['terminology'], value)
        for code in ('auto', '../fr', 'FR', '', 'en/cloud'):
            with self.assertRaises(ValueError): terms(source=code)
        with self.assertRaises(ValueError): validate_terms({'version':2,'entries':[]})
        with self.assertRaises(ValueError): validate_terms({'version':1,'entries':[value['entries'][0]]*2})

    def test_pair_domain_longest_match_and_word_boundaries(self):
        entries = terms()['entries'] + terms(term='learning',translation='apprentissage')['entries'] + terms(translation='DL',domain='ia')['entries']
        matches = matching_terms(entries,'deep learning and learning, relearning','en','fr','ia')
        self.assertEqual([item['translation'] for _,_,item in matches], ['DL','apprentissage'])
        self.assertEqual(matching_terms(entries,'deep learning','fr','en','ia'), [])
        self.assertEqual(matching_terms(entries,'deep learning','en','fr','general')[0][2]['translation'],'apprentissage profond')

    def test_unicode_casefold_does_not_destroy_original_spelling(self):
        entries=terms('de','fr','Straße','rue')['entries']
        self.assertEqual(matching_terms(entries,'Die Straße','de','fr','general')[0][2]['translation'],'rue')

    def test_chinese_terms_inside_unspaced_text(self):
        value = terms('zh','es','深度学习','aprendizaje profundo')['entries']
        found = matching_terms(value,'这是深度学习课程','zh','es','general')
        self.assertEqual([(a,b) for a,b,_ in found],[(2,6)])

    def test_marker_preservation_and_fallback_when_marker_is_destroyed(self):
        entries = terms()['entries']; text='We use deep learning.'
        matches = matching_terms(entries,text,'en','fr','general')
        self.assertEqual(translate_with_terms(text,matches,lambda text: text.replace('We use','Nous utilisons')), 'Nous utilisons apprentissage profond.')
        calls=[]
        def translate(text):
            calls.append(text)
            return 'marqueur perdu' if 'ZXQ' in text else {'We use':'Nous utilisons','.':'.'}[text]
        self.assertEqual(translate_with_terms(text,matches,translate), 'Nous utilisons apprentissage profond.')
        self.assertEqual(calls[1:], ['We use','.'])

    def test_engine_applies_terms_but_exact_phrase_correction_has_priority(self):
        engine = LocalEngine.__new__(LocalEngine)
        engine.configure_session({'terminology': terms()}); engine.reset_session()
        class Translator:
            def hypotheses(self,text,num_hypotheses): return [SimpleNamespace(value=text.replace('We use','Nous utilisons'))]
        translator = Translator()
        engine.languages = {code:SimpleNamespace(get_translation=lambda _:translator) for code in ('en','fr')}
        self.assertEqual(engine.translate_text('We use deep learning.','en','fr',True), 'Nous utilisons apprentissage profond.')
        engine.configure_session({'terminology':terms(),'corrections':[dict(source='en',target='fr',original='We use deep learning.',translation='Correction préférée')]})
        self.assertEqual(engine.translate_text('We use deep learning.','en','fr',True), 'Correction préférée')


class ExpertTests(unittest.TestCase):
    def test_engine_uses_expert_only_for_final_and_keeps_terms_on_failure(self):
        from unittest.mock import Mock
        engine=LocalEngine.__new__(LocalEngine)
        engine.configure_session({'translationEngine':'ollama','terminology':terms()});engine.reset_session()
        translator=Mock();translator.hypotheses.side_effect=lambda text,num_hypotheses:[SimpleNamespace(value=text)]
        engine.languages={code:SimpleNamespace(get_translation=lambda _:translator) for code in ('en','fr')}
        expert=Mock();expert.warning=None;expert.translate.return_value='Traduction IA'
        engine.expert=expert
        draft=engine.translate_text('deep learning','en','fr',False)
        self.assertEqual(draft,'apprentissage profond');expert.translate.assert_not_called()
        self.assertEqual(engine.translate_text('deep learning','en','fr',True),'Traduction IA')
        engine.translation_cache.clear();expert.translate.return_value=None;expert.warning='Repli local'
        self.assertEqual(engine.translate_text('deep learning','en','fr',True),'apprentissage profond')
        self.assertEqual(engine.take_notices(),['Repli local']);self.assertEqual(engine.take_notices(),[])

    def test_ram_budget_never_downloads_and_excludes_cloud_embeddings(self):
        models=[{'name':'small:local','size':GIB},{'name':'large:local','size':8*GIB},{'name':'embed:local','size':GIB},{'name':'small:cloud','size':GIB}]
        self.assertEqual(choose_installed_model(models,6*GIB),'small:local')
        self.assertIsNone(choose_installed_model(models,GIB))

    def test_json_prompt_contains_pair_domain_terminology_context(self):
        expert=LocalExpert(validate_preferences({'translationEngine':'ollama','expert':'technical'}))
        entries=terms()['entries']; matches=matching_terms(entries,'deep learning','en','fr','ia')
        calls=[]
        def request(path,payload=None):
            calls.append((path,payload))
            if path=='/api/tags': return {'models':[{'name':'small:local','size':GIB}]}
            if path=='/api/show': return {'model_info':{'architecture':'test'},'capabilities':['completion']}
            return {'message':{'content':json.dumps({'translation':'apprentissage profond'})}}
        with patch('ai_experts.local_request',side_effect=request), patch('ai_experts.detect_resources',return_value=SimpleNamespace(available=6*GIB)):
            self.assertEqual(expert.translate('deep learning','en','fr','ia',matches,[('previous','précédent')]), 'apprentissage profond')
        payload=calls[-1][1]
        user=json.loads(payload['messages'][1]['content'])
        self.assertEqual(user['target_language'],'fr'); self.assertEqual(user['terminology'][0]['target'],'apprentissage profond')
        self.assertFalse(payload['stream']); self.assertEqual(user['previous_context'],[['previous','précédent']])

    def test_remote_alias_rejected_before_sending_any_text(self):
        expert=LocalExpert(validate_preferences({'translationEngine':'ollama','aiModel':'alias:local'}))
        with patch('ai_experts.local_request',side_effect=[{'models':[{'name':'alias:local','size':1}]},{'remote_model':'cloud','model_info':{}}]) as request:
            self.assertIsNone(expert.translate('secret','en','fr','general',[],[]))
            self.assertEqual(request.call_count,2)
            self.assertTrue(expert.disabled)
            self.assertIsNone(expert.translate('another','en','fr','general',[],[]))
            self.assertEqual(request.call_count,2)

    def test_network_timeout_bad_json_and_missing_terms_trigger_session_fallback(self):
        for response in (OSError('timeout'), {'message':{'content':'broken json'}}, {'message':{'content':'{"translation":"wrong"}'}}):
            with self.subTest(response=response):
                expert=LocalExpert(validate_preferences({'translationEngine':'ollama'})); expert.model='local'
                matches=matching_terms(terms()['entries'],'deep learning','en','fr','ia')
                with patch('ai_experts.local_request',side_effect=response if isinstance(response,Exception) else None,return_value=response):
                    self.assertIsNone(expert.translate('deep learning','en','fr','ia',matches,[]))
                    self.assertIn('Repli',expert.warning); self.assertTrue(expert.disabled)

    def test_local_transport_ignores_proxy_and_does_not_follow_redirect(self):
        class Response:
            status=302
            def read(self,limit):return b'{}'
        with patch('ai_experts.http.client.HTTPConnection') as factory:
            factory.return_value.getresponse.return_value=Response()
            with self.assertRaises(ValueError):local_request('/api/tags')
            factory.assert_called_once_with('127.0.0.1',11434,timeout=8)
            factory.return_value.close.assert_called_once()


class VoiceTests(unittest.TestCase):
    def test_voice_missing_and_path_traversal_are_recoverable(self):
        voice=NeuralVoice('/tmp/no-polyglot-voice-here')
        for language in ('fr','../fr'):
            with self.assertRaises(ValueError):voice.synthesize('Bonjour',language)
        with self.assertRaises(ValueError):voice.synthesize('x'*2001,'fr')

    def test_actual_adapter_produces_wav_and_caches_one_language(self):
        import tempfile
        import wave
        import base64
        import io
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'fr.onnx').touch();(root/'fr.onnx.json').write_text('{}')
            class FakeVoice:
                @staticmethod
                def load(path,use_cuda):return FakeVoice()
                def synthesize_wav(self,text,output):
                    output.setnchannels(1);output.setsampwidth(2);output.setframerate(22050);output.writeframes(b'\0\0'*200)
            with patch.dict(sys.modules,{'piper':SimpleNamespace(PiperVoice=FakeVoice)}):
                voice=NeuralVoice(root)
                audio=voice.synthesize('Bonjour','fr'); loaded=voice.loaded
                voice.synthesize('Salut','fr');self.assertIs(voice.loaded,loaded)
                with wave.open(io.BytesIO(base64.b64decode(audio))) as wav:self.assertEqual(wav.getframerate(),22050)

if __name__=='__main__':unittest.main()
