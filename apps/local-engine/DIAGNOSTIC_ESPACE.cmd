@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" diagnostic_espace.py
) else (
  py -3.11 diagnostic_espace.py
)
if errorlevel 1 echo Diagnostic interrompu. Verifiez Python et que les deux fichiers sont dans le meme dossier.
pause
