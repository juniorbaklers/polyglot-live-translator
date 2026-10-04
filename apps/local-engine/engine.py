"""Moteur local réel : aucun service cloud, aucune clé API, aucun texte simulé."""
import io
import os
import re
import uuid
from pathlib import Path

os.environ["ARGOS_MODEL_PROVIDER"] = "OPENNMT"
os.environ["ARGOS_DEVICE_TYPE"] = "cpu"
os.environ["ARGOS_CHUNK_TYPE"] = "STANZA"

ROOT = Path(__file__).resolve().parent
LANGUAGES = {"en", "fr", "es"}


class LocalSentenceSplitter:
    """Découpe les courts extraits audio sans modèle ni accès réseau.

    Argos 1.11 utilise ce contrat pour la segmentation, puis conserve ses
    modèles neuronaux locaux pour la traduction proprement dite.
    """

    def __init__(self, pkg):
        self.pkg = pkg

    def split_sentences(self, text):
        return [part.strip() for part in re.split(r'(?<=[.!?])\s+', text) if part.strip()]


def configure_local_translation(module):
    # Stanza rafraîchit resources.json à chaque nouveau processus, même si
    # ses modèles ont été préchargés. Les courts extraits audio ne
    # nécessitent pas ce détecteur : remplacer le point d'extension Argos
    # avant de construire les traductions évite ce téléchargement implicite.
    module.settings.chunk_type = module.settings.ChunkType.STANZA
    module.StanzaSentencizer = LocalSentenceSplitter


class LocalEngine:
    def __init__(self):
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio
        self.audio_decoder = decode_audio
        import argostranslate.translate
        self.translate_module = argostranslate.translate
        configure_local_translation(self.translate_module)
        self.precision = os.environ.get("POLYGLOT_MODE", "equilibre") == "precision"
        model_name = "small" if self.precision else "base"
        self.beam_size = 3 if self.precision else 1
        self.context_limit = 700 if self.precision else 160
        vocabulary = ROOT / "VOCABULAIRE.txt"
        self.vocabulary = vocabulary.read_text(encoding="utf-8-sig").strip()[:600] if vocabulary.exists() else ""
        self.reset_session()
        # Les téléchargements ont lieu exclusivement dans install_models.py.
        self.model = WhisperModel(
            model_name, device="cpu", compute_type="int8", cpu_threads=min(8, os.cpu_count() or 4),
            download_root=str(ROOT / "models"), local_files_only=True,
        )
        self.languages = {item.code: item for item in self.translate_module.get_installed_languages()}
        for source, target in [("en", "fr"), ("fr", "en"), ("en", "es"), ("es", "en")]:
            if source not in self.languages or target not in self.languages:
                raise RuntimeError("Modèles de traduction manquants. Relancez INSTALLER.cmd.")
            if self.languages[source].get_translation(self.languages[target]) is None:
                raise RuntimeError(f"Modèle {source} → {target} manquant. Relancez INSTALLER.cmd.")

    def reset_session(self):
        self.context = ""
        self.detected_language = None
        self.last_source = None
        self.window = None
        self.last_text = ""
        self.last_language = None
        self.last_duration = 0.0
        self.session_id = uuid.uuid4().hex
        self.segment_number = 0
        self.revision = 0

    def translate_text(self, text, language, target):
        if language == target:
            return text
        translator = self.languages[language].get_translation(self.languages[target])
        hypotheses = translator.hypotheses(text, num_hypotheses=1)
        return hypotheses[0].value.strip() if hypotheses else ""

    def result(self, original, language, target, final, bounded=False):
        self.revision += 1
        return {"id": f"{self.session_id}-{self.segment_number}",
                "revision": self.revision, "original": original,
                "translation": self.translate_text(original, language, target),
                "final": final, "bounded": bounded}

    def advance(self, original):
        self.context = (self.context + " " + original).strip()[-self.context_limit:]
        self.segment_number += 1
        self.revision = 0
        self.last_text = ""
        self.last_duration = 0.0

    def process(self, audio: bytes, source: str, target: str):
        """Réévalue une fenêtre audio courte ; les mises à jour partagent un ID."""
        import numpy as np
        if source not in LANGUAGES | {"auto"} or target not in LANGUAGES:
            raise ValueError("Cette version prend en charge anglais, français et espagnol.")
        if source != self.last_source:
            self.reset_session()
            self.last_source = source
        waveform = self.audio_decoder(io.BytesIO(audio), sampling_rate=16000)
        if not len(waveform) or len(waveform) > 16000 * 12:
            raise ValueError("Extrait audio vide ou trop long ; relancez la capture.")
        self.window = waveform if self.window is None else np.concatenate((self.window, waveform))
        duration = len(self.window) / 16000
        language = source if source != "auto" else self.detected_language
        prompt = " ".join(part for part in (self.vocabulary, self.context) if part) or None
        segments, info = self.model.transcribe(
            self.window, language=language, beam_size=self.beam_size,
            temperature=0.0, initial_prompt=prompt, word_timestamps=True,
            vad_filter=True, vad_parameters={"threshold": 0.35, "speech_pad_ms": 400},
            condition_on_previous_text=False,
        )
        segments = list(segments)
        original = " ".join(segment.text.strip() for segment in segments).strip()
        detected = info.language if language is None else language
        if detected not in LANGUAGES:
            # Laisser une nouvelle chance au prochain extrait, avec plus de contexte.
            if duration >= 12:
                self.window = None
            return []
        if source == "auto" and getattr(info, "language_probability", 0.0) >= 0.8:
            self.detected_language = detected
        self.last_language = detected
        if not original:
            events = self.finish(target)
            self.window = None
            return events
        words = [word for segment in segments for word in (getattr(segment, "words", None) or [])]
        last_end = words[-1].end if words else max(getattr(segment, "end", duration) for segment in segments)
        # Finaliser après une pause audible, plutôt qu'à chaque ponctuation ajoutée
        # artificiellement par Whisper à la fin d'un petit fichier audio.
        paused = duration - last_end >= 0.7
        if paused or duration >= 12:
            event = self.result(original, detected, target, True, bounded=not paused)
            self.advance(original)
            self.window = None
            return [event]
        # Une phrase ponctuée et stable dans deux reconnaissances successives peut
        # être finalisée sans attendre que le locuteur fasse une pause.
        normalized_previous = re.findall(r"\w+", self.last_text.casefold())
        cut = None
        for index, word in enumerate(words):
            if not re.search(r'[.!?](?:["”»])?$', word.word.strip()):
                continue
            prefix = "".join(item.word for item in words[:index + 1]).strip()
            tokens = re.findall(r"\w+", prefix.casefold())
            if tokens and normalized_previous[:len(tokens)] == tokens and word.end <= self.last_duration - 0.25:
                cut = (index, prefix, word.end)
        events = []
        if cut is not None:
            index, prefix, end = cut
            events.append(self.result(prefix, detected, target, True))
            self.advance(prefix)
            self.window = self.window[min(len(self.window), int(end * 16000)):]
            original = "".join(item.word for item in words[index + 1:]).strip()
            duration -= end
        if original:
            events.append(self.result(original, detected, target, False))
            self.last_text = original
            self.last_duration = duration
        return events

    def finish(self, target):
        """Stabilise la dernière proposition disponible à l'arrêt explicite."""
        if not self.last_text or self.last_language not in LANGUAGES:
            return []
        event = self.result(self.last_text, self.last_language, target, True, bounded=True)
        self.advance(self.last_text)
        self.window = None
        return [event]
