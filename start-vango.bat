@echo off
cd /d "%~dp0"
echo Installing packages...
npm install
echo.
echo Starting VanGo dev server...
npm run dev
pause
