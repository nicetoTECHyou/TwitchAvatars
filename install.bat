@echo off
title Avatar Stream System - Installer
echo ============================================
echo    Avatar Stream System - Installation
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
echo Starte den Server mit: start.bat
echo.
pause
