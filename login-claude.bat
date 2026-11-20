@echo off
chcp 65001 >nul
title 登入 Claude（儀表板橋接用，只需一次）
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js。請先安裝 Node.js 18 以上版本：https://nodejs.org
  pause
  exit /b 1
)
echo 公司 Claude 企業版通常要用「SSO 單一登入」。
echo 請輸入你的公司 Email（例如 xxx@公司網域），按 Enter：
set /p EMAIL=Email:
echo.
node claude-bridge.js --login --sso --email %EMAIL%
echo.
pause
