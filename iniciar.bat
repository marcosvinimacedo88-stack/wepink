@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
echo Abrindo o portal em http://localhost:3000
node --env-file=.env server.js
pause
