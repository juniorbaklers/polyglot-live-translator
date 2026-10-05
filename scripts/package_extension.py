"""Archive reproductible du moteur et de l'extension compilée, sans modèles ni secrets."""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE_FILES = ["engine.py", "server.py", "caption_buffer.py", "preferences.py", "offline_guard.py", "benchmark.py", "requirements.txt", "install_models.py", "install_precision.py", "INSTALLER.cmd", "INSTALLER_PRECISION.cmd", "DEMARRER.cmd", "DEMARRER_PRECISION.cmd", "VOCABULAIRE.txt"]


def package(output):
    dist = ROOT / "apps/extension/dist"
    manifest = json.loads((dist / "manifest.json").read_text())
    if manifest['version'] != json.loads((ROOT / "apps/extension/public/manifest.json").read_text())['version']:
        raise ValueError("Recompilez l’extension avant de créer l’archive")
    for filename in ("background.js", "offscreen.js", "content.js", "popup.js", "popup.html", "offscreen.html"):
        if not (dist / filename).is_file():
            raise ValueError(f"Fichier compilé manquant : {filename}")
    protocol = "polyglot-local-free-v4"
    if protocol not in (dist / "offscreen.js").read_text() or protocol not in (ROOT / "apps/local-engine/server.py").read_text():
        raise ValueError("Versions moteur/extension incompatibles")
    entries = [(f"extension/{path.relative_to(dist).as_posix()}", path) for path in dist.rglob('*') if path.is_file()]
    entries += [(f"moteur-local/{name}", ROOT / "apps/local-engine" / name) for name in ENGINE_FILES]
    entries += [("INSTALLATION.txt", ROOT / "docs/INSTALLATION_EXTENSION.txt"), ("DEVOPS.md", ROOT / "docs/DEVOPS.md"), ("LICENSE", ROOT / "LICENSE")]
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, path in sorted(entries):
            entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0)); entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, path.read_bytes())
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(output.suffix + '.sha256').write_text(f"{digest}  {output.name}\n", encoding='utf-8')
    print(f"Archive {manifest['version']} : {output}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/Polyglot_Extension_Premium_V8.zip')
    package(parser.parse_args().output)
