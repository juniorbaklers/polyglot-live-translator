"""Service local gratuit, compatible avec la capture de l'extension Polyglot."""
import asyncio
import base64
import binascii
import json
import secrets
import time
import math
import re
from caption_buffer import CaptionBuffer
from startup import single_instance
from preferences import validate_preferences
from languages import LANGUAGES, AFRICAN_LANGUAGES
from neural_voice import NeuralVoice
from pathlib import Path
from websockets.exceptions import ConnectionClosed

HOST = "127.0.0.1"
PORT = 47833  # Distinct du serveur Windows historique utilisant une API payante.
ENGINE_ID = "polyglot-local-free-v12"
EXTENSION_ORIGIN = re.compile(r"chrome-extension://[a-p]{32}")
MAX_AUDIO_BYTES = 2_000_000


class LocalService:
    def __init__(self, engine):
        self.engine = engine
        self.active_connection = None
        self.voice_jobs = set()
        self.voice = NeuralVoice(Path(__file__).resolve().parent / "models" / "voices")

    async def handle(self, socket):
        token = None
        capturing = False
        source, target = "auto", "fr"
        input_mode = "audio"
        closing = False
        voice_epoch = 0
        commands = asyncio.Queue(maxsize=8)
        captions = CaptionBuffer(self.engine.translate_text,
                                 getattr(self.engine, "translate_final_caption", None),
                                 getattr(self.engine, "reset_translation_context", None))
        async def send(message):
            nonlocal closing
            if closing:
                return
            try:
                await socket.send(json.dumps(message, ensure_ascii=False))
                if message.get("type") == "audio.ack" and hasattr(self.engine, "take_notices"):
                    for detail in self.engine.take_notices():
                        await socket.send(json.dumps({"type": "notice", "message": detail}, ensure_ascii=False))
            except ConnectionClosed:
                closing = True
        async def process_message(message, received_at):
            nonlocal token, capturing, source, target, input_mode, captions
            try:
                kind = message.get("type")
                if kind == "pair.request":
                    origin = socket.request.headers.get("Origin", "")
                    extension_id = message.get("extensionId")
                    if not EXTENSION_ORIGIN.fullmatch(origin) or origin != f"chrome-extension://{extension_id}":
                        await send({"type": "pair.rejected", "reason": "Connexion réservée aux extensions locales compatibles"})
                        return
                    if self.active_connection not in (None, socket):
                        await send({"type": "pair.rejected", "reason": "Un autre onglet est déjà associé"})
                        return
                    token = secrets.token_urlsafe(32)
                    self.active_connection = socket
                    await send({"type": "pair.accepted", "token": token, "engine": ENGINE_ID})
                    return
                if token is None or message.get("token") != token:
                    raise ValueError("Association requise ou jeton incorrect")
                if kind == "session.start":
                    options = message.get("options", {})
                    source, target = options.get("sourceLanguage", "auto"), options.get("targetLanguage", "fr")
                    if source not in (LANGUAGES | {"auto"}) or target not in LANGUAGES:
                        raise ValueError("Code de langue non pris en charge")
                    input_mode = options.get("inputMode", "audio")
                    if input_mode not in {"audio", "captions", "page"}:
                        raise ValueError("Mode d’entrée invalide")
                    if input_mode == "page" and source == "auto":
                        raise ValueError("Choisissez la langue originale de la page")
                    if input_mode == "audio" and source in AFRICAN_LANGUAGES:
                        raise ValueError("Dioula, baoulé et wolof en langue source : choisissez Sous-titres accessibles du lecteur. Reconnaissance audio non disponible.")
                    if hasattr(self.engine, "require_languages"):
                        self.engine.require_languages(source, target)
                    translate_drafts = options.get("translateDrafts", True)
                    if not isinstance(translate_drafts, bool):
                        raise ValueError("Mode de lecture invalide")
                    preferences = validate_preferences(options)
                    if hasattr(self.engine, "configure_session"):
                        self.engine.configure_session({**preferences, "translateDrafts": translate_drafts})
                    self.engine.reset_session()
                    captions = CaptionBuffer(self.engine.translate_text,
                             getattr(self.engine, "translate_final_caption", None),
                             getattr(self.engine, "reset_translation_context", None))
                    captions.translate_drafts = translate_drafts
                    capturing = True
                    await send({"type": "state", "state": "capturing", "detail": "Moteur local gratuit connecté"})
                elif kind == "voice.synthesize":
                    if not capturing:
                        raise ValueError("Session active requise")
                    request_id = message.get("id")
                    if not isinstance(request_id, int) or isinstance(request_id, bool) or request_id < 0:
                        raise ValueError("Identifiant vocal invalide")
                    if self.voice_jobs:
                        await send({"type": "voice.result", "id": request_id, "error": "Une synthèse vocale est déjà en cours"})
                        return
                    epoch = voice_epoch
                    async def synthesize():
                        try:
                            audio = await asyncio.to_thread(self.voice.synthesize, message.get("text"), message.get("language"))
                            reply = {"type": "voice.result", "id": request_id, "audio": audio}
                        except Exception as error:
                            reply = {"type": "voice.result", "id": request_id, "error": str(error)}
                        if not closing and capturing and epoch == voice_epoch:
                            try:
                                await send(reply)
                            except Exception:
                                pass  # client fermé pendant la synthèse
                    job = asyncio.create_task(synthesize())
                    self.voice_jobs.add(job)
                    job.add_done_callback(self.voice_jobs.discard)
                elif kind == "session.stop":
                    results = [] if input_mode == "page" else (await asyncio.to_thread(captions.finish) if input_mode == "captions" else await asyncio.to_thread(self.engine.finish, target))
                    for result in results:
                        await send({"type": "subtitle", **result})
                    capturing = False
                    await send({"type": "state", "state": "stopped"})
                elif kind == "session.reading":
                    value = message.get("translateDrafts")
                    if not capturing or not isinstance(value, bool):
                        raise ValueError("Mode de lecture invalide")
                    self.engine.translate_drafts = value
                    captions.translate_drafts = value
                elif kind == "text.flush":
                    position = message.get("position")
                    if not capturing or input_mode != "captions":
                        raise ValueError("Session de sous-titres requise")
                    if isinstance(position, bool) or not isinstance(position, (int, float)) or not math.isfinite(position) or position < 0:
                        raise ValueError("Position vidéo invalide")
                    started = time.perf_counter()
                    results = await asyncio.to_thread(captions.flush_expired, position)
                    for result in results:
                        await send({"type": "subtitle", **result})
                    await send({"type": "audio.ack", "sequence": message.get("sequence", 0),
                                "processingMs": round((time.perf_counter() - started) * 1000),
                                    "queueMs": round((started - received_at) * 1000)})
                elif kind == "page.chunk":
                    if not capturing or input_mode != "page":
                        raise ValueError("Session de page web requise")
                    text = message.get("text")
                    request_id = message.get("id")
                    if not isinstance(text, str) or not text.strip() or len(text) > 4000:
                        raise ValueError("Texte de page vide ou trop long")
                    if isinstance(request_id, bool) or not isinstance(request_id, int) or request_id < 0:
                        raise ValueError("Identifiant de passage invalide")
                    translate = getattr(self.engine, "translate_final_caption", None)
                    value = await asyncio.to_thread(translate, text.strip(), source, target, False) if translate else await asyncio.to_thread(self.engine.translate_text, text.strip(), source, target)
                    if not isinstance(value, str) or not value.strip():
                        raise ValueError("Traduction vide : texte original conservé")
                    notices = self.engine.take_notices() if hasattr(self.engine, "take_notices") else []
                    await send({"type": "page.result", "id": request_id, "translation": value, "notices": notices})
                elif kind == "text.chunk":
                    if not capturing or input_mode != "captions":
                        raise ValueError("Session de sous-titres requise")
                    text = message.get("text")
                    language = message.get("language", source)
                    start, end = message.get("start"), message.get("end")
                    if not isinstance(text, str) or not text.strip() or len(text) > 4000:
                        raise ValueError("Sous-titre vide ou trop long")
                    if language not in LANGUAGES:
                        raise ValueError("Choisissez la langue originale des sous-titres")
                    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in (start, end)) or not 0 <= start < end:
                        raise ValueError("Repères de sous-titres invalides")
                    started = time.perf_counter()
                    results = await asyncio.to_thread(captions.process, text.strip(), language, target, start, end)
                    for result in results:
                        await send({"type": "subtitle", **result})
                    await send({"type": "audio.ack", "sequence": message.get("sequence", 0),
                                "processingMs": round((time.perf_counter() - started) * 1000),
                                    "queueMs": round((started - received_at) * 1000)})
                elif kind == "audio.chunk":
                    if not capturing or input_mode != "audio":
                        raise ValueError("Démarrez la session avant d’envoyer l’audio")
                    encoded = message.get("data")
                    if not isinstance(encoded, str) or len(encoded) > MAX_AUDIO_BYTES * 4 // 3 + 4:
                        raise ValueError("Segment audio trop volumineux ou invalide")
                    audio = base64.b64decode(encoded, validate=True)
                    if not audio or len(audio) > MAX_AUDIO_BYTES:
                        raise ValueError("Segment audio vide ou trop volumineux")
                    try:
                        started = time.perf_counter()
                        results = await asyncio.to_thread(self.engine.process, audio, source, target)
                        elapsed = time.perf_counter() - started
                        print(f"Extrait {message.get('sequence', 0)} : {elapsed:.1f} s — "
                              f"{len(results)} mise(s) à jour", flush=True)
                        for result in results:
                            await send({"type": "subtitle", "sequence": message.get("sequence", 0), **result})
                    finally:
                        await send({"type": "audio.ack", "sequence": message.get("sequence", 0),
                                    "processingMs": round((time.perf_counter() - started) * 1000),
                                    "queueMs": round((started - received_at) * 1000)})
                else:
                    raise ValueError("Message local non reconnu")
            except (ValueError, TypeError, binascii.Error) as error:
                await send({"type": "error", "message": str(error)})
            except Exception as error:
                await send({"type": "error", "message": f"Traitement local impossible : {error}"})

        async def engine_worker():
            # Un seul propriétaire de l'état ASR/traduction : ordre conservé.
            while True:
                entry = await commands.get()
                try:
                    if entry is None:
                        return
                    await process_message(*entry)
                finally:
                    commands.task_done()

        worker = asyncio.create_task(engine_worker())
        try:
            async for raw in socket:
                try:
                    message = json.loads(raw)
                    if not isinstance(message, dict):
                        raise ValueError("Message invalide")
                    kind = message.get("type")
                    if kind == "pair.request":
                        if token is not None:
                            raise ValueError("Connexion déjà associée")
                        await process_message(message, time.perf_counter())
                        continue
                    if token is None or message.get("token") != token:
                        raise ValueError("Association requise ou jeton incorrect")
                    if kind == "voice.synthesize":
                        # La voix possède son travailleur ; elle ne bloque ni
                        # la réception ni la reconnaissance des prochains fichiers.
                        await process_message(message, time.perf_counter())
                        continue
                    if kind in {"session.stop", "session.start"}:
                        voice_epoch += 1  # ignorer les réponses vocales périmées
                    await commands.put((message, time.perf_counter()))
                except (ValueError, TypeError, binascii.Error) as error:
                    await send({"type": "error", "message": str(error)})
        finally:
            closing = True
            voice_epoch += 1
            # Ne pas libérer le moteur pendant un to_thread encore en cours.
            # Les fichiers acceptés sont traités avant l'arrêt du travailleur.
            await commands.put(None)
            await worker
            if self.active_connection is socket:
                self.active_connection = None


async def serve_local():
    from websockets.asyncio.server import serve
    from offline_guard import enable
    enable()
    from engine import LocalEngine
    print("Chargement des modèles locaux…", flush=True)
    service = LocalService(LocalEngine())
    # Sans code : aucune page web et aucun client sans Origin ne sont acceptés.
    async with serve(service.handle, HOST, PORT,
                     origins=[EXTENSION_ORIGIN],
                     max_size=3_000_000, max_queue=4, compression=None):
        print(f"\nPOLYGLOT LOCAL — PRÊT\nConnexion automatique à l’extension, sans code.\n"
              "Transcription et traduction locales. Aucun appel à une API payante.\n"
              "Lanceur manuel : gardez cette fenêtre ouverte. Ctrl+C pour arrêter.\n", flush=True)
        await asyncio.Future()


async def main():
    with single_instance():
        await serve_local()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(f"Démarrage impossible : {error}\nSi le moteur est déjà lancé, utilisez directement l’extension. Si les modèles manquent, lancez INSTALLER.cmd.", flush=True)
        raise SystemExit(1)
