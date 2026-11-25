@echo off
title Ponte MySQL - Portal Wepink (NAO FECHE)
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
:inicio
node --env-file=.env ponte.js
echo.
echo ============================================================
echo  A PONTE PAROU. Tire um print desta janela e mande ao suporte.
echo  Reiniciando sozinha em 5 segundos...
echo ============================================================
timeout /t 5 /nobreak >nul
goto inicio
