@echo off
title SHADOW CLASH - server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this computer.
  echo   Install it once from https://nodejs.org  ^(LTS button^), then run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting SHADOW CLASH...
node server.js --open
pause
