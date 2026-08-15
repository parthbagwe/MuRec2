@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Python environment is missing. Run setup-windows.cmd first.
  pause
  exit /b 1
)
echo Starting MuRec2 API at http://localhost:8010
echo API documentation: http://localhost:8010/docs
".venv\Scripts\python.exe" -m uvicorn src.api.main:app --reload --host 127.0.0.1 --port 8010
