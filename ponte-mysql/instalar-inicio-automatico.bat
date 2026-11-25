@echo off
rem Clique com o botao direito > Executar como administrador
cd /d "%~dp0"
net session >nul 2>&1 || (echo Execute este arquivo como ADMINISTRADOR ^(botao direito ^> Executar como administrador^). & pause & exit /b)
if not exist node_modules call npm install
schtasks /create /tn "Ponte MySQL Wepink" /tr "\"%~dp0ponte-servico.bat\"" /sc onstart /ru SYSTEM /rl HIGHEST /f
schtasks /run /tn "Ponte MySQL Wepink"
echo.
echo Pronto: a ponte agora liga sozinha junto com o computador, sem janela.
echo O registro fica no arquivo ponte.log desta pasta.
echo NAO use mais o iniciar-ponte.bat (as duas juntas brigam pela porta 8787).
pause
