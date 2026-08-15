@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Python environment is missing. Run setup-windows.cmd first.
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { $health = Invoke-RestMethod 'http://127.0.0.1:8010/api/health' -TimeoutSec 2; if ($health.status -eq 'ok') { exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 (
  echo MuRec2 API is already running at http://localhost:8010
  echo API documentation: http://localhost:8010/docs
  pause
  exit /b 0
)

echo Starting MuRec2 API at http://localhost:8010
echo API documentation: http://localhost:8010/docs
echo.
echo Please wait. The first start after an update may rebuild the recommendation models.
echo Keep this window open while using MuRec2.
echo.
".venv\Scripts\python.exe" -m uvicorn src.api.main:app --host 127.0.0.1 --port 8010
set "exit_code=%errorlevel%"
echo.
echo MuRec2 backend stopped with exit code %exit_code%.
if not "%exit_code%"=="0" echo Check the error shown above.
pause
exit /b %exit_code%
