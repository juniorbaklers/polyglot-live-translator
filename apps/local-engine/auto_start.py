"""Installation facultative d'un raccourci dans le Démarrage de l'utilisateur."""
import argparse
import os
import subprocess
import sys
from pathlib import Path
from startup import ROOT, load_pairing_code


def ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def create_shortcut(link, pythonw, root, precision=False):
    root = Path(root)
    launcher = root / 'launcher.py'
    arguments = '"' + str(launcher) + '"' + (' --precision' if precision else '')
    script = ("$ws=New-Object -ComObject WScript.Shell; "
              f"$s=$ws.CreateShortcut({ps_quote(link)}); "
              f"$s.TargetPath={ps_quote(pythonw)}; $s.Arguments={ps_quote(arguments)}; "
              f"$s.WorkingDirectory={ps_quote(root)}; $s.Description='Polyglot moteur local gratuit'; $s.Save()")
    subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], check=True)


def shortcut_path():
    return Path(os.environ['APPDATA']) / 'Microsoft/Windows/Start Menu/Programs/Startup/Polyglot Local.lnk'


def install(precision=False):
    if sys.platform != 'win32':
        raise RuntimeError('Cette installation automatique concerne Windows uniquement.')
    pythonw = ROOT / '.venv/Scripts/pythonw.exe'
    if not pythonw.is_file():
        raise RuntimeError('Lancez INSTALLER.cmd dans ce dossier avant d’activer le démarrage automatique.')
    code = load_pairing_code()
    link = shortcut_path(); link.parent.mkdir(parents=True, exist_ok=True)
    create_shortcut(link, pythonw, ROOT, precision)
    subprocess.Popen([str(pythonw), str(ROOT / 'launcher.py')] + (['--precision'] if precision else []), cwd=ROOT)
    print('Démarrage automatique activé pour votre compte Windows, sans fenêtre CMD.')
    if precision: print('Mode précision : le modèle small doit avoir été installé avec INSTALLER_PRECISION.cmd.')
    print('Démarrage du moteur demandé. Le chargement des modèles peut prendre un moment.')
    print(f'Code à enregistrer UNE FOIS dans l’extension : {code}')
    print('Gardez ce dossier à cet emplacement. Consultez moteur-auto.log si le moteur ne répond pas.')


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['install','remove','code']); parser.add_argument('--precision', action='store_true')
    args = parser.parse_args()
    if args.action == 'code':
        print(f'Code d’association conservé : {load_pairing_code()}'); return
    if sys.platform != 'win32': raise RuntimeError('Cette commande concerne Windows uniquement.')
    if args.action == 'install': install(args.precision)
    else:
        shortcut_path().unlink(missing_ok=True)
        print('Démarrage automatique désactivé. Le moteur déjà ouvert reste actif jusqu’à la fermeture de votre session Windows.')


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(f'Opération impossible : {error}'); raise SystemExit(1)
