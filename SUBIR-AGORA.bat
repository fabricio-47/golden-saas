@echo off
cd /d "%USERPROFILE%\golden-saas-update"
echo Enviando para o GitHub...
git push origin HEAD
echo.
echo Pronto! O Render vai atualizar sozinho em ~2 min. Pode fechar.
pause
