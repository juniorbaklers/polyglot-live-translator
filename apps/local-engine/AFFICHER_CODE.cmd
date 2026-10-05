@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Lancez d abord INSTALLER.cmd.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" auto_start.py code
pause
