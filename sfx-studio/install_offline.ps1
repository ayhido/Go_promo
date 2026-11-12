# SFX Studio без Claude - установка одной командой (Windows). В PowerShell:
#   irm https://raw.githubusercontent.com/ayhido/Go_promo/main/sfx-studio/install_offline.ps1 | iex
# Ставит Python 3.12, создает Документы\Mentol\{Chorts,Mem,музыка}, скачивает скрипты в %USERPROFILE%\sfx-studio.
# Claude Code и интернет для работы не нужны. DaVinci Resolve Studio установите сами.
& {
$ErrorActionPreference = "Stop"
$Repo = "ayhido/Go_promo"
$Branches = @("main", "claude/festive-ptolemy-s9g9hp")
$Dest = Join-Path $env:USERPROFILE "sfx-studio"
function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }

Write-Host "== 1/3 Python 3.12"
if (-not (Has py)) {
  if (-not (Has winget)) { Write-Host "Нет winget. Установите Python 3.12 (64-бит) с python.org и запустите снова."; return }
  winget install --id Python.Python.3.12 -e --silent --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

Write-Host "== 2/3 Папки Mentol"
$Docs = [Environment]::GetFolderPath("MyDocuments")
$Mentol = Join-Path $Docs "Mentol"
foreach ($n in @("Chorts", "Mem", "музыка")) { New-Item -ItemType Directory -Force -Path (Join-Path $Mentol $n) | Out-Null }
Write-Host "   $Mentol"

Write-Host "== 3/3 Скрипты в $Dest"
$Tmp = Join-Path $env:TEMP ("sfx-" + [guid]::NewGuid())
New-Item -ItemType Directory $Tmp | Out-Null
$Src = $null
foreach ($b in $Branches) {
  try {
    $D = Join-Path $Tmp $b.Replace("/", "_")
    New-Item -ItemType Directory $D | Out-Null
    Invoke-WebRequest "https://github.com/$Repo/archive/refs/heads/$b.zip" -OutFile (Join-Path $D "src.zip") -UseBasicParsing
    Expand-Archive (Join-Path $D "src.zip") -DestinationPath $D -Force
    $Cand = Get-ChildItem $D -Directory | ForEach-Object { Join-Path $_.FullName "sfx-studio" } | Where-Object { Test-Path (Join-Path $_ "sfx_markers.py") } | Select-Object -First 1
    if ($Cand) { $Src = $Cand; break }
  } catch { }
}
if (-not $Src) { Write-Host "Не удалось скачать скрипты с GitHub."; return }
New-Item -ItemType Directory $Dest -Force | Out-Null
Copy-Item (Join-Path $Src "*") $Dest -Recurse -Force
Remove-Item $Tmp -Recurse -Force

if (-not (Test-Path "C:\Program Files\Blackmagic Design\DaVinci Resolve\Resolve.exe")) {
  Write-Host "`nDaVinci Resolve не найден: https://www.blackmagicdesign.com/products/davinciresolve"
}
Write-Host @"

Готово.
1. Звуки кладите в: $Mentol\музыка  (whoosh_01.wav, удар_1.wav ... или подпапки whoosh\, удар\)
2. В Resolve: Preferences -> General -> External scripting using -> Local
3. На таймлайне ставьте маркеры (M), в имени маркера - тип звука: whoosh, удар ...
4. Запуск: $Dest\run_markers.bat
"@
explorer $Mentol
}
