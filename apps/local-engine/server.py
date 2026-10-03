"""Service local gratuit, compatible avec la capture de l'extension Polyglot."""
import asyncio
import base64
import binascii
import json
import secrets

HOST = "127.0.0.1"
PORT = 47833  # Distinct du serveur Windows historique utilisant une API payante.
ENGINE_ID = "polyglot-local-free-v1"
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
                        capturing = True
                        await send({"type": "state", "state": "capturing", "detail": "Moteur local gratuit connecté"})
                    elif kind == "session.stop":
                        capturing = False
                        await send({"type": "state", "state": "stopped"})
                    elif kind == "audio.chunk":
                        if not capturing:
                            raise ValueError("Démarrez la session avant d’envoyer l’audio")
                        encoded = message.get("data")
                        if not isinstance(encoded, str) or len(encoded) > MAX_AUDIO_BYTES * 4 // 3 + 4:
                            raise ValueError("Segment audio trop volumineux ou invalide")
                        audio = base64.b64decode(encoded, validate=True)
                        if not audio or len(audio) > MAX_AUDIO_BYTES:
                            raise ValueError("Segment audio vide ou trop volumineux")
                        try:
                            original, translation = await asyncio.to_thread(self.engine.process, audio, source, target)
                            if original:
                                await send({"type": "subtitle", "sequence": message.get("sequence", 0), "original": original, "translation": translation, "final": True})
                        finally:
                            await send({"type": "audio.ack", "sequence": message.get("sequence", 0)})
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
