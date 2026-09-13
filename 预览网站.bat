@echo off
cd /d "%~dp0"
node build.js
start "" "%~dp0docs\index.html"
