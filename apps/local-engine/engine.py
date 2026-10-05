"""Moteur local réel : aucun service cloud, aucune clé API, aucun texte simulé."""
import io
import os
import re
import uuid
from collections import OrderedDict
from preferences import DOMAINS, normalized, validate_preferences
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
        self.configure_session({})
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

    def configure_session(self, options):
        preferences = validate_preferences(options)
        self.session_vocabulary = ", ".join(filter(None, (DOMAINS[preferences["domain"]], preferences["glossary"])))
        self.corrections = preferences["corrections"]
        self.translation_cache = OrderedDict()

    def reset_session(self):
        self.translation_cache = OrderedDict()
        self.context = ""
        self.detected_language = None
        self.last_source = None
        self.window = None
        self.window_start = 0.0
        self.window_end = 0.0
        self.uncertain_words = []
        self.last_text = ""
        self.last_language = None
        self.last_duration = 0.0
        self.session_id = uuid.uuid4().hex
        self.segment_number = 0
        self.revision = 0

    def translate_text(self, text, language, target):
        for item in reversed(getattr(self, "corrections", [])):
            if item["source"] == language and item["target"] == target and normalized(item["original"]) == normalized(text):
                return item["translation"]
        if language == target:
            return text
        key = (text.strip(), language, target)
        if key in self.translation_cache:
            self.translation_cache.move_to_end(key)
            return self.translation_cache[key]
        translator = self.languages[language].get_translation(self.languages[target])
        hypotheses = translator.hypotheses(text, num_hypotheses=1)
        value = hypotheses[0].value.strip() if hypotheses else ""
        # Ne pas mémoriser une absence de traduction : une révision peut réessayer.
        if value:
            self.translation_cache[key] = value
            if len(self.translation_cache) > 64:
                self.translation_cache.popitem(last=False)
        return value

    def result(self, original, language, target, final, bounded=False):
        self.revision += 1
        tokens = set(re.findall(r"\w+", original.casefold()))
        uncertain = [word for word in self.uncertain_words if tokens.intersection(re.findall(r"\w+", word.casefold()))]
        return {"id": f"{self.session_id}-{self.segment_number}",
                "revision": self.revision, "original": original,
                "translation": self.translate_text(original, language, target),
                "final": final, "bounded": bounded, "sourceLanguage": language, "targetLanguage": target,
                "start": self.window_start, "end": self.window_end, "timing": "capture",
                "uncertainWords": uncertain, "origin": "audio"}

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
        previous_window = self.window
        self.window = waveform if self.window is None else np.concatenate((self.window, waveform))
        duration = len(self.window) / 16000
        self.window_end = self.window_start + duration
        # Un fichier entièrement nul ne contient aucune parole à reconnaître.
        # Garder le temps capturé, finaliser le texte déjà disponible et éviter
        # une nouvelle inférence. Une fenêtre encore non reconnue reste analysée.
        if not np.count_nonzero(waveform) and (previous_window is None or self.last_text):
            events = self.finish(target)
            self.window = None
            self.window_start = self.window_end
            return events
        language = source if source != "auto" else self.detected_language
        prompt = " ".join(part for part in (self.vocabulary, getattr(self, "session_vocabulary", ""), self.context) if part) or None
        segments, info = self.model.transcribe(
            self.window, language=language, beam_size=self.beam_size,
            temperature=0.0, initial_prompt=prompt, word_timestamps=True,
            hotwords=getattr(self, "session_vocabulary", "") or None,
            vad_filter=True, vad_parameters={"threshold": 0.35, "speech_pad_ms": 400},
            condition_on_previous_text=False, hallucination_silence_threshold=2.0,
        )
        segments = list(segments)
        original = " ".join(segment.text.strip() for segment in segments).strip()
        detected = info.language if language is None else language
        if detected not in LANGUAGES:
            # Laisser une nouvelle chance au prochain extrait, avec plus de contexte.
            if duration >= 12:
                self.window = None
                self.window_start = self.window_end
            return []
        if source == "auto" and getattr(info, "language_probability", 0.0) >= 0.8:
            self.detected_language = detected
        self.last_language = detected
        if not original:
            events = self.finish(target)
            self.window = None
            self.window_start = self.window_end
            return events
        words = [word for segment in segments for word in (getattr(segment, "words", None) or [])]
        self.uncertain_words = [word.word.strip() for word in words if getattr(word, "probability", 1) < 0.5][:30]
        last_end = words[-1].end if words else max(getattr(segment, "end", duration) for segment in segments)
        # Finaliser après une pause audible, plutôt qu'à chaque ponctuation ajoutée
        # artificiellement par Whisper à la fin d'un petit fichier audio.
        silence = duration - last_end
        has_ending = bool(re.search(r'[.!?](?:["”»])?$', original))
        # Une petite pause au milieu d'une phrase non ponctuée conserve la fenêtre
        # afin que la traduction suivante puisse utiliser la suite du propos.
        paused = silence >= 0.7 and has_ending
        long_pause = silence >= 1.5
        if paused or long_pause or duration >= 12:
            event = self.result(original, detected, target, True, bounded=not (paused and has_ending))
            self.advance(original)
            self.window = None
            self.window_start = self.window_end
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
            complete_end = self.window_end
            self.window_end = self.window_start + end
            events.append(self.result(prefix, detected, target, True))
            self.window_start = self.window_end
            self.window_end = complete_end
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
        self.window_start = self.window_end
        return [event]
