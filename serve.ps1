param(
  [int]$Port = 8765,
  [switch]$NoAutoSync
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $root) { $root = "C:\Users\user\.gemini\antigravity\scratch\lol-hex-guide" }
$cacheDir = Join-Path $root ".cache"
$statusPath = Join-Path $cacheDir "sync_status.json"
$syncScript = Join-Path $root "sync_data.ps1"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

$script:syncProc = $null

function Start-DataSyncProcess {
  if ($script:syncProc -and -not $script:syncProc.HasExited) {
    return $false
  }
  if (-not (Test-Path $syncScript)) {
    return $false
  }
  $initStatus = @{
    state = "running"
    progress = "0/5"
    message = "啟動後自動同步中，正在連線 OP.GG / ARAMGG / Riot..."
    startedAt = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    updatedAt = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
  } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($statusPath, $initStatus, [System.Text.Encoding]::UTF8)

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "powershell.exe"
  $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$syncScript`" -Quiet"
  $psi.WorkingDirectory = $root
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $psi.CreateNoWindow = $true
  $psi.UseShellExecute = $false
  $script:syncProc = [System.Diagnostics.Process]::Start($psi)
  return $true
}

if (-not $NoAutoSync) {
  $started = Start-DataSyncProcess
  if ($started) { Write-Host "Started automatic startup data sync..." }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".svg"  = "image/svg+xml"
}

function Send-Json($resp, [string]$jsonStr, [int]$code = 200) {
  $resp.StatusCode = $code
  $resp.ContentType = "application/json; charset=utf-8"
  $resp.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonStr)
  $resp.ContentLength64 = $bytes.Length
  $resp.OutputStream.Write($bytes, 0, $bytes.Length)
  $resp.Close()
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $reqPath = $ctx.Request.Url.LocalPath
  $method = $ctx.Request.HttpMethod

  if ($reqPath -eq "/api/sync-status" -and $method -eq "GET") {
    $body = if (Test-Path $statusPath) {
      [System.IO.File]::ReadAllText($statusPath, [System.Text.Encoding]::UTF8)
    } else {
      '{"state":"idle","progress":"","message":"就緒"}'
    }
    Send-Json $ctx.Response $body
    continue
  }

  if ($reqPath -eq "/api/sync" -and ($method -eq "POST" -or $method -eq "GET")) {
    $null = Start-DataSyncProcess
    $body = if (Test-Path $statusPath) {
      [System.IO.File]::ReadAllText($statusPath, [System.Text.Encoding]::UTF8)
    } else {
      '{"state":"running","progress":"0/5","message":"同步已啟動"}'
    }
    Send-Json $ctx.Response $body
    continue
  }

  $cleanRel = $reqPath.TrimStart('/')
  if (-not $cleanRel) { $cleanRel = "index.html" }
  $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $cleanRel))
  if (-not $fullPath.StartsWith($root) -or -not (Test-Path $fullPath -PathType Leaf)) {
    $ctx.Response.StatusCode = 404
    $ctx.Response.Close()
    continue
  }
  $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
  $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
  $ctx.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
  $bytes = [System.IO.File]::ReadAllBytes($fullPath)
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}
