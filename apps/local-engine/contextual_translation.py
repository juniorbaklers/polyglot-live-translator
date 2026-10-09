"""Reprise locale bornée avec préfixe traduit, sans dupliquer l'historique.

Les modèles Argos restent des modèles de phrases : la qualité contextuelle
est à mesurer sur de l'audio réel, et n'est pas garantie par ce mécanisme.
"""
import time


def contextual_translation(translation, text, history, budget=0.8):
    if not history:
        return None
    # Uniquement une paire directe. Les traductions via langue pivot conservent
    # leur chemin Argos habituel ; ne jamais mélanger leurs tokeniseurs.
    package_translation = getattr(translation, 'underlying', translation)
    pkg = getattr(package_translation, 'pkg', None)
    backend = getattr(package_translation, 'translator', None)
    if pkg is None or backend is None:
        return None
    source = ' '.join([item[0] for item in history] + [text])
    target = ' '.join(item[1] for item in history)
    if len(source) > 1200 or len(target) > 700:
        return None
    source_tokens = pkg.tokenizer.encode(source)
    prefix = pkg.tokenizer.encode(target)
    if pkg.target_prefix:
        prefix = [pkg.target_prefix] + prefix
    if not source_tokens or not prefix or len(source_tokens) > 320 or len(prefix) > 96:
        return None
    deadline = time.monotonic() + budget
    expired = False

    def keep_going(_step):
        nonlocal expired
        expired = time.monotonic() >= deadline
        return not expired

    batches = backend.translate_batch(
        [source_tokens], target_prefix=[prefix], beam_size=1,
        num_hypotheses=1, replace_unknowns=True, max_input_length=320,
        max_decoding_length=len(prefix) + 128, callback=keep_going,
    )
    # Le rappel ne peut interrompre l'encodage. Vérifier aussi la durée totale
    # et refuser un résultat incomplet ou coupé par la limite de génération.
    if expired or time.monotonic() >= deadline or not batches or not batches[0].hypotheses:
        return None
    tokens = batches[0].hypotheses[0]
    if tokens[:len(prefix)] != prefix:
        return None
    continuation = tokens[len(prefix):]
    if not continuation or len(continuation) >= 128:
        return None
    value = pkg.tokenizer.decode(continuation).strip()
    return value or None
