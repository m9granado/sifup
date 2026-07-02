param(
  [int]$OlderThanMinutes = 0,
  [switch]$IncludePlaywrightMcp,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$now = Get-Date
$targets = New-Object System.Collections.Generic.List[object]

function Get-CreatedAt {
  param($Value)

  if ($Value -is [datetime]) { return $Value }
  if ($null -eq $Value) { return $now }

  try {
    return [Management.ManagementDateTimeConverter]::ToDateTime([string]$Value)
  }
  catch {
    return $now
  }
}

function Add-Target {
  param([object]$Process)

  $created = Get-CreatedAt $Process.CreationDate
  $ageMinutes = ($now - $created).TotalMinutes
  if ($ageMinutes -lt $OlderThanMinutes) { return }

  $targets.Add([pscustomobject]@{
    ProcessId = $Process.ProcessId
    ParentProcessId = $Process.ParentProcessId
    AgeMinutes = [math]::Round($ageMinutes, 0)
    MB = [math]::Round($Process.WorkingSetSize / 1MB, 1)
    CommandLine = $Process.CommandLine
  })
}

function Stop-ProcessTree {
  param([int]$ProcessId)

  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($item in $children) {
    Stop-ProcessTree -ProcessId $item.ProcessId
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object {
    $cmd = ""
    if ($null -ne $_.CommandLine) {
      $cmd = [string]$_.CommandLine
    }
    ($cmd -like "*$repoRoot*" -and ($cmd -like "*start-server.js*" -or $cmd -like "*next* dev*" -or $cmd -like "*.next*dev*")) -or
    ($IncludePlaywrightMcp -and $cmd -like "*@playwright*mcp*")
  } |
  ForEach-Object { Add-Target -Process $_ }

if ($targets.Count -eq 0) {
  Write-Host "No matching Node dev processes found."
  exit 0
}

$targets | Sort-Object MB -Descending | Format-Table ProcessId, ParentProcessId, AgeMinutes, MB, CommandLine -AutoSize

if ($DryRun) {
  Write-Host "Dry run only. Re-run without -DryRun to stop these processes."
  exit 0
}

foreach ($target in $targets) {
  Stop-ProcessTree -ProcessId $target.ProcessId
}

Write-Host "Stopped $($targets.Count) matching Node dev process(es)."
