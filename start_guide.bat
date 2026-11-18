@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在啟動本機伺服器並自動同步最新 OP.GG / ARAMGG / Riot 資料...
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
timeout /t 2 /nobreak >nul
start "" "http://localhost:8765/"
echo 已開啟 http://localhost:8765/（背景同步完成後網頁將自動熱更新最新數據）
