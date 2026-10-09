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
from languages import LANGUAGES

HOST = "127.0.0.1"
PORT = 47833  # Distinct du serveur Windows historique utilisant une API payante.
ENGINE_ID = "polyglot-local-free-v7"
EXTENSION_ORIGIN = re.compile(r"chrome-extension://[a-p]{32}")
MAX_AUDIO_BYTES = 2_000_000


class LocalService:
    def __init__(self, engine):
        self.engine = engine
        self.active_connection = None

    async def handle(self, socket):
        token = None
        capturing = False
        source, target = "auto", "fr"
        input_mode = "audio"
        captions = CaptionBuffer(self.engine.translate_text,
                                 getattr(self.engine, "translate_final_caption", None),
                                 getattr(self.engine, "reset_translation_context", None))
        async def send(message):
            await socket.send(json.dumps(message, ensure_ascii=False))
        try:
            async for raw in socket:
                try:
                    message = json.loads(raw)
                    if not isinstance(message, dict):
                        raise ValueError("Message invalide")
                    kind = message.get("type")
                    if kind == "pair.request":
                        origin = socket.request.headers.get("Origin", "")
                        extension_id = message.get("extensionId")
                        if not EXTENSION_ORIGIN.fullmatch(origin) or origin != f"chrome-extension://{extension_id}":
                            await send({"type": "pair.rejected", "reason": "Connexion réservée aux extensions locales compatibles"})
                            continue
                        if self.active_connection not in (None, socket):
                            await send({"type": "pair.rejected", "reason": "Un autre onglet est déjà associé"})
                            continue
                        token = secrets.token_urlsafe(32)
                        self.active_connection = socket
                        await send({"type": "pair.accepted", "token": token, "engine": ENGINE_ID})
                        continue
                    if token is None or message.get("token") != token:
                        raise ValueError("Association requise ou jeton incorrect")
                    if kind == "session.start":
                        options = message.get("options", {})
                        source, target = options.get("sourceLanguage", "auto"), options.get("targetLanguage", "fr")
                        if source not in (LANGUAGES | {"auto"}) or target not in LANGUAGES:
                            raise ValueError("Langues installées : anglais, français, espagnol, chinois simplifié")
                        if hasattr(self.engine, "require_languages"):
                            self.engine.require_languages(source, target)
                        input_mode = options.get("inputMode", "audio")
                        if input_mode not in {"audio", "captions"}:
                            raise ValueError("Mode d’entrée invalide")
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
                    elif kind == "session.stop":
                        results = await asyncio.to_thread(captions.finish) if input_mode == "captions" else await asyncio.to_thread(self.engine.finish, target)
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
                                    "processingMs": round((time.perf_counter() - started) * 1000)})
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
                                    "processingMs": round((time.perf_counter() - started) * 1000)})
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
                                        "processingMs": round((time.perf_counter() - started) * 1000)})
                    else:
                        raise ValueError("Message local non reconnu")
                except (ValueError, TypeError, binascii.Error) as error:
                    await send({"type": "error", "message": str(error)})
                except Exception as error:
                    await send({"type": "error", "message": f"Traitement local impossible : {error}"})
        finally:
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
