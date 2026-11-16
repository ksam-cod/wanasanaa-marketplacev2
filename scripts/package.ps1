# Builds a clean, shareable ZIP of the project for opening in VS Code.
# Excludes dependencies, the local database, secrets, uploads and this archive folder.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$download = Join-Path $root "download"
$stageRoot = Join-Path $download ".stage"
$stage = Join-Path $stageRoot "wanasanaa-marketplace"
$zip = Join-Path $download "wanasanaa-marketplace.zip"

if (Test-Path $stageRoot) { Remove-Item $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
New-Item -ItemType Directory -Force -Path $download | Out-Null

$excludeDirs = @("node_modules", ".pgdata", ".pgdata-test", ".cloud-attachments", ".freebuff", ".git", "download", "uploads")
$excludeFiles = @(".env", "*.log")

$roboArgs = @($root, $stage, "/E", "/XD") + $excludeDirs + @("/XF") + $excludeFiles +
  @("/NFL", "/NDL", "/NJH", "/NJS", "/NP")
& robocopy @roboArgs | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

New-Item -ItemType Directory -Force -Path (Join-Path $stage "uploads") | Out-Null
Set-Content -Path (Join-Path $stage "uploads\.gitkeep") -Value "" -NoNewline

if (Test-Path $zip) { Remove-Item $zip -Force }
# Archive the staging folder itself so extracting yields one project directory.
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal

Remove-Item $stageRoot -Recurse -Force

$sizeMb = (Get-Item $zip).Length / 1MB
Write-Output ("Created {0} ({1:N2} MB)" -f $zip, $sizeMb)
