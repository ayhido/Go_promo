@echo off
cd /d "%~dp0"
if exist "davinci-resolve-mcp\.venv\Scripts\python.exe" (
  "davinci-resolve-mcp\.venv\Scripts\python.exe" sfx_markers.py
) else (
  py -3 sfx_markers.py
)
pause
