param(
  [string]$Destination = 'outputs\NinTranslate-Source.zip'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$destinationPath = [IO.Path]::GetFullPath((Join-Path $projectRoot $Destination))
$outputsRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'outputs'))
if (-not $destinationPath.StartsWith($outputsRoot + [IO.Path]::DirectorySeparatorChar)) {
  throw 'Source archive destination must remain inside the project outputs directory.'
}

$excludedTopLevel = @(
  '.git', '.rapidocr-build', '.rapidocr-venv', '.vitest-storage',
  '.ci-electron-builder-cache', '.ci-electron-builder-cache-debug',
  '.ci-electron-builder-cache-override', '.download-cache',
  'build', 'dist', 'dist-electron', 'node_modules', 'output', 'outputs', 'release'
)

New-Item -ItemType Directory -Force -Path $outputsRoot | Out-Null
if (Test-Path -LiteralPath $destinationPath) {
  Remove-Item -LiteralPath $destinationPath
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$archive = [IO.Compression.ZipFile]::Open($destinationPath, [IO.Compression.ZipArchiveMode]::Create)
try {
  $files = Get-ChildItem -LiteralPath $projectRoot -Recurse -File | Where-Object {
    $relative = $_.FullName.Substring($projectRoot.Length + 1)
    $topLevel = $relative.Split([IO.Path]::DirectorySeparatorChar, 2)[0]
    if ($excludedTopLevel -contains $topLevel) { return $false }
    if ($topLevel -eq 'docs' -and [IO.Path]::GetFileName($relative) -like 'Mac*.txt') { return $false }
    if ($relative.StartsWith("resources$([IO.Path]::DirectorySeparatorChar)rapidocr$([IO.Path]::DirectorySeparatorChar)runtime$([IO.Path]::DirectorySeparatorChar)")) { return $false }
    return $true
  }
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $file.FullName,
      "NinTranslate-Source/$relative",
      [IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $archive.Dispose()
}

$result = Get-Item -LiteralPath $destinationPath
Write-Output "Created $($result.FullName) ($($result.Length) bytes)."
