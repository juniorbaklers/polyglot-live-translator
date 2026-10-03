"""Installation initiale uniquement : télécharge les modèles libres nécessaires."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    import os
    os.environ["ARGOS_MODEL_PROVIDER"] = "OPENNMT"
    os.environ["ARGOS_DEVICE_TYPE"] = "cpu"
    from faster_whisper import WhisperModel
    import argostranslate.package
    print("Téléchargement du modèle de transcription Whisper base…", flush=True)
    WhisperModel("base", device="cpu", compute_type="int8", download_root=str(ROOT / "models"))
    print("Installation des traductions anglais / français / espagnol…", flush=True)
    argostranslate.package.update_package_index()
    available = argostranslate.package.get_available_packages()
    installed = {(p.from_code, p.to_code) for p in argostranslate.package.get_installed_packages()}
    for source, target in [("en", "fr"), ("fr", "en"), ("en", "es"), ("es", "en")]:
        if (source, target) in installed:
            continue
        package = next((p for p in available if p.from_code == source and p.to_code == target), None)
        if package is None:
            raise RuntimeError(f"Modèle {source} → {target} indisponible dans le catalogue Argos.")
        print(f"Téléchargement : {source} → {target}", flush=True)
        argostranslate.package.install_from_path(package.download())
    from engine import LocalEngine
    engine = LocalEngine()
    # Précharge aussi les détecteurs de phrases et les traductions par langue pivot.
    for source, text in [("en", "Hello, welcome."), ("fr", "Bonjour, bienvenue."), ("es", "Hola, bienvenido.")]:
        for target in {"en", "fr", "es"} - {source}:
            translator = engine.languages[source].get_translation(engine.languages[target])
            if translator is None:
                raise RuntimeError(f"Traduction {source} → {target} non installée")
            translator.translate(text)
    (ROOT / "installation-ok.txt").write_text("Modèles locaux installés.\n", encoding="utf-8")
    print("Installation terminée. Vous pouvez lancer DEMARRER.cmd.", flush=True)


if __name__ == "__main__":
    main()
