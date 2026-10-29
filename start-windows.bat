@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Мастер на час - бот

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist ".env" goto install

echo.
echo === Первый запуск: настройка бота ===
echo.
set "TOKEN="
set /p TOKEN=Вставьте токен бота от BotFather (правый клик мышью = вставить) и нажмите Enter: 
if "%TOKEN%"=="" goto notoken
set "CHATID=8399366599"
set /p CHATID=Куда присылать заявки (id чата). Просто нажмите Enter, чтобы присылать вам лично: 
> ".env" echo TG_TOKEN=%TOKEN%
>> ".env" echo TG_CHAT_ID=%CHATID%
>> ".env" echo TG_POLLING=1
>> ".env" echo DEFAULT_CITY=Новосибирск
echo Настройки сохранены в файл .env
echo.

:install
rem ставим компоненты при каждом запуске: если всё уже на месте, это занимает пару секунд
echo Проверяю и устанавливаю нужные компоненты (при первом запуске до пары минут)...
call npm install --no-audit --no-fund --fetch-retries=5
if not errorlevel 1 goto checkinstall
rem основной сервер npm из России часто обрывает связь — пробуем зеркало
echo.
echo Основной сервер недоступен, пробую зеркало...
call npm install --no-audit --no-fund --fetch-retries=5 --registry=https://registry.npmmirror.com
if errorlevel 1 goto noinstall
:checkinstall
if not exist "node_modules\express\package.json" goto noinstall

:run
echo.
echo Бот запускается. НЕ закрывайте это окно, пока бот должен работать.
echo Панель диспетчера: http://localhost:3000/dispatcher
echo.
call npm start
goto fail

:nonode
echo.
echo Не установлен Node.js. Сейчас откроется сайт: скачайте версию LTS, установите
echo (везде жмите "Далее"), затем снова дважды кликните по этому файлу.
start https://nodejs.org/ru
pause
exit /b

:notoken
echo Токен не введён. Запустите файл ещё раз.
pause
exit /b

:noinstall
echo.
echo Компоненты не установились: нет связи с серверами npm.
echo Попробуйте включить VPN или раздать интернет с телефона и запустить файл ещё раз.
echo Если не поможет, сделайте скриншот этого окна и пришлите.
pause
exit /b

:fail
echo.
echo Программа остановилась. Сделайте скриншот этого окна и пришлите (токен закройте).
pause
