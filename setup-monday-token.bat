@echo off
chcp 65001 >nul
title 設定 monday token（只需一次）
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js。請先安裝 Node.js 18 以上版本：https://nodejs.org
  pause
  exit /b 1
)
node brief-cli.js setup
echo.
pause
