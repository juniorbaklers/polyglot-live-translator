@echo off
setlocal
cd /d "%~dp0"
echo Installation facultative d'une voix Piper. Internet est necessaire une fois.
echo Utilisez l'environnement avec lequel vous lancez votre moteur.
echo 1 : moteur normal DEMARRER.cmd
echo 2 : moteur leger DEMARRER_LEGER.cmd
choice /c 12 /n /m "Choix [1/2] : "
if errorlevel 2 goto :light
set "POLYGLOT_VOICE_PYTHON=.venv\Scripts\python.exe"
goto :install
:light
set "POLYGLOT_VOICE_PYTHON=.venv-leger\Scripts\python.exe"
:install
if not exist "%POLYGLOT_VOICE_PYTHON%" (
  echo Environnement absent. Installez d'abord le moteur.
  pause
  exit /b 1
)
"%POLYGLOT_VOICE_PYTHON%" install_voice.py
pause
