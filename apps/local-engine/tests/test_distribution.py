import sys
import json
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3] / 'scripts'))
from windows_installer import copy_distribution
from validate_translation import write_report, validate
from test_service import RecordingEngine
from server import LocalService, EXTENSION_ORIGIN
from websockets.asyncio.server import serve

class DistributionTests(unittest.TestCase):
    def test_update_preserves_models_environment_and_vocabulary(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); source=root/'package'; destination=root/'installed'
            for name,value in [('extension/manifest.json','{}'),('moteur-local/server.py','new engine'),('moteur-local/VOCABULAIRE.txt','default')]:
                p=source/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(value)
            for name,value in [('moteur-local/models/weights.bin','keep model'),('moteur-local/.venv/python','keep environment'),('moteur-local/VOCABULAIRE.txt','custom vocabulary')]:
                p=destination/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(value)
            copy_distribution(source,destination)
            self.assertEqual((destination/'moteur-local/server.py').read_text(),'new engine')
            self.assertEqual((destination/'moteur-local/models/weights.bin').read_text(),'keep model')
            self.assertEqual((destination/'moteur-local/.venv/python').read_text(),'keep environment')
            self.assertEqual((destination/'moteur-local/VOCABULAIRE.txt').read_text(),'custom vocabulary')
            copy_distribution(destination,destination)
            self.assertEqual((destination/'moteur-local/VOCABULAIRE.txt').read_text(),'custom vocabulary')

    def test_report_is_safe_and_explicitly_requires_human_review(self):
        with tempfile.TemporaryDirectory() as folder:
            report={'cases':[{'id':'test','text':'<script>bad</script>','translation':'<img>','review':'human','issues':[]}], 'humanValidated':False}
            destination=write_report(report,Path(folder)/'report.json')
            content=destination.read_text()
            self.assertIn('&lt;script&gt;',content);self.assertNotIn('<script>',content)
            self.assertIn('ne prouve pas',content);self.assertFalse(json.loads(destination.with_suffix('.json').read_text())['humanValidated'])

class RealProtocolValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_runner_reads_actual_socket_results_without_inventing_quality(self):
        server=await serve(LocalService(RecordingEngine()).handle,'127.0.0.1',0,origins=[EXTENSION_ORIGIN])
        try:
            url=f'ws://127.0.0.1:{server.sockets[0].getsockname()[1]}'
            result=await validate([{'id':'control','source':'en','target':'fr','text':'We have 3 maps.','review':'check 3'}],url)
            self.assertEqual(result['cases'][0]['translation'],'Traduit : We have 3 maps.')
            self.assertFalse(result['humanValidated']);self.assertFalse(result['cases'][0]['humanValidated'])
            self.assertIn('queueMs',result['cases'][0]);self.assertIn('responseSeconds',result['cases'][0])
        finally:
            server.close();await server.wait_closed()
