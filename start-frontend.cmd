@echo off
cd /d "%~dp0frontend"
if not exist "node_modules" (
  echo Frontend packages are missing. Run setup-windows.cmd first.
  pause
  exit /b 1
)
echo Starting MuRec2 at http://localhost:5173
set "VITE_API_URL=http://127.0.0.1:8010/api"
"D:\npm.cmd" run dev
