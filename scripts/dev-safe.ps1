param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$NextArgs
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

if ($NextArgs -contains "--help" -or $NextArgs -contains "-h") {
  Write-Host "Starts Next dev and force-stops its child process tree when this script exits."
  Write-Host "Usage: powershell -File scripts/dev-safe.ps1 [next dev args]"
  exit 0
}

$arguments = @("node_modules/next/dist/bin/next", "dev") + $NextArgs
$child = Start-Process -FilePath "node" -ArgumentList $arguments -NoNewWindow -PassThru

function Stop-ProcessTree {
  param([int]$ProcessId)

  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($item in $children) {
    Stop-ProcessTree -ProcessId $item.ProcessId
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

try {
  Wait-Process -Id $child.Id
}
finally {
  Stop-ProcessTree -ProcessId $child.Id
}
