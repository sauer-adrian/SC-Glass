@echo off
rem Builds SCGlass.exe (one file, no Python needed to run it). Needs Python 3.9+ to build.
cd /d "%~dp0"
py -3 -m pip install --upgrade pyinstaller || goto :fail
py -3 -m PyInstaller --noconfirm --onefile --console --name SCGlass --add-data "web;web" sc_glass.py || goto :fail
echo.
echo  Built dist\SCGlass.exe. Copy it anywhere and run it.
goto :end
:fail
echo  Build failed. See the messages above.
:end
pause
