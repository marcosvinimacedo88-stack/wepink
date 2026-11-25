@echo off
rem Clique com o botao direito > Executar como administrador
schtasks /end /tn "Ponte MySQL Wepink" >nul 2>&1
schtasks /delete /tn "Ponte MySQL Wepink" /f
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -match 'ponte.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Inicio automatico removido. Para usar com janela, abra o iniciar-ponte.bat.
pause
