"""Association persistante et verrou local partagé par les deux lanceurs."""
import os
import secrets
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load_pairing_code(root=ROOT):
    path = Path(root) / '.association-code'
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(descriptor, 'w', encoding='ascii') as file:
            file.write(f'{secrets.randbelow(1_000_000):06d}')
    code = path.read_text(encoding='ascii').strip()
    if len(code) != 6 or not code.isascii() or not code.isdecimal():
        raise ValueError('Code local invalide. Arrêtez le moteur, supprimez .association-code puis relancez-le et associez de nouveau l’extension.')
    return code


@contextmanager
def single_instance(root=ROOT):
    file = open(Path(root) / '.moteur-lock', 'a+b')
    try:
        if os.fstat(file.fileno()).st_size == 0:
            file.write(b'0'); file.flush()
        file.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeError('Le moteur est déjà lancé dans ce dossier. Utilisez directement l’extension.') from error
        try:
            yield
        finally:
            file.seek(0)
            if os.name == 'nt':
                msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(file.fileno(), fcntl.LOCK_UN)
    finally:
        file.close()
