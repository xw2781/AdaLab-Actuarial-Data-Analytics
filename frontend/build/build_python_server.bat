@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "APP_ROOT=%%~fI"
cd /d "%APP_ROOT%"

if not defined PYTHON_EXE (
    for /f "usebackq delims=" %%I in (`py -3.10 -c "import sys; print(sys.executable)" 2^>nul`) do set "PYTHON_EXE=%%I"
)
if not defined PYTHON_EXE set "PYTHON_EXE=python"

if "%~1"=="--version" (
    "%PYTHON_EXE%" -m PyInstaller --version
    exit /b %ERRORLEVEL%
)

set "PYINSTALLER_ARGS=build\server.spec --distpath python_dist --workpath python_build --noconfirm"
if "%~1"=="--clean" set "PYINSTALLER_ARGS=%PYINSTALLER_ARGS% --clean"

"%PYTHON_EXE%" -m PyInstaller %PYINSTALLER_ARGS%
exit /b %ERRORLEVEL%
