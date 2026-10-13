"""Téléchargement volontaire et conversion CPU int8 dans un environnement séparé."""
import argparse
import json
import gc
import shutil
import tempfile
from pathlib import Path
from african_translation import MODEL_IDS, TOKENS
from resources import detect_resources, GIB

ROOT = Path(__file__).resolve().parent
REVISIONS = {"nllb": "f8d333a098d19b4fd9a8b18f94170487ad3f821d",
             "baoule": "9acc31dd4b2b38f21017ca6b891cd59cda6059b5"}


def install(name, root=ROOT / "models" / "african"):
    resources = detect_resources()
    if resources.available is not None and resources.available < 5 * GIB:
        raise ValueError("Fermez des applications : la conversion demande au moins 5 Gio de RAM disponible.")
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(root).free < 8 * GIB:
        raise ValueError("Libérez au moins 8 Gio pour le téléchargement et la conversion temporaire.")
    from huggingface_hub import snapshot_download
    from transformers import AutoTokenizer
    from ctranslate2.converters import TransformersConverter
    import torch
    torch.set_num_threads(max(1, min(4, resources.cpus - 1)))
    print(f"Téléchargement de {MODEL_IDS[name]} puis conversion int8. Cela peut prendre plusieurs minutes.", flush=True)
    # Les poids de départ restent temporaires, seuls les fichiers int8 sont conservés.
    with tempfile.TemporaryDirectory(prefix="installation-", dir=root) as temporary:
        temporary = Path(temporary)
        snapshot = snapshot_download(MODEL_IDS[name], revision=REVISIONS[name], cache_dir=temporary / "cache",
            allow_patterns=["config.json", "pytorch_model.bin", "model.safetensors", "tokenizer.json",
                            "tokenizer_config.json", "special_tokens_map.json", "sentencepiece.bpe.model",
                            "added_tokens.json", "README.md"], max_workers=2)
        output = temporary / "converted"
        TransformersConverter(snapshot, trust_remote_code=False).convert(str(output), quantization="int8")
        tokenizer = AutoTokenizer.from_pretrained(snapshot, local_files_only=True, trust_remote_code=False)
        required = ("fr", "bci") if name == "baoule" else ("en", "fr", "es", "zh", "dyu", "wol")
        for code in required:
            if TOKENS[code] not in tokenizer.get_vocab():
                raise ValueError(f"Token {TOKENS[code]} absent : installation interrompue")
        tokenizer.backend_tokenizer.save(str(output / "tokenizer.json"))
        (output / "polyglot-model.json").write_text(json.dumps({"format": 1, "model": MODEL_IDS[name],
            "revision": REVISIONS[name], "quantization": "int8", "license": "CC-BY-NC-4.0"}, indent=2), encoding="utf-8")
        shutil.copyfile(Path(snapshot) / "README.md", output / "MODEL_CARD.md")
        # Vérifier le moteur réel avant de remplacer une installation précédente.
        from african_translation import AfricanTranslator
        staging = temporary / "verification"
        staging.mkdir(); shutil.move(str(output), str(staging / name))
        manager = AfricanTranslator(staging)
        for target in (("dyu", "wol") if name == "nllb" else ("bci",)):
            manager.require_pair("fr", target)
            print(f"Essai français → {target} : {manager.direct('Bonjour, comment allez-vous ?', name, 'fr', target)}", flush=True)
        manager.translator = manager.tokenizer = None
        gc.collect()
        destination, backup = root / name, temporary / "previous-model"
        if destination.exists():
            destination.rename(backup)
        try:
            shutil.move(str(staging / name), str(destination))
        except Exception:
            if backup.exists() and not destination.exists():
                backup.rename(destination)
            raise
        if backup.exists():
            shutil.rmtree(backup)
    print(f"Modèle {name} prêt. Redémarrez le moteur local.", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=("nllb", "baoule", "all"), default="all")
    args = parser.parse_args()
    for name in (MODEL_IDS if args.model == "all" else [args.model]):
        install(name)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Installation interrompue : {error}. Les modèles précédents restent utilisables.", flush=True)
        raise SystemExit(1)
