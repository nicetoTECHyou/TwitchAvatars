@echo off
title Avatar Stream System - Installer
echo ============================================
echo    Avatar Stream System v0.0.2
echo ============================================
echo.
echo Pruefe Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [FEHLER] Node.js ist nicht installiert!
    echo Bitte Node.js von https://nodejs.org herunterladen und installieren.
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js gefunden.
echo.
echo Installiere Abhaengigkeiten...
call npm install
if %errorlevel% neq 0 (
    echo [FEHLER] Installation fehlgeschlagen!
    pause
    exit /b 1
)
echo.
echo ============================================
echo    Installation abgeschlossen!
echo ============================================
echo.
echo Naechste Schritte:
echo   1. start.bat ausfuehren
echo   2. http://localhost:3000/admin oeffnen
echo   3. Twitch/Kick Kanal eintragen und verbinden
echo   4. http://localhost:3000/overlay in OBS als Browser-Quelle
echo.
pause
