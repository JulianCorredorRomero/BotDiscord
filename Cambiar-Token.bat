@echo off
title Bot de musica - cambiar token
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-bot.ps1" -NuevoToken
echo.
pause
