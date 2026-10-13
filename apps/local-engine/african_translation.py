"""Traduction locale expérimentale, sans téléchargement durant la capture.

NLLB : dioula et wolof. Modèle baoulé spécialisé : français ↔ baoulé.
Les autres directions baoulé passent explicitement par le français.
"""
import json
import gc
from pathlib import Path
from types import SimpleNamespace
from languages import AFRICAN_LANGUAGES
from resources import detect_resources, GIB

TOKENS = {"en": "eng_Latn", "fr": "fra_Latn", "es": "spa_Latn", "zh": "zho_Hans",
          "dyu": "dyu_Latn", "wol": "wol_Latn", "bci": "bci_Latn"}
MODEL_IDS = {"nllb": "facebook/nllb-200-distilled-600M",
             "baoule": "GaindeNdiaye/nllb-baoule-v1"}


def translation_route(source, target):
    if source == target:
        return []
    if source == "bci":
        return [("baoule", "bci", "fr")] + ([] if target == "fr" else translation_route("fr", target))
    if target == "bci":
        return ([] if source == "fr" else translation_route(source, "fr")) + [("baoule", "fr", "bci")]
    return [("nllb" if source in AFRICAN_LANGUAGES or target in AFRICAN_LANGUAGES else "argos", source, target)]


class AfricanTranslator:
    def __init__(self, root):
        self.root = Path(root)
        self.loaded_name = None
        self.translator = None
        self.tokenizer = None

    def require_pair(self, source, target):
        for name, _, _ in translation_route("fr" if source == "auto" else source, target):
            if name == "argos":
                continue
            folder = self.root / name
            if not all((folder / filename).is_file() for filename in ("model.bin", "config.json", "tokenizer.json", "polyglot-model.json")):
                raise ValueError("Modèle de traduction africaine absent. Lancez INSTALLER_LANGUES_AFRICAINES.cmd, choisissez la langue, puis redémarrez le moteur.")
            info = json.loads((folder / "polyglot-model.json").read_text(encoding="utf-8"))
            if info.get("model") != MODEL_IDS[name] or info.get("format") != 1:
                raise ValueError("Modèle africain incompatible : relancez son installation.")

    def load(self, name):
        if self.loaded_name == name:
            return
        # Un seul modèle en mémoire, même pour une traduction via deux modèles.
        self.translator = self.tokenizer = None
        self.loaded_name = None
        gc.collect()
        resources = detect_resources()
        if resources.available is not None and resources.available < 2 * GIB:
            raise ValueError("Mémoire insuffisante pour ce modèle de langue. Fermez des applications puis relancez la traduction.")
        import ctranslate2
        from tokenizers import Tokenizer
        folder = self.root / name
        self.tokenizer = Tokenizer.from_file(str(folder / "tokenizer.json"))
        self.tokenizer.no_truncation()
        self.tokenizer.no_padding()
        self.translator = ctranslate2.Translator(str(folder), device="cpu", compute_type="int8",
            inter_threads=1, intra_threads=max(1, min(4, resources.cpus - 1)))
        self.loaded_name = name

    def direct(self, text, name, source, target):
        self.load(name)
        for code in (source, target):
            if self.tokenizer.token_to_id(TOKENS[code]) is None:
                raise ValueError(f"Token de langue {code} absent du modèle installé")
        tokens = self.tokenizer.encode(text, add_special_tokens=False).tokens
        if not tokens:
            return ""
        # Pas de troncature silencieuse : traiter chaque portion de texte.
        values = []
        for start in range(0, len(tokens), 192):
            chunk = [TOKENS[source]] + tokens[start:start + 192] + ["</s>"]
            result = self.translator.translate_batch([chunk], target_prefix=[[TOKENS[target]]],
                beam_size=2, max_decoding_length=512)[0].hypotheses[0]
            if len(result) >= 512:
                raise ValueError("Traduction trop longue : utilisez des sous-titres plus courts")
            if result and result[0] == TOKENS[target]:
                result = result[1:]
            ids = [self.tokenizer.token_to_id(token) for token in result]
            if any(token is None for token in ids):
                raise ValueError("Réponse incompatible avec le vocabulaire du modèle")
            values.append(self.tokenizer.decode(ids, skip_special_tokens=True).strip())
        value = ("" if target == "zh" else " ").join(values).strip()
        if not value:
            raise ValueError("Le modèle africain n’a pas produit de traduction")
        return value

    def translate(self, text, source, target, classic):
        self.require_pair(source, target)
        for name, a, b in translation_route(source, target):
            text = classic(text, a, b) if name == "argos" else self.direct(text, name, a, b)
        return text


class AfricanTranslation:
    def __init__(self, manager, source, target, classic):
        self.manager, self.source, self.target, self.classic = manager, source, target, classic

    def hypotheses(self, text, num_hypotheses=1):
        if num_hypotheses != 1:
            raise ValueError("Une seule hypothèse pour les langues africaines")
        return [SimpleNamespace(value=self.manager.translate(text, self.source, self.target, self.classic))]
