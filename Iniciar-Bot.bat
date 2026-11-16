@echo off
title Bot de musica
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-bot.ps1" %*
echo.
pause
