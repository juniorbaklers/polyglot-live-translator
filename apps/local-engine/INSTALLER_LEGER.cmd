@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Gardez ce fichier dans votre moteur actuel contenant .venv.
  pause
  exit /b 1
)
echo Reference avec votre moteur actuel. Aucun fichier n est supprime.
".venv\Scripts\python.exe" verification_legere.py --reference
if errorlevel 1 goto :error
py -3.11 --version >nul 2>&1
if errorlevel 1 goto :error
if not exist ".venv-leger\Scripts\python.exe" py -3.11 -m venv .venv-leger
if errorlevel 1 goto :error
".venv-leger\Scripts\python.exe" -m pip install --no-cache-dir -r requirements-leger.txt
if errorlevel 1 goto :error
".venv-leger\Scripts\python.exe" -m pip install --no-cache-dir --no-deps argostranslate==1.11.0
if errorlevel 1 goto :error
".venv-leger\Scripts\python.exe" verification_legere.py
if errorlevel 1 goto :error
".venv-leger\Scripts\python.exe" -c "from pathlib import Path; Path('moteur-leger-verifie.txt').write_text('Comparaison locale reussie. Tester la video avant de retirer l ancien environnement.\n',encoding='utf-8')"
if errorlevel 1 goto :error
echo Essai pret : fermez l ancien moteur, puis lancez DEMARRER_LEGER.cmd.
echo L ancien .venv est conserve. L espace total augmente pendant cet essai.
pause
exit /b 0
:error
echo Essai interrompu. Votre moteur actuel est conserve et reste le choix normal.
if exist "moteur-leger-verifie.txt" del "moteur-leger-verifie.txt"
pause
exit /b 1
