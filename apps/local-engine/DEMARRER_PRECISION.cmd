@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Lancez d abord INSTALLER.cmd dans ce dossier.
  pause
  exit /b 1
)
set POLYGLOT_MODE=precision
".venv\Scripts\python.exe" server.py
if errorlevel 1 (
  echo Operation interrompue. Lisez le message ci-dessus.
)
pause
