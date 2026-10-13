"""Contrôles conservateurs : signaux d'alerte, pas une note de qualité."""
import re
from collections import Counter
from decimal import Decimal, InvalidOperation

NEGATIONS = {
    'en': r"\b(?:not|never|without|cannot|no|nothing|nobody)\b|n['’]t\b",
    'fr': r"\b(?:pas|jamais|sans|aucun|aucune|ni|rien)\b",
    'es': r"\b(?:no|nunca|sin|ningún|ninguna|nada|nadie|ni)\b",
    'zh': r'没有|不是|不能|不要|从不|不会|不',
}


def numbers(text):
    # Comparer les chiffres écrits ; normaliser les séparateurs les plus
    # courants sans prétendre interpréter les nombres écrits en lettres.
    text = re.sub(r'(?<=\d)[\u00a0\u202f](?=\d{3}(?:\D|$))', '', text)
    values = []
    for value in re.findall(r'[-+]?\d+(?:[.,]\d+)*', text):
        try:
            values.append(Decimal(value.replace(',', '.')))
        except InvalidOperation:
            values.append(value)  # séparateurs ambigus : ne pas deviner l'échelle
    return Counter(values)


def translation_issues(original, translated, source, target):
    issues = []
    if not translated.strip():
        return ['empty']
    if numbers(original) != numbers(translated):
        issues.append('numbers')
    if source in NEGATIONS and target in NEGATIONS:
        source_text = re.sub(r'\bnot only\b', '', original, flags=re.I) if source == 'en' else original
        if re.search(NEGATIONS[source], source_text, re.I) and not re.search(NEGATIONS[target], translated, re.I):
            issues.append('negation')
    return issues
