"""Profils prudents au démarrage ; aucun téléchargement pendant l'utilisation."""
import os
from dataclasses import dataclass
from pathlib import Path

GIB = 1024 ** 3


@dataclass(frozen=True)
class Resources:
    cpus: int
    available: int | None


@dataclass(frozen=True)
class Profile:
    model: str
    threads: int
    beam: int
    context: int


def detect_resources():
    import psutil
    cpus = max(1, os.cpu_count() or 1)
    try:
        cpus = min(cpus, len(psutil.Process().cpu_affinity()) or cpus)
    except (AttributeError, NotImplementedError, psutil.Error):
        pass
    # Le nombre de cœurs physiques évite de saturer les threads logiques.
    cpus = min(cpus, psutil.cpu_count(logical=False) or cpus)
    try:
        available = psutil.virtual_memory().available
    except (OSError, psutil.Error):
        available = None
    return Resources(max(1, cpus), available)


def choose_profile(resources, mode="auto"):
    threads = max(1, min(6, resources.cpus - 1))
    ram = resources.available
    if ram is None or ram < 3 * GIB or resources.cpus < 3:
        return Profile("tiny", min(2, threads), 1, 160)
    if ram >= 6 * GIB and resources.cpus >= 6:
        return Profile("small", threads, 3, 700)
    if mode == "precision" and ram >= 4 * GIB and resources.cpus >= 4:
        return Profile("small", threads, 3, 700)
    return Profile("base", threads, 1, 160)


def installed_model(root, name):
    # Emplacement connu du cache Hugging Face créé par faster-whisper.
    cache = Path(root) / f"models--Systran--faster-whisper-{name}" / "snapshots"
    return any((snapshot / "model.bin").is_file() and (snapshot / "config.json").is_file()
               and (snapshot / "tokenizer.json").is_file()
               for snapshot in cache.glob("*"))


def load_model(factory, root, profile):
    names = {"small": ("small", "base", "tiny"), "base": ("base", "tiny"), "tiny": ("tiny",)}[profile.model]
    for name in names:
        if not installed_model(root, name):
            continue
        try:
            model = factory(name, device="cpu", compute_type="int8", cpu_threads=profile.threads,
                            download_root=str(root), local_files_only=True)
        except (MemoryError, RuntimeError) as error:
            if isinstance(error, RuntimeError) and not any(term in str(error).lower()
                    for term in ("out of memory", "bad_alloc", "cannot allocate", "not enough memory")):
                raise
            continue
        actual = Profile(name, profile.threads, profile.beam if name == "small" else 1,
                         profile.context if name == "small" else 160)
        return model, actual
    raise RuntimeError("Aucun modèle adapté ne peut être chargé. Fermez les applications inutilisées puis relancez INSTALLER.cmd pour installer tiny et base.")
