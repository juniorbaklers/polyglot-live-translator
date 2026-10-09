"""Diagnostic en lecture seule des composants installés ; aucun nettoyage."""
import json
import os
import stat
from pathlib import Path


def linked(path):
    try:
        info = path.lstat()
        return path.is_symlink() or bool(getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 1024))
    except OSError:
        return True


def measure(path):
    size, count, errors = 0, 0, 0
    if not path.exists() or linked(path):
        return {'bytes': 0, 'files': 0, 'unreadable': 0}
    def onerror(_error):
        nonlocal errors
        errors += 1
    for folder, directories, files in os.walk(path, followlinks=False, onerror=onerror):
        directories[:] = [name for name in directories if not linked(Path(folder) / name)]
        for name in files:
            item = Path(folder) / name
            if linked(item):
                continue
            try:
                size += item.stat().st_size
                count += 1
            except OSError:
                errors += 1
    return {'bytes': size, 'files': count, 'unreadable': errors}


def collect(root):
    environment = root / '.venv'
    sites = [environment / 'Lib' / 'site-packages']
    sites.extend((environment / 'lib').glob('python*/site-packages'))
    groups = []
    for site in sites:
        if not site.is_dir() or linked(site):
            continue
        for path in site.iterdir():
            if path.is_dir() and not linked(path):
                groups.append({'component': path.name, **measure(path)})
    return {'venv': measure(environment), 'models': measure(root / 'models'),
            'components': sorted(groups, key=lambda item: item['bytes'], reverse=True),
            'present': {'venv': environment.is_dir(), 'models': (root / 'models').is_dir()},
            'note': 'Tailles des fichiers, pas espace physique sur disque. Liens et jonctions non suivis. Aucun fichier supprimé.'}


def format_report(report):
    def mib(item): return f"{item['bytes'] / 1024 ** 2:.1f} Mo"
    lines = ['POLYGLOT — DIAGNOSTIC ESPACE', 'Aucun nettoyage ni suppression effectué.', '',
             f"Environnement .venv : {mib(report['venv'])} ({report['venv']['files']} fichiers)",
             f"Modèles models : {mib(report['models'])} ({report['models']['files']} fichiers)", '']
    if not report['present']['venv']:
        lines.append('ATTENTION : .venv absent ici. Placez ce diagnostic dans le dossier qui contient .venv et relancez-le.')
    lines.append('Plus gros dossiers des bibliothèques (20 premiers) :')
    for item in report['components'][:20]:
        lines.append(f"{item['component']} : {mib(item)} ({item['files']} fichiers)")
    errors = report['venv']['unreadable'] + report['models']['unreadable']
    lines.extend(['', f'Erreurs de lecture : {errors}', report['note'],
                  'Ces mesures ne disent pas quels composants peuvent être supprimés. Ne supprimez rien sur cette seule base.'])
    return '\n'.join(lines) + '\n'


def main():
    root = Path(__file__).resolve().parent
    print('Analyse en cours. Cela peut prendre un moment avec les nombreux fichiers installés.', flush=True)
    report = collect(root)
    (root / 'RAPPORT_ESPACE.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    text = format_report(report)
    (root / 'RAPPORT_ESPACE.txt').write_text(text, encoding='utf-8-sig')
    print(text, flush=True)
    print('Rapport enregistré : RAPPORT_ESPACE.txt. Vous pouvez le transmettre pour analyse.', flush=True)


if __name__ == '__main__':
    main()
