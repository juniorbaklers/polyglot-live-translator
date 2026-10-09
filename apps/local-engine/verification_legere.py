"""Compare des textes de contrôle sur les modèles déjà installés, sans réseau."""
import argparse
import os
import json
import sys
from pathlib import Path
from languages import SAMPLE_TEXTS

ROOT = Path(__file__).resolve().parent
os.environ["ARGOS_MODEL_PROVIDER"] = "OPENNMT"
os.environ["ARGOS_DEVICE_TYPE"] = "cpu"
os.environ["ARGOS_CHUNK_TYPE"] = "STANZA"
EXTRA = {'en': ['This course helps you understand geographic information systems.',
                'FME transforms spatial data. It connects different formats.',
                'A map.\nThe next sentence.', 'We need to understand the software before trying for the certificate.'],
         'fr': ['Les données géographiques sont transformées avec FME.'],
         'es': ['Los datos geográficos ayudan a comprender el territorio.'],
         'zh': ['地理信息系统可以分析空间数据。']}


def reference_data(module):
    languages = {language.code: language for language in module.get_installed_languages()}
    items = []
    for source, sample in SAMPLE_TEXTS.items():
        if source not in languages: continue
        for target in sorted(set(SAMPLE_TEXTS) & languages.keys() - {source}):
            translator = languages[source].get_translation(languages[target])
            if translator is None: continue
            for text in [sample] + EXTRA[source]:
                items.append({'source': source, 'target': target, 'text': text,
                              'translation': translator.translate(text)})
    if not items:
        raise RuntimeError('Aucun modèle disponible dans cette installation. Conservez votre moteur actuel.')
    return items


def compare(module, items):
    languages = {language.code: language for language in module.get_installed_languages()}
    failures = []
    for item in items:
        translator = languages[item['source']].get_translation(languages[item['target']])
        value = translator.translate(item['text'])
        if value != item['translation']:
            failures.append({**item, 'light': value})
    return failures


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--reference', action='store_true')
    args = parser.parse_args()
    from offline_guard import enable
    enable()
    reference = ROOT / 'REFERENCE_TRADUCTION_LEGERE.json'
    if args.reference:
        import argostranslate.translate as module
        from engine import configure_local_translation
        configure_local_translation(module)
        items = reference_data(module)
        reference.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'Reference locale : {len(items)} passages de controle. Aucun modele telecharge.', flush=True)
    else:
        import local_translate as module
        items = json.loads(reference.read_text(encoding='utf-8'))
        failures = compare(module, items)
        # Importer aussi les chemins de transcription/service nécessaires.
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio
        import websockets, psutil
        forbidden = [name for name in ('torch', 'spacy', 'stanza', 'argostranslate.translate') if name in sys.modules]
        if forbidden:
            raise RuntimeError('Dependances lourdes importees : ' + ', '.join(forbidden))
        result = {'compared': len(items), 'differences': failures, 'heavy_imports': forbidden,
                  'note': 'Textes de contrôle uniquement : ne garantit pas la précision ou la vitesse sur les vidéos.'}
        (ROOT / 'RAPPORT_MOTEUR_LEGER.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'Comparaison : {len(items)} passages, {len(failures)} difference(s). Sans imports lourds.', flush=True)
        if failures:
            raise RuntimeError('Comparaison differente : gardez le moteur actuel et transmettez RAPPORT_MOTEUR_LEGER.json.')
        print('Controle reussi. Testez ensuite votre video avec DEMARRER_LEGER.cmd.', flush=True)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(f'Verification interrompue : {error}', flush=True); raise SystemExit(1)
