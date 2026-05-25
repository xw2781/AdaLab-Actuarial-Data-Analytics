@echo off
setlocal

cd /d "%~dp0"

echo Step 2: Releasing beta\ARCRHO_BETA.xlam to E:\ArcRho Server\Excel Add-ins\ArcRho.xlam...
echo This archives the existing ArcRho.xlam and overwrites it from the beta add-in.
echo.
choice /C YN /N /M "Continue with release? [Y/N] "
if errorlevel 2 (
    echo Release cancelled.
    echo.
    pause
    exit /b 1
)

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0release_xlam.ps1"

echo.
if errorlevel 1 (
    echo Step 2 failed. See the messages above.
) else (
    echo Step 2 completed successfully.
)

echo.
pause
