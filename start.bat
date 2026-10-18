@echo off
title SC Glass
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 sc_glass.py %*
  goto end
)
where python >nul 2>nul
if %errorlevel%==0 (
  python sc_glass.py %*
  goto end
)
echo.
echo  Python 3.9 or newer is needed. Get it from https://www.python.org/downloads/
echo  (tick "Add python.exe to PATH" during install), then run start.bat again.
echo.
:end
pause
