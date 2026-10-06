@echo off
setlocal
rem Queetai launcher: start local server if not running, then open Edge app-mode window
rem This file lives INSIDE the app dir; %~dp0 resolves the (Unicode) path at runtime.
set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"

netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto open

  echo [tagex] starting local server (minimized, ~10s)...
  start "tagex-server" /min cmd /c "cd /d "%APP_DIR%" && npm run dev"
timeout /t 10 /nobreak >nul

:open
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:3000
) else (
  start "" http://localhost:3000
)
endlocal
