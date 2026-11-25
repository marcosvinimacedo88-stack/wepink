@echo off
rem Usado pela tarefa automatica do Windows (sem janela). Grava o que acontece em ponte.log
cd /d "%~dp0"
:inicio
echo %date% %time% iniciando ponte >> ponte.log
node --env-file=.env ponte.js >> ponte.log 2>&1
echo %date% %time% a ponte parou, reiniciando em 5 s >> ponte.log
ping -n 6 127.0.0.1 >nul
goto inicio
