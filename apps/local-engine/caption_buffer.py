"""Regroupe les pistes fragmentées sans attendre pour afficher la première proposition."""
import re
import uuid


class CaptionBuffer:
    def __init__(self, translate):
        self.translate = translate
        self.pending = None

    def result(self, final, bounded=False):
        item = self.pending
        item['revision'] += 1
        return {"id": item['id'], "revision": item['revision'], "original": item['text'],
                "translation": self.translate(item['text'], item['language'], item['target']),
                "final": final, "bounded": bounded, "start": item['start'], "end": item['end'],
                "timing": "video", "origin": "captions", "sourceLanguage": item['language'],
                "targetLanguage": item['target'], "uncertainWords": []}

    def finish(self):
        if self.pending is None:
            return []
        result = self.result(True, bounded=True)
        self.pending = None
        return [result]

    def process(self, text, language, target, start, end):
        events = []
        previous = self.pending
        if previous and (start < previous['start'] or start - previous['end'] > 1.0 or
                         language != previous['language'] or target != previous['target'] or
                         len(previous['text']) + len(text) > 4000):
            events.extend(self.finish())
        if self.pending is None:
            self.pending = dict(id=uuid.uuid4().hex, revision=0, text=text,
                                language=language, target=target, start=start, end=end)
        else:
            previous = self.pending
            # Les pistes défilantes peuvent exposer le même préfixe avec des temps
            # qui se chevauchent. Une répétition dans deux pistes successives reste intacte.
            if (start < previous['end'] - .1 and text.startswith(previous['text']) and
                    (len(text) == len(previous['text']) or
                     not text[len(previous['text'])].isalnum())):
                previous['text'] = text
            elif (start < previous['end'] - .1 and previous['text'].endswith(text) and
                  (len(text) == len(previous['text']) or
                   not previous['text'][-len(text) - 1].isalnum())):
                pass
            else:
                previous['text'] += ' ' + text
            previous['end'] = max(previous['end'], end)
        complete = bool(re.search(r'[.!?](?:["”»])?$', self.pending['text']))
        bounded = self.pending['end'] - self.pending['start'] >= 12
        events.append(self.result(complete or bounded, bounded=bounded and not complete))
        if complete or bounded:
            self.pending = None
        return events
