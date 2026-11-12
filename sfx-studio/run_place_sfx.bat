@echo off
cd /d "%~dp0"
if exist "davinci-resolve-mcp\.venv\Scripts\python.exe" (
  "davinci-resolve-mcp\.venv\Scripts\python.exe" place_sfx.py
) else (
  py -3 place_sfx.py
)
pause
