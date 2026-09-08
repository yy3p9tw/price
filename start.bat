@echo off
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
start "" http://localhost:3000/
node server.js
pause
