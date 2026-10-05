"""Lanceur Windows sans console, avec journal rotatif et verrou d'instance."""
import asyncio
import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class LogStream:
    def __init__(self, logger): self.logger = logger
    def write(self, text):
        text = text.strip()
        for line in text.splitlines():
            if line and not line.startswith('Code d’association :'):
                self.logger.info(line)
        return len(text)
    def flush(self): pass


def run():
    os.chdir(ROOT)
    os.environ['POLYGLOT_MODE'] = 'precision' if '--precision' in sys.argv else 'equilibre'
    logger = logging.getLogger('polyglot-launcher'); logger.setLevel(logging.INFO)
    handler = RotatingFileHandler(ROOT / 'moteur-auto.log', maxBytes=1_000_000, backupCount=1, encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(asctime)s %(message)s')); logger.addHandler(handler)
    sys.stdout = sys.stderr = LogStream(logger)
    try:
        from server import main
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except RuntimeError as error:
        logger.error(str(error))
    except Exception:
        logger.exception('Démarrage automatique impossible')
    finally:
        handler.close()


if __name__ == '__main__': run()
