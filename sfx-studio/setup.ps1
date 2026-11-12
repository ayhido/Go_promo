# Установка SFX Studio на Windows. Запуск из папки проекта в PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$Root = (Get-Location).Path

function Need($cmd, $msg) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host $msg; exit 1 } }
Need git "Нужен git: https://git-scm.com/download/win"
Need claude "Нужен Claude Code: https://claude.com/claude-code"

# Python 3.10-3.12, 64-бит (лаунчер py или python)
$PyArgs = @()
if (Get-Command py -ErrorAction SilentlyContinue) { $PyExe = "py"; $PyArgs = @("-3") }
elseif (Get-Command python -ErrorAction SilentlyContinue) { $PyExe = "python" }
else { Write-Host "Нужен Python 3.10-3.12 (64-бит): https://www.python.org/downloads/windows/"; exit 1 }

if (-not (Test-Path "davinci-resolve-mcp")) {
  git clone https://github.com/samuelgursky/davinci-resolve-mcp.git
}

Set-Location "davinci-resolve-mcp"
if (-not (Test-Path ".venv")) { & $PyExe @PyArgs -m venv .venv }
$VPy = Join-Path (Get-Location) ".venv\Scripts\python.exe"
& $VPy -m pip install --upgrade pip | Out-Null
if (Test-Path "requirements.txt") { & $VPy -m pip install -r requirements.txt }
else { & $VPy -m pip install "mcp[cli]>=1.30,<2" }
Set-Location $Root

$Api = Join-Path $env:PROGRAMDATA "Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting"
$Lib = "C:\Program Files\Blackmagic Design\DaVinci Resolve\fusionscript.dll"
if (-not (Test-Path $Lib)) { Write-Host "ВНИМАНИЕ: не найден $Lib - поправьте RESOLVE_SCRIPT_LIB в .mcp.json" }

$Srv = Join-Path $Root "davinci-resolve-mcp"
$Cfg = [ordered]@{ mcpServers = [ordered]@{
  higgsfield = [ordered]@{ type = "http"; url = "https://mcp.higgsfield.ai/mcp" }
  "davinci-resolve" = [ordered]@{
    command = $VPy
    args = @((Join-Path $Srv "src\server.py"))
    env = [ordered]@{
      RESOLVE_SCRIPT_API = $Api
      RESOLVE_SCRIPT_LIB = $Lib
      PYTHONPATH = (Join-Path $Api "Modules") + "\"
    }
  }
} }
$Json = $Cfg | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Join-Path $Root ".mcp.json"), $Json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Записан .mcp.json"

Write-Host @"

Готово. Осталось вручную:
1. DaVinci Resolve Studio: Preferences -> General -> External scripting using -> Local. Resolve держи открытым.
2. Запусти Claude Code в этой папке:  claude
3. Внутри набери /mcp -> higgsfield -> Authenticate (войти в Higgsfield).
   /mcp должен показать higgsfield и davinci-resolve как connected.
Потом:  /sfx

Управлять с iPhone: вместо "claude" запусти "claude remote-control" (см. IPHONE.md).
"@
