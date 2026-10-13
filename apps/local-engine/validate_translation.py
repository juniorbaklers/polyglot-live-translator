"""Teste les traductions du moteur réellement lancé, pas une simulation."""
import argparse
import asyncio
import html
import json
import math
import time
import statistics
from pathlib import Path
from translation_checks import translation_issues

ROOT = Path(__file__).resolve().parent


def write_report(report, output):
    output = Path(output)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    rows = []
    for item in report['cases']:
        values = [item['id'], item['text'], item.get('translation', ''), item.get('review', ''),
                  ', '.join(item.get('issues', []) + item.get('notices', [])) or item.get('error', 'Aucune alerte automatique'),
                  str(item.get('responseSeconds', ''))]
        rows.append('<tr>' + ''.join('<td>' + html.escape(value) + '</td>' for value in values) + '</tr>')
    document = '''<!doctype html><html lang="fr"><meta charset="utf-8"><title>Validation Polyglot</title>
<style>body{font:16px/1.5 Segoe UI,sans-serif;margin:30px;color:#192b44}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd5e3;padding:12px;text-align:left}th{background:#edf2f9}h1{color:#254f91}td{vertical-align:top}</style>
<h1>Validation des traductions — moteur local</h1><p>Ces sorties proviennent du moteur réellement lancé. L’absence d’alerte ne prouve pas que le sens est correct.
Relisez chaque traduction avec un locuteur compétent. Ce test porte sur le texte, pas la capture audio ni le rendu Chrome/Edge.</p>
<table><thead><tr><th>Cas</th><th>Original</th><th>Traduction</th><th>Point à relire</th><th>Alertes</th><th>Réponse (s)</th></tr></thead><tbody>'''
    destination = output.with_suffix('.html')
    destination.write_text(document + ''.join(rows) + '</tbody></table></html>', encoding='utf-8')
    return destination


async def validate(cases, url='ws://127.0.0.1:47833', engine='classic'):
    from websockets.asyncio.client import connect
    results = []
    async with connect(url, origin='chrome-extension://' + 'a' * 32, open_timeout=10) as socket:
        async def send(value): await socket.send(json.dumps(value))
        async def receive(): return json.loads(await asyncio.wait_for(socket.recv(), 120))
        await send({'type':'pair.request','extensionId':'a' * 32})
        paired = await receive()
        if paired.get('type') != 'pair.accepted' or paired.get('engine') != 'polyglot-local-free-v12':
            raise RuntimeError('Moteur incompatible ou occupé. Arrêtez la traduction dans l’extension avant ce test.')
        token = paired['token']
        for index, case in enumerate(cases):
            entry = {**case, 'notices': []}
            print('Test : ' + case['id'], flush=True)
            await send({'type':'session.start','token':token,'options':{'inputMode':'captions',
                        'sourceLanguage':case['source'],'targetLanguage':case['target'],'translateDrafts':False,
                        'translationEngine':engine, 'domain':case.get('domain','general'),
                        'expert':'technical' if case.get('domain') in ('geographie','informatique') else 'general'}})
            ready = await receive()
            if ready.get('state') != 'capturing':
                entry['error'] = ready.get('message', ready.get('reason', 'Session indisponible'))
                results.append(entry); continue
            started = time.perf_counter()
            await send({'type':'text.chunk','token':token,'sequence':index,'text':case['text'],
                        'language':case['source'],'start':0,'end':2})
            latest = {}
            while True:
                reply = await receive()
                if reply.get('type') == 'notice': entry['notices'].append(reply.get('message',''))
                if reply.get('type') == 'subtitle': latest[reply['id']] = reply
                if reply.get('type') == 'error':
                    entry['error'] = reply.get('message', 'Erreur'); break
                if reply.get('type') == 'audio.ack':
                    entry.update(processingMs=reply.get('processingMs'), queueMs=reply.get('queueMs'))
                    break
            await send({'type':'session.stop','token':token})
            while True:
                reply = await receive()
                if reply.get('type') == 'notice': entry['notices'].append(reply.get('message',''))
                if reply.get('type') == 'subtitle': latest[reply['id']] = reply
                if reply.get('type') == 'error':
                    entry['error'] = reply.get('message', 'Finalisation impossible'); break
                if reply.get('state') == 'stopped': break
            entry['responseSeconds'] = round(time.perf_counter() - started, 3)
            entry['translation'] = ' '.join(item['translation'] for item in latest.values() if item.get('final'))
            entry['issues'] = translation_issues(case['text'], entry['translation'], case['source'], case['target'])
            entry['humanValidated'] = False
            results.append(entry)
    times = sorted(item['responseSeconds'] for item in results if 'responseSeconds' in item)
    return {'format':1,'mode':'real-local-text-engine','requestedEngine':engine,'humanValidated':False,'cases':results,
            'medianResponseSeconds':statistics.median(times) if times else None,
            'p95ResponseSeconds':times[max(0, math.ceil(.95 * len(times))-1)] if times else None,
            'limits':'Text only. Not an ASR, video latency, semantic accuracy or Windows UI certification.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'validation-traduction.json')
    parser.add_argument('--engine', choices=('classic','ollama'), default='classic')
    args = parser.parse_args()
    cases = json.loads((ROOT / 'validation_cases.json').read_text(encoding='utf-8'))
    report = asyncio.run(validate(cases, engine=args.engine))
    path = write_report(report, args.output)
    print('Rapport : ' + str(path), flush=True)


if __name__ == '__main__':
    main()
