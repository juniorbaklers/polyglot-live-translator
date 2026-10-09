"""Voix Piper optionnelles déjà installées, sans téléchargement implicite."""
import base64
import io
import wave
from pathlib import Path
from terminology import LANGUAGE_CODE


class NeuralVoice:
    def __init__(self, root):
        self.root = Path(root)
        self.loaded = None
        self.language = None

    def synthesize(self, text, language):
        if not isinstance(language, str) or not LANGUAGE_CODE.fullmatch(language):
            raise ValueError("Langue vocale invalide")
        if not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise ValueError("Texte vocal vide ou trop long (2000 caractères)")
        model = self.root / f"{language}.onnx"
        if not model.is_file() or not model.with_suffix(".onnx.json").is_file():
            raise ValueError(f"Voix Piper {language} non installée")
        if self.language != language:
            try:
                from piper import PiperVoice
            except ImportError as error:
                raise ValueError("Piper non installé dans cet environnement Python") from error
            self.loaded = None  # une seule voix en mémoire sur les petits PC
            self.language = None
            self.loaded = PiperVoice.load(str(model), use_cuda=False)
            self.language = language
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as output:
            self.loaded.synthesize_wav(text, output)
        if buffer.tell() > 8_000_000:
            raise ValueError("Extrait vocal trop long")
        return base64.b64encode(buffer.getvalue()).decode("ascii")
