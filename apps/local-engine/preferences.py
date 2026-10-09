"""Préférences locales bornées : vocabulaire indicatif et corrections exactes."""
import re
from languages import LANGUAGES

DOMAINS = {
    "general": "",
    "informatique": "Python, JavaScript, GitHub, DevOps, API, SQL, Docker, Kubernetes",
    "geographie": "GIS, SIG, FME, ETL, QGIS, raster, vecteur, projection, Sentinel, Landsat, géoréférencement",
    "commerce": "facture, TVA, chiffre d'affaires, bilan, trésorerie, marge",
}


def validate_preferences(options):
    if not isinstance(options, dict):
        raise ValueError("Réglages invalides")
    domain = options.get("domain", "general")
    glossary = options.get("glossary", "")
    corrections = options.get("corrections", [])
    if domain not in DOMAINS or not isinstance(glossary, str) or len(glossary) > 1500:
        raise ValueError("Domaine invalide ou glossaire trop long (1500 caractères)")
    if not isinstance(corrections, list) or len(corrections) > 100:
        raise ValueError("Au maximum 100 corrections locales")
    clean = []
    for item in corrections:
        if not isinstance(item, dict):
            raise ValueError("Correction invalide")
        values = [item.get(key) for key in ("original", "translation", "source", "target")]
        original, translation, source, target = values
        if not all(isinstance(value, str) for value in values) or not 0 < len(original) <= 2000 or not 0 < len(translation) <= 2000:
            raise ValueError("Correction vide ou trop longue")
        if source not in LANGUAGES or target not in LANGUAGES:
            raise ValueError("Langue de correction invalide")
        clean.append(dict(zip(("original", "translation", "source", "target"), values)))
    return {"domain": domain, "glossary": glossary.strip(), "corrections": clean}


def normalized(text):
    return re.sub(r"\s+", " ", text.strip()).casefold()
