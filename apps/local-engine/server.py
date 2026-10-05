"""Service local gratuit, compatible avec la capture de l'extension Polyglot."""
import asyncio
import base64
import binascii
import json
import secrets
import time
import math
from caption_buffer import CaptionBuffer
from preferences import validate_preferences

HOST = "127.0.0.1"
PORT = 47833  # Distinct du serveur Windows historique utilisant une API payante.
ENGINE_ID = "polyglot-local-free-v4"
MAX_AUDIO_BYTES = 2_000_000


class LocalService:
    def __init__(self, engine, code=None):
        self.engine = engine
        self.code = code or f"{secrets.randbelow(1_000_000):06d}"
        self.active_connection = None

    async def handle(self, socket):
        token = None
        capturing = False
        source, target = "auto", "fr"
        input_mode = "audio"
        captions = CaptionBuffer(self.engine.translate_text)
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
                        if message.get("code") != self.code or not message.get("extensionId"):
                            await send({"type": "pair.rejected", "reason": "Code d’association incorrect"})
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
                        if source not in {"auto", "en", "fr", "es"} or target not in {"en", "fr", "es"}:
                            raise ValueError("Langues installées : anglais, français, espagnol")
                        input_mode = options.get("inputMode", "audio")
                        if input_mode not in {"audio", "captions"}:
                            raise ValueError("Mode d’entrée invalide")
                        preferences = validate_preferences(options)
                        if hasattr(self.engine, "configure_session"):
                            self.engine.configure_session(preferences)
                        self.engine.reset_session()
                        captions = CaptionBuffer(self.engine.translate_text)
                        capturing = True
                        await send({"type": "state", "state": "capturing", "detail": "Moteur local gratuit connecté"})
                    elif kind == "session.stop":
                        results = await asyncio.to_thread(captions.finish) if input_mode == "captions" else await asyncio.to_thread(self.engine.finish, target)
                        for result in results:
                            await send({"type": "subtitle", **result})
                        capturing = False
                        await send({"type": "state", "state": "stopped"})
                    elif kind == "text.chunk":
                        if not capturing or input_mode != "captions":
                            raise ValueError("Session de sous-titres requise")
                        text = message.get("text")
                        language = message.get("language", source)
                        start, end = message.get("start"), message.get("end")
                        if not isinstance(text, str) or not text.strip() or len(text) > 4000:
                            raise ValueError("Sous-titre vide ou trop long")
                        if language not in {"en", "fr", "es"}:
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


async def main():
    from websockets.asyncio.server import serve
    from offline_guard import enable
    enable()
    from engine import LocalEngine
    print("Chargement des modèles locaux…", flush=True)
    service = LocalService(LocalEngine())
    # Origin absent accepté pour les clients locaux ; les pages web ordinaires sont refusées.
    import re
    async with serve(service.handle, HOST, PORT,
                     origins=[None, re.compile(r"chrome-extension://[a-p]{32}")],
                     max_size=3_000_000, max_queue=4, compression=None):
        print(f"\nPOLYGLOT LOCAL — PRÊT\nCode d’association : {service.code}\n"
              "Transcription et traduction locales. Aucun appel à une API payante.\n"
              "Gardez cette fenêtre ouverte. Ctrl+C pour arrêter.\n", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(f"Démarrage impossible : {error}\nRelancez INSTALLER.cmd si les modèles manquent.", flush=True)
        raise SystemExit(1)
