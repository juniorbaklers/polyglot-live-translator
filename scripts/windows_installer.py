"""Installation utilisateur Windows, interface standard, sans droits admin."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
from contextlib import contextmanager

ARCHIVE = Path(__file__).resolve().parents[1]


def copy_distribution(source, destination):
    source, destination = Path(source), Path(destination)
    if not (source / 'extension/manifest.json').is_file() or not (source / 'moteur-local/server.py').is_file():
        raise ValueError('Décompressez toute l’archive avant de lancer l’installation.')
    if source.resolve() == destination.resolve():
        return  # interface déjà copiée dans l'installation ; aucune recopie
    for folder in ('moteur-local', 'extension'):
        for item in (source / folder).rglob('*'):
            if not item.is_file() or item.is_symlink():
                continue
            relative = item.relative_to(source / folder)
            if any(part.startswith('.venv') or part in ('models', '__pycache__') for part in relative.parts):
                continue
            target = destination / folder / relative
            if relative.name == 'VOCABULAIRE.txt' and target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(item, target.with_name(target.name + '.polyglot-new'))
            target.with_name(target.name + '.polyglot-new').replace(target)
    for relative in ('INSTALLER_POLYGLOT.vbs', 'installation/windows_installer.py'):
        item = source / relative
        if item.is_file():
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(item, target)


@contextmanager
def installation_lock(folder):
    folder.mkdir(parents=True, exist_ok=True)
    with open(folder / '.moteur-lock', 'a+b') as handle:
        if os.fstat(handle.fileno()).st_size == 0:
            handle.write(b'0'); handle.flush()
        handle.seek(0)
        import msvcrt
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as error:
            raise RuntimeError('Arrêtez le moteur Polyglot avant la mise à jour, puis réessayez.') from error
        try:
            yield
        finally:
            handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def run_logged(args, cwd, log, env=None):
    with subprocess.Popen(args, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, encoding='utf-8', errors='replace', creationflags=0x08000000) as process:
        for line in process.stdout:
            log(line.rstrip())
        if process.wait() != 0:
            raise RuntimeError('Installation interrompue. Consultez le journal ; vos modèles sont conservés.')


def stop_installed_engine(destination):
    if sys.platform != 'win32':
        raise RuntimeError('Commande Windows uniquement.')
    root = Path(destination).expanduser().resolve()
    if root.name == 'moteur-local': root = root.parent
    folder = str(root / 'moteur-local').replace("'", "''")
    script = r"""$engineRoot='%s';
