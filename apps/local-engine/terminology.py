"""Glossaire versionné, indépendant des langues actuellement installées."""
import re

LANGUAGE_CODE = re.compile(r"[a-z]{2,3}(?:-[a-z0-9]{2,8})*")


def validate_terms(value):
    if not isinstance(value, dict) or (type(value.get("version")) is not int or value.get("version") != 1):
        raise ValueError("Glossaire : format attendu {version: 1, entries: [...]}")
    entries = value.get("entries")
    if not isinstance(entries, list) or len(entries) > 500:
        raise ValueError("Glossaire : au maximum 500 termes")
    clean, seen = [], set()
    for item in entries:
        if not isinstance(item, dict):
            raise ValueError("Terme invalide")
        source, target = item.get("source"), item.get("target")
        if any(not isinstance(code, str) or not LANGUAGE_CODE.fullmatch(code) for code in (source, target)):
            raise ValueError("Codes de langue invalides : exemples en, fr, es, zh, de, pt-br")
        term, translation = item.get("term"), item.get("translation")
        if any(not isinstance(text, str) or not text.strip() or len(text) > 200 for text in (term, translation)):
            raise ValueError("Terme et traduction : entre 1 et 200 caractères")
        domain = item.get("domain", "*")
        if not isinstance(domain, str) or not re.fullmatch(r"\*|[a-z_]{1,40}", domain):
            raise ValueError("Domaine de terme invalide")
        key = source, target, domain, term.strip().casefold()
        if key in seen:
            raise ValueError("Terme en double pour la même langue et le même domaine")
        seen.add(key)
        clean.append(dict(source=source, target=target, domain=domain, term=term.strip(), translation=translation.strip()))
    return {"version": 1, "entries": clean}


def matching_terms(entries, text, source, target, domain):
    # Le domaine spécifique prend priorité sur le terme général.
    selected = {}
    for item in sorted(entries, key=lambda item: item["domain"] != "*"):
        if item["source"] == source and item["target"] == target and item["domain"] in ("*", domain):
            selected[item["term"].casefold()] = item
    if not selected:
        return []
    alternatives = []
    for term in sorted((item["term"] for item in selected.values()), key=len, reverse=True):
        # Frontières de mots pour les alphabets séparés ; han/kana/hangul sans espaces.
        cjk = any('\u3400' <= char <= '\u9fff' or '\u3040' <= char <= '\u30ff' or '\uac00' <= char <= '\ud7af' for char in term)
        alternatives.append(re.escape(term) if cjk else r"(?<!\w)" + re.escape(term) + r"(?!\w)")
    pattern = re.compile("|".join(alternatives), re.IGNORECASE)
    return [(match.start(), match.end(), selected[match.group().casefold()]) for match in pattern.finditer(text)]


def translate_with_terms(text, matches, translate):
    """Essayer les marqueurs, puis fragments si le modèle modifie les marqueurs.

    Le second chemin privilégie les termes exacts au naturel de la phrase.
    Aucun remplacement aveugle dans le texte traduit.
    """
    markers = [f"ZXQTERM{index}QXZ" for index in range(len(matches))]
    if any(marker in text for marker in markers):
        markers = []  # collision : utiliser directement les fragments
    if markers:
        pieces, position = [], 0
        for marker, (start, end, _) in zip(markers, matches):
            pieces.extend((text[position:start], marker)); position = end
        pieces.append(text[position:])
        result = translate("".join(pieces))
        if all(result.count(marker) == 1 for marker in markers):
            for marker, (_, _, item) in zip(markers, matches):
                result = result.replace(marker, item["translation"])
            return result
    pieces, position = [], 0
    for start, end, item in matches:
        fragment = text[position:start]
        if fragment.strip():
            pieces.append((" " if fragment[:1].isspace() else "") + translate(fragment.strip()) + (" " if fragment[-1:].isspace() else ""))
        else:
            pieces.append(fragment)
        pieces.append(item["translation"]); position = end
    fragment = text[position:]
    if fragment.strip():
        pieces.append((" " if fragment[:1].isspace() else "") + translate(fragment.strip()))
    else:
        pieces.append(fragment)
    return "".join(pieces).strip()
