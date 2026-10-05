"""Adaptateur léger : mêmes modèles Argos, exécution directe CTranslate2.

N'importe ni argostranslate.translate, ni Stanza, spaCy ou PyTorch.
Le gestionnaire de paquets et les tokeniseurs Argos restent utilisés.
"""
import re
from collections import deque
from dataclasses import dataclass


@dataclass
class Hypothesis:
    value: str
    score: float = 0.0


class DirectTranslation:
    def __init__(self, pkg, settings, translator_factory):
        self.pkg = pkg
        self.settings = settings
        self.translator_factory = translator_factory
        self.translator = None

    def translate(self, text):
        return self.hypotheses(text, 1)[0].value

    def hypotheses(self, text, num_hypotheses=1):
        if self.translator is None:
            self.translator = self.translator_factory(
                str(self.pkg.package_path / 'model'), device='cpu',
                inter_threads=self.settings.inter_threads,
                intra_threads=self.settings.intra_threads,
                compute_type=self.settings.compute_type)
        values = [''] * num_hypotheses
        scores = [0.0] * num_hypotheses
        for paragraph in text.split('\n'):
            sentences = [part.strip() for part in re.split(r'(?<=[。！？])\s*|(?<=[.!?])\s+', paragraph) if part.strip()]
            tokenized = [self.pkg.tokenizer.encode(sentence) for sentence in sentences]
            prefix = [[self.pkg.target_prefix]] * len(tokenized) if self.pkg.target_prefix else None
            batches = self.translator.translate_batch(
                tokenized, target_prefix=prefix, replace_unknowns=True,
                max_batch_size=self.settings.batch_size, batch_type='tokens',
                beam_size=max(num_hypotheses, self.settings.beam_size),
                num_hypotheses=num_hypotheses, length_penalty=0.2,
                return_scores=True)
            for index in range(num_hypotheses):
                tokens = [token for batch in batches for token in batch.hypotheses[index]]
                value = self.pkg.tokenizer.decode(tokens)
                if self.pkg.target_prefix and value.startswith(self.pkg.target_prefix):
                    value = value[len(self.pkg.target_prefix):]
                if value.startswith(' '):
                    value = value[1:]
                values[index] += '\n' + value
                scores[index] += sum(batch.scores[index] for batch in batches)
        return [Hypothesis(value.lstrip('\n'), score) for value, score in zip(values, scores)]


class IdentityTranslation:
    def translate(self, text): return text
    def hypotheses(self, text, num_hypotheses=1):
        return [Hypothesis(text) for _ in range(num_hypotheses)]


class PivotTranslation:
    def __init__(self, route): self.route = route
    def translate(self, text): return self.hypotheses(text, 1)[0].value
    def hypotheses(self, text, num_hypotheses=1):
        if num_hypotheses != 1:
            raise ValueError('Le moteur léger utilise une seule hypothèse pour les langues pivot.')
        score = 0.0
        for translator in self.route:
            result = translator.hypotheses(text, 1)[0]
            text, score = result.value, score + result.score
        return [Hypothesis(text, score)]


class Language:
    def __init__(self, code, direct):
        self.code = code
        self.direct = direct
        self.routes = {}

    def get_translation(self, target):
        if target.code == self.code: return IdentityTranslation()
        if (self.code, target.code) in self.direct: return self.direct[self.code, target.code]
        if target.code in self.routes: return self.routes[target.code]
        queue = deque([(self.code, [])])
        seen = {self.code}
        while queue:
            source, route = queue.popleft()
            for (a, b), translation in self.direct.items():
                if a != source or b in seen: continue
                path = route + [translation]
                if b == target.code:
                    result = PivotTranslation(path)
                    self.routes[target.code] = result
                    return result
                seen.add(b); queue.append((b, path))
        return None


def get_installed_languages():
    import ctranslate2
    from argostranslate import package, settings
    direct = {}
    for pkg in package.get_installed_packages():
        if pkg.type != 'translate' or not pkg.from_code or not pkg.to_code: continue
        pair = (pkg.from_code, pkg.to_code)
        if pair not in direct:
            direct[pair] = DirectTranslation(pkg, settings, ctranslate2.Translator)
    codes = dict.fromkeys(code for pair in direct for code in pair)
    return [Language(code, direct) for code in codes]
