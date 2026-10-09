@echo off
setlocal
cd /d "%~dp0"
py -3.11 --version >nul 2>&1
if errorlevel 1 (
  echo Installez Python 3.11 64 bits depuis https://www.python.org/downloads/
  echo Conservez le lanceur Python py pendant l'installation.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" py -3.11 -m venv .venv
if errorlevel 1 goto :error
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :error
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :error
".venv\Scripts\python.exe" install_models.py
if errorlevel 1 goto :error
echo Installation terminee. Lancez DEMARRER.cmd.
pause
exit /b 0
:error
echo Installation interrompue. Verifiez le message ci-dessus et votre connexion Internet.
pause
exit /b 1
