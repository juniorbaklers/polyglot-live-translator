"""Installation volontaire d'une voix ; jamais appelée par le moteur."""
import json
import re
import subprocess
import sys
from pathlib import Path
from terminology import LANGUAGE_CODE

ROOT = Path(__file__).resolve().parent
DEFAULTS = {"fr": "fr_FR-siwis-medium", "en": "en_US-lessac-medium",
            "es": "es_ES-sharvard-medium", "zh": "zh_CN-huayan-medium"}


def main():
    language = input("Code de langue cible (fr, en, es, zh ou autre) : ").strip().lower()
    if not LANGUAGE_CODE.fullmatch(language):
        raise ValueError("Code de langue invalide")
    default = DEFAULTS.get(language, "")
    voice = input(f"Identifiant Piper [{default}] : ").strip() or default
    if not re.fullmatch(r"[a-z]{2,3}_[A-Z]{2}-[a-zA-Z0-9_]+-(?:low|medium|high|x_low)", voice):
        raise ValueError("Identifiant Piper invalide. Consultez le catalogue officiel des voix.")
    if voice.split('_', 1)[0] != language.split('-', 1)[0]:
        raise ValueError("La voix doit correspondre à la langue cible")
    subprocess.run([sys.executable, "-m", "pip", "install", "--no-cache-dir", "piper-tts==1.8.0"], check=True)
    from piper.download_voices import download_voice
    from piper import PiperVoice
    folder = ROOT / "models" / "voices"
    folder.mkdir(parents=True, exist_ok=True)
    download_voice(voice, folder)
    model = folder / (voice + ".onnx")
    config = folder / (voice + ".onnx.json")
    # Vérifier avant de remplacer une voix déjà installée.
    json.loads(config.read_text(encoding="utf-8"))
    PiperVoice.load(str(model), use_cuda=False)
    model.replace(folder / f"{language}.onnx")
    config.replace(folder / f"{language}.onnx.json")
    print("Voix prête. Redémarrez le moteur et choisissez Piper dans les réglages de l'extension.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Installation vocale interrompue : {error}")
        raise SystemExit(1)
