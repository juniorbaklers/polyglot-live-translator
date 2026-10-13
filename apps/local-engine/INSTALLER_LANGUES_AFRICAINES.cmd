@echo off
setlocal
cd /d "%~dp0"
echo Installation facultative, Internet necessaire une fois.
echo Mode experimental, modeles CC-BY-NC-4.0 : usage non commercial.
echo Arretez le moteur avant l'installation. Les autres langues sont conservees.
echo 1 : Dioula et wolof (modele partage)
echo 2 : Baoule (modele specialise)
echo 3 : Les trois langues
choice /c 123 /n /m "Choix [1/2/3] : "
if errorlevel 3 (set "POLYGLOT_AFRICAN_MODEL=all") else if errorlevel 2 (set "POLYGLOT_AFRICAN_MODEL=baoule") else (set "POLYGLOT_AFRICAN_MODEL=nllb")
if not exist ".venv-afrique\Scripts\python.exe" py -3.11 -m venv .venv-afrique
if errorlevel 1 goto :error
".venv-afrique\Scripts\python.exe" -m pip install --no-cache-dir torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 goto :error
".venv-afrique\Scripts\python.exe" -m pip install --no-cache-dir transformers==4.51.3 ctranslate2==4.6.0 sentencepiece==0.2.0 psutil==7.2.2 "huggingface_hub>=0.34,<1"
if errorlevel 1 goto :error
".venv-afrique\Scripts\python.exe" install_african_models.py --model %POLYGLOT_AFRICAN_MODEL%
if errorlevel 1 goto :error
echo Relancez maintenant votre moteur habituel puis rechargez la page video.
pause
exit /b 0
:error
echo Installation interrompue. Conservez vos anciens environnements et modeles.
pause
exit /b 1
