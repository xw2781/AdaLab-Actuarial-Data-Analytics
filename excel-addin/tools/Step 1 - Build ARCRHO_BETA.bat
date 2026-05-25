@echo off
setlocal

cd /d "%~dp0"

echo Step 1: Building beta\ARCRHO_BETA.xlam from src_vba...
echo This updates the beta add-in only.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_xlam.ps1"

echo.
if errorlevel 1 (
    echo Step 1 failed. See the messages above.
) else (
    echo Step 1 completed successfully.
    echo Review beta\ARCRHO_BETA.xlam before running Step 2.
)

echo.
pause
