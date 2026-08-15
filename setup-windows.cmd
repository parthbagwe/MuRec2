@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Python is not prepared yet. Ask Codex to set up D:\parthbagwe\MuRec2.
  pause
  exit /b 1
)
echo Installing Python packages...
".venv\Scripts\python.exe" -m pip install -r requirements-dev.txt
echo Installing frontend packages...
cd frontend
"D:\npm.cmd" install
echo.
echo Setup complete. Run start-backend.cmd and start-frontend.cmd.
pause
