@echo off
title Avatar Stream System - Server
echo ============================================
echo    Avatar Stream System v0.0.1
echo ============================================
echo.
echo Pruefe Installation...
if not exist "node_modules" (
    echo [WARNUNG] node_modules nicht gefunden!
    echo Fuehre zuerst install.bat aus.
    echo.
    echo Installiere automatisch...
    call npm install
    if %errorlevel% neq 0 (
        echo [FEHLER] Installation fehlgeschlagen!
        pause
        exit /b 1
    )
)
echo.
echo Starte Server...
echo.
echo    Overlay:  http://localhost:3000/overlay
echo    Admin:    http://localhost:3000/admin
echo.
echo Druecke STRG+C zum Beenden.
echo ============================================
echo.
node server.js
pause
