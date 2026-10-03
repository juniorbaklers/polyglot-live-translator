"""Moteur local réel : aucun service cloud, aucune clé API, aucun texte simulé."""
import io
import os
from pathlib import Path

os.environ["ARGOS_MODEL_PROVIDER"] = "OPENNMT"
os.environ["ARGOS_DEVICE_TYPE"] = "cpu"

ROOT = Path(__file__).resolve().parent
LANGUAGES = {"en", "fr", "es"}


class LocalEngine:
    def __init__(self):
        from faster_whisper import WhisperModel
        import argostranslate.translate
        self.translate_module = argostranslate.translate
        # Les téléchargements ont lieu exclusivement dans install_models.py.
        self.model = WhisperModel(
            "base", device="cpu", compute_type="int8", cpu_threads=min(8, os.cpu_count() or 4),
            download_root=str(ROOT / "models"), local_files_only=True,
        )
        self.languages = {item.code: item for item in self.translate_module.get_installed_languages()}
        for source, target in [("en", "fr"), ("fr", "en"), ("en", "es"), ("es", "en")]:
            if source not in self.languages or target not in self.languages:
                raise RuntimeError("Modèles de traduction manquants. Relancez INSTALLER.cmd.")
            if self.languages[source].get_translation(self.languages[target]) is None:
                raise RuntimeError(f"Modèle {source} → {target} manquant. Relancez INSTALLER.cmd.")

    def process(self, audio: bytes, source: str, target: str):
        if source not in LANGUAGES | {"auto"} or target not in LANGUAGES:
            raise ValueError("Cette version prend en charge anglais, français et espagnol.")
        segments, info = self.model.transcribe(
            io.BytesIO(audio), language=None if source == "auto" else source,
            beam_size=1, vad_filter=True, condition_on_previous_text=False,
        )
        original = " ".join(segment.text.strip() for segment in segments).strip()
        if not original:
            return "", ""
        detected = info.language if source == "auto" else source
        if detected not in LANGUAGES:
            raise ValueError(f"Langue détectée ({detected}) non installée. Choisissez la langue source.")
        if detected == target:
            return original, original
        translator = self.languages[detected].get_translation(self.languages[target])
        return original, translator.translate(original)
