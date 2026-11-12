# SFX Studio - установка всего одной командой (Windows 10/11). В PowerShell:
#   irm https://raw.githubusercontent.com/ayhido/Go_promo/main/sfx-studio/install.ps1 | iex
# Ставит: Git, Python 3.12, Claude Code, проект в %USERPROFILE%\sfx-studio, Resolve MCP.
# DaVinci Resolve Studio (платный) нужно установить самому.
& {
$ErrorActionPreference = "Stop"
$Repo = "ayhido/Go_promo"
$Branches = @("main", "claude/festive-ptolemy-s9g9hp")
$Dest = Join-Path $env:USERPROFILE "sfx-studio"

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path", "User") + ";" +
              (Join-Path $env:USERPROFILE ".local\bin")
}
function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }

if (-not (Has winget)) { Write-Host "Нет winget. Установите 'App Installer' из Microsoft Store и запустите снова."; return }

Write-Host "== 1/5 Git"
if (-not (Has git)) { winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements; Refresh-Path }

Write-Host "== 2/5 Python 3.12"
if (-not (Has py)) { winget install --id Python.Python.3.12 -e --silent --accept-package-agreements --accept-source-agreements; Refresh-Path }

Write-Host "== 3/5 Claude Code"
Refresh-Path
if (-not (Has claude)) { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression; Refresh-Path }
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$LocalBin = Join-Path $env:USERPROFILE ".local\bin"
if ($UserPath -notlike "*$LocalBin*") { [Environment]::SetEnvironmentVariable("Path", "$UserPath;$LocalBin", "User") }

Write-Host "== 4/5 Скачиваю проект в $Dest"
$Tmp = Join-Path $env:TEMP ("sfx-" + [guid]::NewGuid())
New-Item -ItemType Directory $Tmp | Out-Null
$Src = $null
foreach ($b in $Branches) {
  try {
    $Zip = Join-Path $Tmp "src.zip"
    Invoke-WebRequest "https://github.com/$Repo/archive/refs/heads/$b.zip" -OutFile $Zip -UseBasicParsing
    Expand-Archive $Zip -DestinationPath (Join-Path $Tmp $b.Replace("/", "_")) -Force
    $Cand = Get-ChildItem (Join-Path $Tmp $b.Replace("/", "_")) -Directory | ForEach-Object { Join-Path $_.FullName "sfx-studio" } | Where-Object { Test-Path (Join-Path $_ "setup.ps1") } | Select-Object -First 1
    if ($Cand) { $Src = $Cand; break }
  } catch { }
}
if (-not $Src) { Write-Host "Не удалось скачать проект с GitHub."; return }
New-Item -ItemType Directory $Dest -Force | Out-Null
Copy-Item (Join-Path $Src "*") $Dest -Recurse -Force
Copy-Item (Join-Path $Src ".claude") $Dest -Recurse -Force
Copy-Item (Join-Path $Src ".gitignore") $Dest -Force
Remove-Item $Tmp -Recurse -Force

Write-Host "== 5/5 Resolve MCP"
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dest "setup.ps1")

if (-not (Test-Path "C:\Program Files\Blackmagic Design\DaVinci Resolve\Resolve.exe")) {
  Write-Host "`nDaVinci Resolve не найден. Установите DaVinci Resolve Studio: https://www.blackmagicdesign.com/products/davinciresolve"
}
Write-Host "`nДальше: откройте НОВОЕ окно PowerShell и выполните:`n  cd $Dest`n  claude"
}
