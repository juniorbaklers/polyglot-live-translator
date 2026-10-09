"""Téléchargement facultatif du modèle précis, pendant l'installation uniquement."""
from pathlib import Path


def main():
    from faster_whisper import WhisperModel
    root = Path(__file__).resolve().parent
    print("Téléchargement de Whisper small : gratuit, plus volumineux que base…", flush=True)
    WhisperModel("small", device="cpu", compute_type="int8", download_root=str(root / "models"))
    print("Modèle précis installé. Lancez DEMARRER_PRECISION.cmd.", flush=True)


if __name__ == "__main__":
    main()
