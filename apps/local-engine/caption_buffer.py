"""Regroupe les pistes fragmentées sans attendre pour afficher la première proposition."""
import re
import uuid


class CaptionBuffer:
    def __init__(self, translate, translate_final=None, reset_context=None, translate_drafts=True):
        self.translate = translate
        self.translate_drafts = translate_drafts
        self.translate_final = translate_final
        self.reset_context = reset_context
        self.last_cue = None
        self.pending = None

    def result(self, final, bounded=False):
        item = self.pending
        item['revision'] += 1
        translated = ''
        if final or self.translate_drafts:
            if final and self.translate_final:
                translated = self.translate_final(item['text'], item['language'], item['target'], bounded)
            else:
                translated = self.translate(item['text'], item['language'], item['target'])
        return {"id": item['id'], "revision": item['revision'], "original": item['text'],
                "translation": translated,
                "final": final, "bounded": bounded, "start": item['start'], "end": item['end'],
                "timing": "video", "origin": "captions", "sourceLanguage": item['language'],
                "targetLanguage": item['target'], "uncertainWords": []}

    def finish(self):
        if self.pending is None:
            return []
        result = self.result(True, bounded=True)
        self.pending = None
        return [result]

    def flush_expired(self, position):
        # A playback clock, not a wall-clock timer: pausing must not split speech.
        if self.pending is None or position < self.pending["end"] + 0.75:
            return []
        return self.finish()

    def process(self, text, language, target, start, end):
        events = []
        previous = self.pending
        if self.last_cue:
            last_start, last_end, last_language, last_target = self.last_cue
            if start < last_start or start - last_end > 1.0 or language != last_language or target != last_target:
                events.extend(self.finish())
                if self.reset_context:
                    self.reset_context()
        self.last_cue = (start, end, language, target)
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
        complete = bool(re.search(r'[.!?。！？](?:["”»])?$', self.pending['text']))
        bounded = self.pending['end'] - self.pending['start'] >= 12
        events.append(self.result(complete or bounded, bounded=bounded and not complete))
        if complete or bounded:
            self.pending = None
        return events
