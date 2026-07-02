$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$now = Get-Date

function Get-NodeKind {
  param([string]$CommandLine)

  if ($CommandLine -like "*$repoRoot*" -and $CommandLine -like "*next* build*") { return "sifup-next-build" }
  if ($CommandLine -like "*$repoRoot*" -and ($CommandLine -like "*start-server.js*" -or $CommandLine -like "*next* dev*")) { return "sifup-next-dev" }
  if ($CommandLine -like "*$repoRoot*" -and $CommandLine -like "*.next*dev*") { return "sifup-next-worker" }
  if ($CommandLine -match "D:\\dev\\[^\\]+\\node_modules\\.*next.*start-server") { return "other-next-dev" }
  if ($CommandLine -match "D:\\dev\\[^\\]+\\.next\\dev") { return "other-next-worker" }
  if ($CommandLine -match "next(\\|/)dist(\\|/)bin(\\|/)next.* dev") { return "other-next-dev" }
  if ($CommandLine -like "*@playwright*mcp*") { return "playwright-mcp" }
  if ($CommandLine -like "*./mcp/server.mjs*") { return "mcp-server" }
  if ($CommandLine -like "*OpenAI*Codex*runtimes*") { return "codex-kernel" }
  return "other-node"
}

function Get-Text {
  param($Value)

  if ($null -eq $Value) { return "" }
  return [string]$Value
}

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

Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  ForEach-Object {
    $created = Get-CreatedAt $_.CreationDate
    $commandLine = Get-Text $_.CommandLine
    [pscustomobject]@{
      Kind = Get-NodeKind -CommandLine $commandLine
      Pid = $_.ProcessId
      PPid = $_.ParentProcessId
      AgeMinutes = [math]::Round(($now - $created).TotalMinutes, 0)
      MB = [math]::Round($_.WorkingSetSize / 1MB, 1)
      Command = $commandLine.Replace($repoRoot, ".")
    }
  } |
  Sort-Object Kind, MB -Descending |
  Format-Table -AutoSize
