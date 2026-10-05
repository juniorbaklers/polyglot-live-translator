import asyncio
import base64
import json
import sys
import unittest
import subprocess
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import LocalService, ENGINE_ID, EXTENSION_ORIGIN
from websockets.asyncio.server import serve
from websockets.asyncio.client import connect


class RecordingEngine:
    """Double de test : vérifie le routage sans télécharger de modèles IA."""
    def __init__(self): self.calls = []; self.resets = 0
    def reset_session(self): self.resets += 1
    def finish(self, target): return []
    def translate_text(self, text, language, target):
        self.calls.append((text, language, target)); return "Traduit : " + text
    def configure_session(self, preferences): self.preferences = preferences
    def process(self, audio, source, target):
        self.calls.append((audio, source, target))
        return [{"id": "test-phrase", "revision": 1, "original": "Recognized text", "translation": "Texte traduit", "final": False}]


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = RecordingEngine()
        self.service = LocalService(self.engine)
        self.server = await serve(self.service.handle, "127.0.0.1", 0, origins=[EXTENSION_ORIGIN])
        self.url = f"ws://127.0.0.1:{self.server.sockets[0].getsockname()[1]}"

    async def asyncTearDown(self):
        self.server.close(); await self.server.wait_closed()

    async def send(self, socket, value): await socket.send(json.dumps(value))
    async def receive(self, socket): return json.loads(await asyncio.wait_for(socket.recv(), 3))
    async def pair(self, socket):
        await self.send(socket, {"type":"pair.request","extensionId":"a" * 32})
        response = await self.receive(socket)
        self.assertEqual(response["engine"], ENGINE_ID)
        return response["token"]

    async def test_real_socket_transports_audio_to_engine_and_returns_result(self):
        async with connect(self.url, origin="chrome-extension://" + "a" * 32) as socket:
            token = await self.pair(socket)
            await self.send(socket, {"type":"session.start","token":token,"options":{"sourceLanguage":"en","targetLanguage":"fr"}})
            self.assertEqual((await self.receive(socket))["state"], "capturing")
            await self.send(socket, {"type":"audio.chunk","token":token,"sequence":4,"data":base64.b64encode(b"audio-bytes").decode()})
            subtitle = await self.receive(socket)
            self.assertEqual(subtitle["translation"], "Texte traduit")
            self.assertEqual(subtitle["sequence"], 4)
            self.assertEqual(subtitle["id"], "test-phrase")
            self.assertFalse(subtitle["final"])
            self.assertEqual((await self.receive(socket))["type"], "audio.ack")
            self.assertEqual(self.engine.calls, [(b"audio-bytes", "en", "fr")])
            self.assertEqual(self.engine.resets, 1)
            await self.send(socket,{"type":"session.stop","token":token})
            self.assertEqual((await self.receive(socket))["state"],"stopped")

    async def test_chinese_source_and_target_are_transported_over_real_socket(self):
        async with connect(self.url, origin="chrome-extension://" + "a" * 32) as socket:
            token = await self.pair(socket)
            await self.send(socket, {"type":"session.start","token":token,"options":{"sourceLanguage":"en","targetLanguage":"zh"}})
            self.assertEqual((await self.receive(socket))["state"], "capturing")
            await self.send(socket, {"type":"audio.chunk","token":token,"data":base64.b64encode(b"audio").decode()})
            await self.receive(socket); await self.receive(socket)
            self.assertEqual(self.engine.calls[-1], (b"audio", "en", "zh"))
            await self.send(socket, {"type":"session.start","token":token,"options":{"sourceLanguage":"zh","targetLanguage":"fr","inputMode":"captions"}})
            await self.receive(socket)
            await self.send(socket, {"type":"text.chunk","token":token,"text":"你好。","language":"zh","start":0,"end":2})
            result = await self.receive(socket)
            self.assertTrue(result['final'])
            self.assertEqual(result['sourceLanguage'], 'zh')
            self.assertEqual(self.engine.calls[-1], ('你好。', 'zh', 'fr'))
            await self.receive(socket)

    async def test_caption_mode_translates_text_without_audio_and_preserves_video_times(self):
        async with connect(self.url, origin="chrome-extension://" + "a" * 32) as socket:
            token = await self.pair(socket)
            await self.send(socket, {"type":"session.start","token":token,"options":{"inputMode":"captions","sourceLanguage":"en","targetLanguage":"fr","glossary":"QGIS"}})
            await self.receive(socket)
            await self.send(socket, {"type":"text.chunk","token":token,"text":"A map", "language":"en","start":12.5,"end":15,"sequence":2})
            result = await self.receive(socket)
            self.assertEqual(result['translation'], 'Traduit : A map')
            self.assertEqual(result['start'], 12.5)
            self.assertEqual(result['timing'], 'video')
            self.assertFalse(result['final'])
            ack = await self.receive(socket)
            self.assertEqual(ack['sequence'], 2)
            self.assertIn('processingMs', ack)
            self.assertEqual(self.engine.calls, [('A map', 'en', 'fr')])
            self.assertEqual(self.engine.preferences['glossary'], 'QGIS')
            await self.send(socket, {"type":"audio.chunk","token":token,"data":"YQ=="})
            self.assertEqual((await self.receive(socket))['type'], 'error')

    async def test_caption_rejects_invalid_ranges_languages_and_oversized_preferences(self):
        async with connect(self.url, origin="chrome-extension://" + "a" * 32) as socket:
            token = await self.pair(socket)
            await self.send(socket, {"type":"session.start","token":token,"options":{"glossary":"x" * 1501}})
            self.assertEqual((await self.receive(socket))['type'], 'error')
            await self.send(socket, {"type":"session.start","token":token,"options":{"inputMode":"captions"}})
            await self.receive(socket)
            cue = {"type":"text.chunk","token":token,"text":"words","language":"en","start":1,"end":2}
            for bad in ({"end":0}, {"language":"auto"}, {"text":"x" * 4001}, {"start":float('nan')}, {"start":True}):
                await self.send(socket, {**cue, **bad})
                self.assertEqual((await self.receive(socket))['type'], 'error')
            self.assertEqual(self.engine.calls, [])

    async def test_reject_mismatched_extension_and_audio_before_connection(self):
        async with connect(self.url, origin="chrome-extension://" + "a" * 32) as socket:
            await self.send(socket,{"type":"pair.request","extensionId":"b" * 32})
            self.assertEqual((await self.receive(socket))["type"],"pair.rejected")
            await self.send(socket,{"type":"audio.chunk","token":"x","data":"YQ=="})
            self.assertEqual((await self.receive(socket))["type"],"error")
            self.assertEqual(self.engine.calls,[])

    async def test_stop_delivers_final_revision_before_stopped_state(self):
        self.engine.finish = lambda target: [{"id": "test-phrase", "revision": 2,
            "original": "Recognized text.", "translation": "Texte traduit.", "final": True}]
        async with connect(self.url, origin="chrome-extension://" + "a" * 32) as socket:
            token = await self.pair(socket)
            await self.send(socket, {"type": "session.start", "token": token, "options": {"sourceLanguage": "en", "targetLanguage": "fr"}})
            await self.receive(socket)
            await self.send(socket, {"type": "audio.chunk", "token": token, "data": "YQ=="})
            self.assertFalse((await self.receive(socket))["final"])
            await self.receive(socket)
            await self.send(socket, {"type": "session.stop", "token": token})
            final = await self.receive(socket)
            self.assertEqual(final["id"], "test-phrase")
            self.assertEqual(final["revision"], 2)
            self.assertTrue(final["final"])
            self.assertEqual((await self.receive(socket))["state"], "stopped")

    async def test_reject_invalid_audio_and_stale_token(self):
        async with connect(self.url, origin="chrome-extension://" + "a" * 32) as socket:
            token=await self.pair(socket)
            await self.send(socket,{"type":"session.start","token":token,"options":{}});await self.receive(socket)
            await self.send(socket,{"type":"audio.chunk","token":token,"data":"!!!"})
            self.assertEqual((await self.receive(socket))["type"],"error")
        async with connect(self.url, origin="chrome-extension://" + "a" * 32) as socket:
            await self.send(socket,{"type":"session.start","token":token})
            self.assertEqual((await self.receive(socket))["type"],"error")
        self.assertEqual(self.engine.calls,[])

    async def test_single_capture_and_language_validation(self):
        async with connect(self.url, origin="chrome-extension://" + "a" * 32) as first, connect(self.url, origin="chrome-extension://" + "a" * 32) as second:
            token=await self.pair(first)
            await self.send(second,{"type":"pair.request","extensionId":"a" * 32})
            self.assertEqual((await self.receive(second))["type"],"pair.rejected")
            await self.send(first,{"type":"session.start","token":token,"options":{"targetLanguage":"xx"}})
            self.assertEqual((await self.receive(first))["type"],"error")
        self.assertEqual(self.engine.calls,[])

    async def test_web_pages_and_missing_origin_rejected_before_session(self):
        from websockets.exceptions import InvalidStatus
        for origin in (None, 'null', 'https://example.com', 'chrome-extension://invalid'):
            with self.assertRaises(InvalidStatus):
                async with connect(self.url, origin=origin): pass
        self.assertEqual(self.engine.calls, [])

    async def test_fresh_token_and_no_code_needed_on_reconnect(self):
        async with connect(self.url, origin='chrome-extension://' + 'a' * 32) as socket:
            first = await self.pair(socket)
        async with connect(self.url, origin='chrome-extension://' + 'a' * 32) as socket:
            second = await self.pair(socket)
            self.assertNotEqual(first, second)
            await self.send(socket, {'type':'session.start','token':first})
            self.assertEqual((await self.receive(socket))['type'], 'error')


class OfflineTests(unittest.TestCase):
    def test_outbound_network_is_blocked_but_localhost_works(self):
        code = """
from offline_guard import enable
import socket
enable()
listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen()
client=socket.socket();client.connect(listener.getsockname())
peer,_=listener.accept();client.close();peer.close();listener.close()
try:
    socket.getaddrinfo('api.openai.com',443)
    raise AssertionError('DNS distant autorisé')
except OSError:
    pass
try:
    socket.socket().connect(('8.8.8.8',443))
    raise AssertionError('Connexion distante autorisée')
except OSError:
    pass
"""
        result=subprocess.run([sys.executable,"-c",code],cwd=Path(__file__).resolve().parents[1],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)


if __name__ == "__main__": unittest.main()