$prefix=$engineRoot.TrimEnd('\')+'\';
$pattern='(?i)(?:launcher|server)\.py(?:[\s"]|$)';
$fullPattern='(?i)'+[regex]::Escape($prefix)+'(?:launcher|server)\.py(?:[\s"]|$)';
$targets=Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @('python.exe','pythonw.exe') -and $_.CommandLine -match $pattern -and
  (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) -or $_.CommandLine -match $fullPattern)
};
foreach($process in $targets){Stop-Process -Id $process.ProcessId -ErrorAction Stop}
Write-Output ('Moteurs du dossier arretes : '+@($targets).Count)
""" % folder
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
                            capture_output=True, text=True, timeout=15, creationflags=0x08000000)
    if result.returncode:
        raise RuntimeError('Arrêt impossible. Arrêtez le processus Polyglot dans le Gestionnaire des tâches.')
    return result.stdout.strip()


def install(destination, startup, log):
    if sys.platform != 'win32':
        raise RuntimeError('Cet installateur concerne Windows.')
    if sys.version_info[:2] != (3, 11) or sys.maxsize <= 2 ** 32:
        raise RuntimeError('Utilisez Python 3.11 64 bits avec le lanceur Python.')
    destination = Path(destination).expanduser().resolve()
    if destination.name == 'moteur-local':
        destination = destination.parent
    engine = destination / 'moteur-local'
    # Le verrou protège le dossier choisi ; le port empêche aussi un conflit
    # avec un ancien moteur installé ailleurs.
    with socket.socket() as connection:
        connection.settimeout(.4)
        if connection.connect_ex(('127.0.0.1', 47833)) == 0:
            raise RuntimeError('Un moteur Polyglot fonctionne encore. Arrêtez-le avant de continuer.')
    with installation_lock(engine):
        copy_distribution(ARCHIVE, destination)
        # Mise à jour : conserver l'environnement normal existant. Installation
        # neuve : profil léger, sans importer PyTorch/spaCy dans le moteur.
        light = not (engine / '.venv/Scripts/python.exe').exists()
        environment = engine / ('.venv-leger' if light else '.venv')
        python = environment / 'Scripts/python.exe'
        if not python.is_file():
            log('Création de l’environnement Python…')
            run_logged([sys.executable, '-m', 'venv', str(environment)], engine, log)
        env = os.environ.copy()
        env['PYTHONUTF8'] = '1'
        if light:
            env['POLYGLOT_TRANSLATION_BACKEND'] = 'light'
        else:
            env.pop('POLYGLOT_TRANSLATION_BACKEND', None)
        check = subprocess.run([str(python), '-c', 'import faster_whisper, argostranslate.package, websockets, psutil, numpy'],
                               cwd=engine, env=env, capture_output=True, creationflags=0x08000000)
        if check.returncode:
            log('Installation des bibliothèques nécessaires…')
            run_logged([str(python), '-m', 'pip', 'install', '--no-cache-dir', '-r',
                        'requirements-leger.txt' if light else 'requirements.txt'], engine, log, env)
            if light:
                run_logged([str(python), '-m', 'pip', 'install', '--no-cache-dir', '--no-deps', 'argostranslate==1.11.0'], engine, log, env)
        if not (engine / 'installation-ok.txt').is_file():
            log('Installation initiale des modèles. Internet et espace disque sont nécessaires ; cela peut prendre plusieurs minutes.')
            run_logged([str(python), 'install_models.py'], engine, log, env)
        else:
            log('Modèles existants conservés, sans nouveau téléchargement demandé.')
        config = {'version': 1, 'root': str(destination), 'python': str(python), 'light': light}
        (destination / 'installation.json').write_text(json.dumps(config, indent=2), encoding='utf-8')
    sys.path.insert(0, str(engine))
    from auto_start import create_shortcut
    pythonw = environment / 'Scripts/pythonw.exe'
    desktop = destination / 'DEMARRER_POLYGLOT.lnk'
    create_shortcut(desktop, pythonw, engine, light=light)
    link = Path(os.environ['APPDATA']) / 'Microsoft/Windows/Start Menu/Programs/Startup/Polyglot Local.lnk'
    if startup:
        link.parent.mkdir(parents=True, exist_ok=True)
        create_shortcut(link, pythonw, engine, light=light)
        log('Démarrage automatique activé pour votre compte Windows.')
    else:
        link.unlink(missing_ok=True)
        log('Démarrage automatique désactivé. Le raccourci manuel reste disponible.')
    subprocess.Popen([str(pythonw), str(engine / 'launcher.py')] + (['--light'] if light else []), cwd=engine)
    return destination


def main():
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
    window = tk.Tk(); window.title('Installer Polyglot Live'); window.geometry('690x640'); window.minsize(620, 600)
    frame = ttk.Frame(window, padding=18); frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='Polyglot Live — installation et mise à jour', font=('Segoe UI', 16, 'bold')).pack(anchor='w')
    ttk.Label(frame, text='Déjà installé ? Choisissez le dossier qui contient moteur-local et extension.\n'
              'Vos modèles, votre environnement et votre vocabulaire seront conservés.').pack(anchor='w', pady=8)
    initial = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'PolyglotLive'
    if (ARCHIVE / 'installation.json').is_file():
        try:
            configured = json.loads((ARCHIVE / 'installation.json').read_text(encoding='utf-8')).get('root')
            if isinstance(configured, str) and (Path(configured) / 'moteur-local/server.py').is_file():
                initial = Path(configured)
        except (ValueError, OSError):
            pass
    path = tk.StringVar(value=str(initial))
    ttk.Entry(frame, textvariable=path).pack(fill='x')
    ttk.Button(frame, text='Choisir le dossier…', command=lambda: choose()).pack(anchor='w', pady=5)
    automatic = tk.BooleanVar(value=True)
    ttk.Checkbutton(frame, text='Démarrer le moteur automatiquement à l’ouverture de Windows', variable=automatic).pack(anchor='w', pady=5)
    text = tk.Text(frame, height=8, wrap='word', state='disabled'); text.pack(fill='both', expand=True, pady=8)
    def log(value):
        def append():
            text.configure(state='normal'); text.insert('end', value + '\n'); text.see('end'); text.configure(state='disabled')
        window.after(0, append)
    def choose():
        value = filedialog.askdirectory(title='Dossier actuel de Polyglot')
        if value: path.set(value)
    busy = False
    def stop_engine():
        if busy: return
        if not messagebox.askyesno('Arrêter le moteur choisi', 'Arrêtez d’abord la traduction dans l’extension et exportez votre transcription.\n'
                                   'Arrêter maintenant uniquement le moteur du dossier choisi ?'): return
        try: log(stop_installed_engine(path.get()))
        except Exception as error: messagebox.showerror('Arrêt du moteur', str(error))
    ttk.Button(frame, text='Arrêter le moteur du dossier choisi', command=stop_engine).pack(anchor='w', pady=3)
    def start():
        nonlocal busy
        if busy: return
        chosen, auto = path.get(), automatic.get()
        busy = True; button.configure(state='disabled')
        def done(root=None, error=None):
            nonlocal busy
            busy = False; button.configure(state='normal')
            if error:
                messagebox.showerror('Installation interrompue', str(error)); return
            messagebox.showinfo('Installation terminée', 'Moteur démarré.\n\nDans Chrome ou Edge : ouvrez la page des extensions, activez le mode développeur, '
                'puis chargez le dossier :\n' + str(root / 'extension') + '\n\nSi ce dossier est déjà chargé, cliquez sur Recharger.')
            os.startfile(str(root / 'extension'))
        def work():
            try:
                root = install(chosen, auto, log)
                window.after(0, lambda: done(root=root))
            except Exception as error:
                detail = str(error); log(detail)
                window.after(0, lambda: done(error=detail))
        threading.Thread(target=work, daemon=False).start()
    button = ttk.Button(frame, text='Installer / mettre à jour', command=start); button.pack(anchor='e')
    test_backend = tk.StringVar(value='Traduction classique')
    ttk.Label(frame, text='Traduction à tester').pack(anchor='w', pady=3)
    ttk.Combobox(frame, textvariable=test_backend, values=('Traduction classique','Expert IA local (Ollama)'), state='readonly', width=30).pack(anchor='w')
    def test_engine():
        nonlocal busy
        if busy: return
        root = Path(path.get()).expanduser().resolve()
        if root.name == 'moteur-local': root = root.parent
        engine = root / 'moteur-local'
        backend = 'ollama' if test_backend.get() == 'Expert IA local (Ollama)' else 'classic'
        output = root / f'validation-{backend}.json'
        python = next((engine / name / 'Scripts/python.exe' for name in ('.venv', '.venv-leger')
                       if (engine / name / 'Scripts/python.exe').is_file()), None)
        if python is None:
            messagebox.showerror('Moteur absent', 'Installez le moteur dans ce dossier avant de le tester.'); return
        messagebox.showinfo('Test de traduction', 'Laissez le moteur lancé, mais arrêtez la traduction dans l’extension.\n'
                            'Le test utilise huit textes de contrôle et ouvre un rapport à relire.')
        busy = True; button.configure(state='disabled')
        def work():
            try:
                run_logged([str(python), 'validate_translation.py', '--engine', backend, '--output', str(output)], engine, log)
                window.after(0, lambda: os.startfile(str(output.with_suffix('.html'))))
            except Exception as error:
                log(str(error))
            finally:
                def finish():
                    nonlocal busy
                    busy = False; button.configure(state='normal')
                window.after(0, finish)
        threading.Thread(target=work, daemon=False).start()
    ttk.Button(frame, text='Tester le moteur et ouvrir le rapport', command=test_engine).pack(anchor='e', pady=5)
    window.protocol('WM_DELETE_WINDOW', lambda: messagebox.showinfo('Installation en cours', 'Attendez la fin de l’installation.') if busy else window.destroy())
    window.mainloop()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if sys.platform == 'win32':
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, str(error), 'Polyglot — interface indisponible', 16)
        else:
            raise
