$root = "C:\Users\user\.gemini\antigravity\scratch\lol-hex-guide"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:8765/")
$listener.Start()
Write-Host "Serving $root at http://localhost:8765/"
$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".svg"  = "image/svg+xml"
}
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $reqPath = $ctx.Request.Url.LocalPath.TrimStart('/')
  if (-not $reqPath) { $reqPath = "index.html" }
  $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $reqPath))
  if (-not $fullPath.StartsWith($root) -or -not (Test-Path $fullPath -PathType Leaf)) {
    $ctx.Response.StatusCode = 404
    $ctx.Response.Close()
    continue
  }
  $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
  $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
  $bytes = [System.IO.File]::ReadAllBytes($fullPath)
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}
