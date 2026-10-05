@echo off
setlocal
cd /d "%~dp0"
if not exist "moteur-leger-verifie.txt" (
  echo Lancez INSTALLER_LEGER.cmd et attendez la comparaison reussie.
  pause
  exit /b 1
)
if not exist ".venv-leger\Scripts\python.exe" (
  echo Lancez INSTALLER_LEGER.cmd.
  pause
  exit /b 1
)
set "POLYGLOT_TRANSLATION_BACKEND=light"
".venv-leger\Scripts\python.exe" server.py
pause
