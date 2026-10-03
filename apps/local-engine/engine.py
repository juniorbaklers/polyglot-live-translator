"""Moteur local réel : aucun service cloud, aucune clé API, aucun texte simulé."""
import io
import os
import re
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
    # ses modèles ont été préchargés. Les blocs audio de cinq secondes ne
    # nécessitent pas ce détecteur : remplacer le point d'extension Argos
    # avant de construire les traductions évite ce téléchargement implicite.
    module.settings.chunk_type = module.settings.ChunkType.STANZA
    module.StanzaSentencizer = LocalSentenceSplitter


class LocalEngine:
    def __init__(self):
        from faster_whisper import WhisperModel
        import argostranslate.translate
        self.translate_module = argostranslate.translate
        configure_local_translation(self.translate_module)
        self.precision = os.environ.get("POLYGLOT_MODE", "equilibre") == "precision"
        model_name = "small" if self.precision else "base"
        self.beam_size = 3
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

    def process(self, audio: bytes, source: str, target: str):
        if source not in LANGUAGES | {"auto"} or target not in LANGUAGES:
            raise ValueError("Cette version prend en charge anglais, français et espagnol.")
        if source != self.last_source:
            self.reset_session()
            self.last_source = source
        language = source if source != "auto" else self.detected_language
        prompt = " ".join(part for part in (self.vocabulary, self.context) if part) or None
        segments, info = self.model.transcribe(
            io.BytesIO(audio), language=language,
            beam_size=self.beam_size, temperature=0.0, initial_prompt=prompt,
            vad_filter=True, condition_on_previous_text=False,
        )
        original = " ".join(segment.text.strip() for segment in segments).strip()
        if not original:
            return "", ""
        detected = info.language if language is None else language
        if detected not in LANGUAGES:
            # Un extrait court/bruité ne doit pas interrompre toute la vidéo.
            # Ne pas inventer une langue ou une traduction pour cet extrait.
            return "", ""
        if source == "auto" and getattr(info, "language_probability", 0.0) >= 0.8:
            self.detected_language = detected
        self.context = (self.context + " " + original).strip()[-700:]
        if detected == target:
            return original, original
        translator = self.languages[detected].get_translation(self.languages[target])
        # Une seule proposition finale est utilisée : inutile de calculer et
        # de combiner quatre résultats pour chaque paragraphe et langue pivot.
        hypotheses = translator.hypotheses(original, num_hypotheses=1)
        if not hypotheses:
            raise RuntimeError("Le modèle local n’a produit aucune traduction.")
        return original, hypotheses[0].value
