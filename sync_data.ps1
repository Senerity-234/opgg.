param(
  [int]$BatchSize = 10,
  [switch]$Quiet,
  [switch]$RebuildOnly
)

$ErrorActionPreference = "Stop"
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cacheDir = Join-Path $appDir ".cache"
$opggDir = Join-Path $cacheDir "opgg_cache"
$aramggDir = Join-Path $cacheDir "aramgg_cache"
$statusPath = Join-Path $cacheDir "sync_status.json"

function To-JsonList($seq) {
  $list = New-Object "System.Collections.Generic.List[object]"
  if ($null -ne $seq) {
    foreach ($x in @($seq)) { $list.Add($x) }
  }
  return ,$list
}

New-Item -ItemType Directory -Force -Path $cacheDir, $opggDir, $aramggDir | Out-Null

function Write-SyncStatus([string]$state, [string]$progress, [string]$message, [hashtable]$extra = @{}) {
  $obj = @{
    state = $state
    progress = $progress
    message = $message
    pid = $PID
    updatedAt = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
  }
  foreach ($k in $extra.Keys) { $obj[$k] = $extra[$k] }
  $json = $obj | ConvertTo-Json -Depth 4 -Compress
  [System.IO.File]::WriteAllText($statusPath, $json, [System.Text.Encoding]::UTF8)
  if (-not $Quiet) { Write-Host "[$state] $progress - $message" }
}

$startedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

try {
  Write-SyncStatus "running" "1/5" "正在連線 Riot DataDragon 檢查最新版本..." @{ startedAt = $startedAt }

  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;

public static class FastJsonExtract {
    public static string ExtractBalancedObject(string text, int openBraceIdx) {
        if (openBraceIdx < 0 || openBraceIdx >= text.Length || text[openBraceIdx] != '{') return null;
        int depth = 0;
        bool inStr = false;
        bool esc = false;
        for (int i = openBraceIdx; i < text.Length; i++) {
            char c = text[i];
            if (esc) { esc = false; continue; }
            if (c == '\\') { esc = true; continue; }
            if (c == '"') { inStr = !inStr; continue; }
            if (!inStr) {
                if (c == '{') depth++;
                else if (c == '}') {
                    depth--;
                    if (depth == 0) return text.Substring(openBraceIdx, i - openBraceIdx + 1);
                }
            }
        }
        return null;
    }

    public static string ExtractBalancedArray(string text, int openBracketIdx) {
        if (openBracketIdx < 0 || openBracketIdx >= text.Length || text[openBracketIdx] != '[') return null;
        int depth = 0;
        bool inStr = false;
        bool esc = false;
        for (int i = openBracketIdx; i < text.Length; i++) {
            char c = text[i];
            if (esc) { esc = false; continue; }
            if (c == '\\') { esc = true; continue; }
            if (c == '"') { inStr = !inStr; continue; }
            if (!inStr) {
                if (c == '[') depth++;
                else if (c == ']') {
                    depth--;
                    if (depth == 0) return text.Substring(openBracketIdx, i - openBracketIdx + 1);
                }
            }
        }
        return null;
    }

    public static List<string> ExtractAllDataArrays(string text) {
        var list = new List<string>();
        int pos = 0;
        while (true) {
            int idx = text.IndexOf("{\"data\":[", pos, StringComparison.Ordinal);
            if (idx < 0) break;
            string obj = ExtractBalancedObject(text, idx);
            if (obj != null) {
                list.Add(obj);
                pos = idx + obj.Length;
            } else {
                pos = idx + 9;
            }
        }
        return list;
    }
}
"@ -ErrorAction SilentlyContinue

  Add-Type -AssemblyName System.Net.Http
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(25)
  $client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
  $client.DefaultRequestHeaders.Add("Accept-Language", "zh-TW,zh;q=0.9,en;q=0.8")

  # Dedicated RSC client for OP.GG sub-routes
  $rscHandler = New-Object System.Net.Http.HttpClientHandler
  $rscHandler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
  $rscClient = New-Object System.Net.Http.HttpClient($rscHandler)
  $rscClient.Timeout = [TimeSpan]::FromSeconds(25)
  $rscClient.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
  $rscClient.DefaultRequestHeaders.Add("RSC", "1")
  $rscClient.DefaultRequestHeaders.Add("Accept-Language", "zh-TW,zh;q=0.9,en;q=0.8")

  function Download-WithFallback([System.Net.Http.HttpClient]$http, [string]$url, [string]$destPath) {
    try {
      $bytes = $http.GetByteArrayAsync($url).GetAwaiter().GetResult()
      if ($bytes -and $bytes.Length -gt 200) {
        [System.IO.File]::WriteAllBytes($destPath, $bytes)
        return $true
      }
    } catch {}
    return (Test-Path $destPath)
  }

  $ddVerPath = Join-Path $cacheDir "dd_versions.json"
  $ddItemsPath = Join-Path $cacheDir "dd_items_tw.json"
  $ddChampsPath = Join-Path $cacheDir "dd_champs_tw.json"
  $mkPath = Join-Path $cacheDir "meraki_all_champs.json"
  $opMainPath = Join-Path $cacheDir "opgg_main.html"
  $champsListPath = Join-Path $cacheDir "champions_list.json"
  $globalAugsPath = Join-Path $cacheDir "global_augments.json"
  $updated = 0

  if (-not $RebuildOnly) {
    # 1. Riot DataDragon
    if (-not (Download-WithFallback $client "https://ddragon.leagueoflegends.com/api/versions.json" $ddVerPath)) {
      throw "無法取得 Riot DataDragon 版本清單，且無本機快取。"
    }
    $versions = Get-Content $ddVerPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $ddVer = [string]$versions[0]
    $patchParts = $ddVer.Split('.')
    $patch = if ($patchParts.Count -ge 2) { "$($patchParts[0]).$($patchParts[1])" } else { $ddVer }

    $null = Download-WithFallback $client "https://ddragon.leagueoflegends.com/cdn/$ddVer/data/zh_TW/item.json" $ddItemsPath
    $null = Download-WithFallback $client "https://ddragon.leagueoflegends.com/cdn/$ddVer/data/zh_TW/championFull.json" $ddChampsPath

    # 2. Meraki Analytics
    Write-SyncStatus "running" "2/5" "正在同步 Meraki 全英雄基礎屬性與技能公式..." @{ startedAt = $startedAt; patch = $patch; ddVer = $ddVer }
    $null = Download-WithFallback $client "https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json" $mkPath

    # 3. OP.GG Main ARAM: Mayhem HTML (extracts latest 173+ champion list + global 311+ augments)
    Write-SyncStatus "running" "3/5" "正在抓取 OP.GG ARAM: Mayhem 最新梯隊與全海克斯..." @{ startedAt = $startedAt; patch = $patch; ddVer = $ddVer }
    $null = Download-WithFallback $client "https://op.gg/zh-tw/lol/modes/aram-mayhem" $opMainPath
    $amHtml = [System.IO.File]::ReadAllText($opMainPath, [System.Text.Encoding]::UTF8)

    $champsList = $null
    $globalAugsRaw = $null
    $scripts = [regex]::Matches($amHtml, 'self\.__next_f\.push\(\[1,"(.*?)"\]\)')
    foreach ($m in $scripts) {
      $raw = $m.Groups[1].Value
      if ($raw.Length -lt 5000) { continue }
      $u = [System.Text.RegularExpressions.Regex]::Unescape($raw)
      if (-not $champsList -and $u.Contains('"champions":[{')) {
        $cIdx = $u.IndexOf('"champions":[{')
        $arrIdx = $u.IndexOf('[', $cIdx)
        $cArrStr = [FastJsonExtract]::ExtractBalancedArray($u, $arrIdx)
        if ($cArrStr) { $champsList = $cArrStr | ConvertFrom-Json }
      }
      if (-not $globalAugsRaw -and $raw.Length -gt 150000 -and $u.Contains('{"data":[{')) {
        $gIdx = $u.IndexOf('{"data":[{')
        $gStr = [FastJsonExtract]::ExtractBalancedObject($u, $gIdx)
        if ($gStr) {
          $gObj = $gStr | ConvertFrom-Json
          if ($gObj.data -and $gObj.data.Count -gt 50) { $globalAugsRaw = $gObj.data }
        }
      }
    }

    if ($champsList) {
      $champsList | ConvertTo-Json -Depth 4 -Compress | Out-File $champsListPath -Encoding UTF8
    } elseif (Test-Path $champsListPath) {
      $champsList = Get-Content $champsListPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } else {
      throw "無法從 OP.GG 取得英雄清單。"
    }

    if ($globalAugsRaw) {
      $globalAugsRaw | Select-Object id, name, key, rarity, tier, performance, popular, desc, largeIcon, champions |
        ConvertTo-Json -Depth 4 -Compress | Out-File $globalAugsPath -Encoding UTF8
    } elseif (Test-Path $globalAugsPath) {
      $globalAugsRaw = Get-Content $globalAugsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } else {
      throw "無法從 OP.GG 取得海克斯清單。"
    }

    # 4. Fetch latest per-champion OP.GG & ARAMGG data in parallel batches
    $jobs = @()
    foreach ($c in $champsList) {
      $k = $c.key
      $cid = $c.id
      $jobs += @{ kind = "opgg"; url = "https://op.gg/zh-tw/lol/modes/aram-mayhem/$k/augments"; path = "$opggDir\${k}_aug.rsc" }
      $jobs += @{ kind = "opgg"; url = "https://op.gg/zh-tw/lol/modes/aram-mayhem/$k/items"; path = "$opggDir\${k}_items.rsc" }
      $jobs += @{ kind = "opgg"; url = "https://op.gg/zh-tw/lol/modes/aram-mayhem/$k/build"; path = "$opggDir\${k}_build.rsc" }
      $jobs += @{ kind = "aramgg"; url = "https://aramgg.com/zh-TW/champion-stats/$cid"; path = "$aramggDir\${cid}.html" }
    }

    $totalJobs = $jobs.Count
    $done = 0
    $retryList = @()
    for ($i = 0; $i -lt $totalJobs; $i += $BatchSize) {
      $end = [Math]::Min($i + $BatchSize - 1, $totalJobs - 1)
      $batch = $jobs[$i..$end]
      $tasks = @()
      foreach ($item in $batch) {
        $http = if ($item.kind -eq "opgg") { $rscClient } else { $client }
        $tasks += @{ item = $item; task = $http.GetByteArrayAsync($item.url) }
      }
      try {
        [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($tasks | ForEach-Object { $_.task }))
      } catch {}
      foreach ($t in $tasks) {
        $done++
        $saved = $false
        if ($t.task.Status -eq [System.Threading.Tasks.TaskStatus]::RanToCompletion) {
          $bytes = $t.task.Result
          $minLen = if ($t.item.kind -eq "aramgg") { 8000 } else { 4000 }
          if ($bytes -and $bytes.Length -gt $minLen) {
            [System.IO.File]::WriteAllBytes($t.item.path, $bytes)
            $updated++
            $saved = $true
          }
        }
        if (-not $saved) { $retryList += $t.item }
      }
      if ((($i / $BatchSize) % 6) -eq 0 -or $done -eq $totalJobs) {
        $pct = [Math]::Round(($done / $totalJobs) * 100)
        Write-SyncStatus "running" "4/5 ($pct%)" "正在同步各英雄最新 OP.GG / ARAMGG 數據 ($done / $totalJobs)..." @{ startedAt = $startedAt; patch = $patch; ddVer = $ddVer }
      }
      Start-Sleep -Milliseconds 100
    }

    # Retry any transiently failed or rate-limited requests sequentially
    if ($retryList.Count -gt 0) {
      Write-SyncStatus "running" "4/5 (重試)" "正在重試 $($retryList.Count) 筆暫時失敗請求..." @{ startedAt = $startedAt; patch = $patch; ddVer = $ddVer }
      foreach ($item in $retryList) {
        try {
          Start-Sleep -Milliseconds 250
          $http = if ($item.kind -eq "opgg") { $rscClient } else { $client }
          $bytes = $http.GetByteArrayAsync($item.url).GetAwaiter().GetResult()
          $minLen = if ($item.kind -eq "aramgg") { 8000 } else { 4000 }
          if ($bytes -and $bytes.Length -gt $minLen) {
            [System.IO.File]::WriteAllBytes($item.path, $bytes)
            $updated++
          }
        } catch {}
      }
    }
  } else {
    $versions = Get-Content $ddVerPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $ddVer = [string]$versions[0]
    $patchParts = $ddVer.Split('.')
    $patch = if ($patchParts.Count -ge 2) { "$($patchParts[0]).$($patchParts[1])" } else { $ddVer }
    $champsList = Get-Content $champsListPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $globalAugsRaw = Get-Content $globalAugsPath -Raw -Encoding UTF8 | ConvertFrom-Json
  }

  $client.Dispose()
  $rscClient.Dispose()

  # 5. Rebuild data.js
  Write-SyncStatus "running" "5/5" "正在編譯生成最新 data.js..." @{ startedAt = $startedAt; patch = $patch; ddVer = $ddVer }

  $ddItems = ([System.IO.File]::ReadAllText($ddItemsPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json).data
  $ddChampsRaw = ([System.IO.File]::ReadAllText($ddChampsPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json).data
  $ddChampsById = @{}
  foreach ($p in $ddChampsRaw.PSObject.Properties) {
    $v = $p.Value
    $ddChampsById[[string]$v.key] = $v
  }

  $mkAll = [System.IO.File]::ReadAllText($mkPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  $mkById = @{}
  foreach ($p in $mkAll.PSObject.Properties) {
    $mkById[[string]$p.Value.id] = $p.Value
  }

  $globalAugsMap = @{}
  foreach ($g in $globalAugsRaw) {
    $globalAugsMap[[string]$g.id] = $g
  }

  $augCatalog = @{}
  $itemCatalog = @{}
  $championsOut = @()

  function Clean-Desc([string]$s) {
    if (-not $s) { return "" }
    $r = $s -replace '<br\s*/?>', "`n"
    $r = $r -replace '<[^>]+>', ''
    $r = $r -replace '\s+', ' '
    return $r.Trim()
  }

  function Parse-ItemStats([string]$rawDesc) {
    $res = @{}
    if (-not $rawDesc) { return $res }
    $m = [regex]::Match($rawDesc, '<stats>(.*?)</stats>', 'Singleline')
    if (-not $m.Success) { return $res }
    $lines = ($m.Groups[1].Value -replace '<br\s*/?>', "`n" -replace '<[^>]+>', '').Trim() -split "`n"
    foreach ($l in $lines) {
      $t = $l.Trim()
      if ($t -match '^([\d.]+)(%?)\s*(.+)$') {
        $val = [double]$matches[1]
        $pct = $matches[2]
        $lbl = $matches[3].Trim()
        switch ($lbl) {
          "物理攻擊" { $res["ad"] = $val }
          "魔法攻擊" { $res["ap"] = $val }
          "生命"     { $res["hp"] = $val }
          "魔力"     { $res["mp"] = $val }
          "物理防禦" { $res["ar"] = $val }
          "魔法防禦" { $res["mr"] = $val }
          "技能加速" { $res["ah"] = $val }
          "物理致命" { $res["leth"] = $val }
          "攻擊速度" { if ($pct -eq "%") { $res["as"] = $val } }
          "暴擊率"   { if ($pct -eq "%") { $res["crit"] = $val } }
          "暴擊傷害" { if ($pct -eq "%") { $res["critDmg"] = $val } }
          "物理穿透" { if ($pct -eq "%") { $res["arPen"] = $val } }
          "魔法穿透" { if ($pct -eq "%") { $res["mrPenPct"] = $val } else { $res["mrPen"] = $val } }
          "跑速"     { if ($pct -eq "%") { $res["msPct"] = $val } else { $res["ms"] = $val } }
          "治療及護盾強度" { if ($pct -eq "%") { $res["hsp"] = $val } }
          "普攻吸血" { if ($pct -eq "%") { $res["ls"] = $val } }
          "全能吸血" { if ($pct -eq "%") { $res["ov"] = $val } }
        }
      }
    }
    return $res
  }

  function Add-ItemToCatalog([int]$id, $metaObj) {
    $sid = [string]$id
    if (-not $itemCatalog.ContainsKey($sid)) {
      $dd = $ddItems.$sid
      if (-not $dd -and $id -eq 4011) { $dd = $ddItems."124011" }
      $name = if ($metaObj -and $metaObj.name) { $metaObj.name } elseif ($dd) { $dd.name } else { "Item $id" }
      $img = if ($metaObj -and $metaObj.image_url) { $metaObj.image_url } else { "https://opgg-static.akamaized.net/meta/images/lol/$ddVer/item/$id.png" }
      $tags = To-JsonList $(if ($dd -and $dd.tags) { $dd.tags })
      $gold = if ($dd -and $dd.gold) { [int]$dd.gold.total } else { 0 }
      $plain = if ($dd -and $dd.plaintext) { $dd.plaintext } else { "" }
      $desc = if ($dd -and $dd.description) { Clean-Desc $dd.description } else { "" }
      $stats = if ($dd -and $dd.description) { Parse-ItemStats $dd.description } else { @{} }
      $itemCatalog[$sid] = @{
        id = $id; name = $name; img = $img; tags = $tags
        gold = $gold; plain = $plain; desc = $desc; stats = $stats
      }
    }
  }

  function Map-UnitKey([string]$u) {
    $t = ($u + "").Trim().ToLower()
    if ($t -eq "") { return "flat" }
    if ($t -eq "% ap") { return "ap" }
    if ($t -eq "% bonus ad") { return "bad" }
    if ($t -eq "% ad") { return "ad" }
    if ($t -match "target.*max.*health") { return "tMaxHp" }
    if ($t -match "target.*current.*health") { return "tCurHp" }
    if ($t -match "target.*missing.*health") { return "tMissHp" }
    if ($t -match "bonus health") { return "bhp" }
    if ($t -match "max.*health") { return "hp" }
    if ($t -match "max.*mana") { return "mp" }
    if ($t -match "bonus armor") { return "bar" }
    if ($t -match "armor") { return "ar" }
    if ($t -match "bonus magic resistance") { return "bmr" }
    if ($t -match "magic resistance") { return "mr" }
    return $null
  }

  function Parse-MerakiFormulas($mkChamp) {
    $out = @{}
    if (-not $mkChamp -or -not $mkChamp.abilities) { return $out }
    foreach ($sk in @("Q","W","E","R")) {
      $abArr = $mkChamp.abilities.$sk
      if (-not $abArr -or $abArr.Count -eq 0) { continue }
      $ab = $abArr[0]
      $dmgType = if ($ab.damageType) { $ab.damageType } else { "" }
      $entries = @()
      foreach ($ef in $ab.effects) {
        $critBonus = 0.0
        if ($ef.description -match 'increased by 0%\s*:\s*(\d+)%\s*\(based on critical strike chance\)') {
          $critBonus = [double]$matches[1] / 100.0
        }
        foreach ($lv in $ef.leveling) {
          $attr = $lv.attribute
          if ($attr -match 'Damage|damage' -and $attr -notmatch 'Minion|Monster|Non-Champion|Reduced|Minimum|Structure|Turret|Healing|Shield') {
            $terms = @()
            foreach ($mod in $lv.modifiers) {
              $uk = Map-UnitKey $mod.units[0]
              if ($uk) {
                $vals = @()
                if ($mod.values -is [string]) {
                  $vals = @($mod.values -split '\s+' | Where-Object { $_ -ne '' } | ForEach-Object { [double]$_ })
                } else {
                  $vals = @($mod.values | ForEach-Object { [double]$_ })
                }
                if ($vals.Count -gt 0) { $terms += @{ u = $uk; v = $vals } }
              }
            }
            if ($terms.Count -gt 0) {
              $subType = $dmgType
              if ($attr -match 'Magic') { $subType = "MAGIC_DAMAGE" }
              elseif ($attr -match 'Physical') { $subType = "PHYSICAL_DAMAGE" }
              elseif ($attr -match 'True') { $subType = "TRUE_DAMAGE" }
              $entries += @{ label = $attr; dt = $subType; critScale = $critBonus; terms = $terms }
            }
          }
        }
      }
      if ($entries.Count -gt 0) { $out[$sk] = $entries }
    }
    return $out
  }

  foreach ($c in $champsList) {
    $k = $c.key
    $cid = [int]$c.id
    $scid = [string]$cid

    $augFile = "$opggDir\${k}_aug.rsc"
    $itmFile = "$opggDir\${k}_items.rsc"
    $bldFile = "$opggDir\${k}_build.rsc"
    $agFile = "$aramggDir\${cid}.html"
    if (-not (Test-Path $augFile) -or -not (Test-Path $itmFile) -or -not (Test-Path $bldFile)) { continue }

    # 1. OP.GG Augments
    $augTxt = [System.IO.File]::ReadAllText($augFile, [System.Text.Encoding]::UTF8)
    $augStart = $augTxt.IndexOf('{"data":[{"id":')
    $champAugs = @()
    if ($augStart -ge 0) {
      $augJsonStr = [FastJsonExtract]::ExtractBalancedObject($augTxt, $augStart)
      $augObj = $augJsonStr | ConvertFrom-Json
      foreach ($a in $augObj.data) {
        if (-not $a.name) { continue }
        $aid = [string]$a.id
        if (-not $augCatalog.ContainsKey($aid)) {
          $g = $globalAugsMap[$aid]
          $augCatalog[$aid] = @{
            id = [int]$a.id; name = $a.name; key = $a.key; rarity = [int]$a.rarity
            img = $a.largeIcon; desc = Clean-Desc $a.desc
            gTier = if ($g) { [int]$g.tier } else { 5 }
            gPerf = if ($g) { [Math]::Round([double]$g.performance, 2) } else { 0 }
            gPop = if ($g) { [Math]::Round([double]$g.popular, 2) } else { 0 }
            gTopChamps = if ($g -and $g.champions) { @($g.champions | ForEach-Object { @{ id = [int]$_.id; tier = [int]$_.tier; perf = [Math]::Round([double]$_.performance, 1); pop = [Math]::Round([double]$_.popular, 2) } }) } else { @() }
          }
        }
        $champAugs += ,@([int]$a.id, [int]$a.tier, [Math]::Round([double]$a.performance, 2), [Math]::Round([double]$a.popular, 2))
      }
    }

    # 2. OP.GG Items
    $itmTxt = [System.IO.File]::ReadAllText($itmFile, [System.Text.Encoding]::UTF8)
    $arrays = [FastJsonExtract]::ExtractAllDataArrays($itmTxt)
    $coreBuilds = @(); $bootsList = @(); $starters = @(); $allItems = @()
    if ($arrays.Count -ge 4) {
      $coreObj = ($arrays[0] | ConvertFrom-Json).data
      foreach ($row in ($coreObj | Select-Object -First 8)) {
        $i = 0
        foreach ($iid in $row.ids) {
          $m = if ($row.metaBuildItems -and $i -lt $row.metaBuildItems.Count) { $row.metaBuildItems[$i] } else { $null }
          Add-ItemToCatalog ([int]$iid) $m
          $i++
        }
        $coreBuilds += @{ ids = @($row.ids | ForEach-Object { [int]$_ }); wr = [Math]::Round([double]$row.win_rate, 2); pr = [Math]::Round([double]$row.pick_rate, 2); play = $row.play }
      }
      $bootsObj = ($arrays[1] | ConvertFrom-Json).data
      foreach ($row in ($bootsObj | Select-Object -First 6)) {
        $iid = [int]$row.ids[0]
        Add-ItemToCatalog $iid $row.metaItem
        $bootsList += @{ id = $iid; wr = [Math]::Round([double]$row.win_rate, 2); pr = [Math]::Round([double]$row.pick_rate, 2); play = $row.play }
      }
      $startObj = ($arrays[2] | ConvertFrom-Json).data
      foreach ($row in ($startObj | Select-Object -First 5)) {
        $sIds = @()
        foreach ($pair in $row.metaStarterItems) {
          $m = $pair[0]; $cnt = [int]$pair[1]
          Add-ItemToCatalog ([int]$m.id) $m
          for ($q=0; $q -lt $cnt; $q++) { $sIds += [int]$m.id }
        }
        if ($sIds.Count -eq 0) { $sIds = @($row.ids | ForEach-Object { [int]$_ }) }
        $starters += @{ ids = $sIds; wr = [Math]::Round([double]$row.win_rate, 2); pr = [Math]::Round([double]$row.pick_rate, 2); play = $row.play }
      }
      $allObj = ($arrays[3] | ConvertFrom-Json).data
      foreach ($row in $allObj) {
        $iid = [int]$row.ids[0]
        Add-ItemToCatalog $iid $row.metaItem
        $allItems += @{ id = $iid; wr = [Math]::Round([double]$row.win_rate, 2); pr = [Math]::Round([double]$row.pick_rate, 2); play = $row.play }
      }
    }

    # 3. OP.GG Build
    $bldTxt = [System.IO.File]::ReadAllText($bldFile, [System.Text.Encoding]::UTF8)
    $idxP = $bldTxt.IndexOf('"passive":{')
    $skills = @{ p = @{ name = ""; desc = ""; img = "" }; q = @() }
    if ($idxP -gt 0) {
      $skillJsonStr = [FastJsonExtract]::ExtractBalancedObject($bldTxt, $idxP - 1)
      $skillObj = $skillJsonStr | ConvertFrom-Json
      $skills = @{
        p = @{ name = $skillObj.passive.name; desc = (Clean-Desc $skillObj.passive.description); img = $skillObj.passive.image_url }
        q = @()
      }
      foreach ($sp in $skillObj.data) {
        $skills.q += @{
          key = $sp.key; name = $sp.name; desc = Clean-Desc $sp.description; img = $sp.image_url
          cd = if ($sp.cooldown_burn_float) { ($sp.cooldown_burn_float -join "/") } else { "" }
        }
      }
    }
    $mSk = [regex]::Matches($bldTxt, '"metaType":"skill".*?"children":"([QWER])"')
    $skillOrder = ($mSk | Select-Object -First 3 | ForEach-Object { $_.Groups[1].Value }) -join " > "

    $st0 = $bldTxt.IndexOf('"spell_table_0"')
    $st1 = $bldTxt.IndexOf('"spell_table_1"')
    $sumSpells = @()
    if ($st0 -ge 0 -and $st1 -gt $st0) {
      $spellChunk = $bldTxt.Substring($st0, $st1 - $st0)
      $mSp = [regex]::Matches($spellChunk, '"metaId":(\d+),"metaType":"spell".*?"src":"([^"]+)".*?"alt":"([^"]+)"')
      foreach ($x in $mSp) {
        $sumSpells += @{ id = [int]$x.Groups[1].Value; img = $x.Groups[2].Value; name = $x.Groups[3].Value }
      }
    }

    # 4. ARAMGG stats
    $overallWR = 50.0; $overallPR = 0.0; $augWrMap = @{}; $combos = @(); $archetypes = @()
    if (Test-Path $agFile) {
      $agHtml = [System.IO.File]::ReadAllText($agFile, [System.Text.Encoding]::UTF8)
      $mMeta = [regex]::Match($agHtml, '勝率\s*([\d.]+)%[、，\s]*選取率\s*([\d.]+)%')
      if ($mMeta.Success) { $overallWR = [double]$mMeta.Groups[1].Value; $overallPR = [double]$mMeta.Groups[2].Value }

      $idxA = $agHtml.IndexOf("增幅裝置推薦")
      $idxA2 = if ($idxA -ge 0) { $agHtml.IndexOf("推薦增幅裝置組合", $idxA) } else { -1 }
      if ($idxA -ge 0 -and $idxA2 -gt $idxA) {
        $aChunk = $agHtml.Substring($idxA, $idxA2 - $idxA)
        foreach ($tr in (($aChunk -split '<tr\b') | Select-Object -Skip 1)) {
          $mAug = [regex]::Match($tr, '/augments/(\d+)')
          $mPct = [regex]::Matches($tr, '([\d.]+)%')
          if ($mAug.Success -and $mPct.Count -ge 2) {
            $augWrMap[$mAug.Groups[1].Value] = @([double]$mPct[0].Groups[1].Value, [double]$mPct[1].Groups[1].Value)
          }
        }
      }

      $idxC = $agHtml.IndexOf("推薦增幅裝置組合")
      $idxC2 = if ($idxC -ge 0) { $agHtml.IndexOf("召喚師技能", $idxC) } else { -1 }
      if ($idxC -ge 0 -and $idxC2 -gt $idxC) {
        $cChunk = $agHtml.Substring($idxC, $idxC2 - $idxC)
        foreach ($tr in ($cChunk -split '<tr\b')) {
          $aids = [regex]::Matches($tr, '/augments/(\d+)') | ForEach-Object { [int]$_.Groups[1].Value }
          if ($aids.Count -ge 2) {
            $ms = [regex]::Match($tr, '([\d.]+)%</td>\s*<td[^>]*>\s*([\d,]+)')
            $combos += @{
              augs = @($aids)
              wr = if ($ms.Success) { [double]$ms.Groups[1].Value } else { 0 }
              games = if ($ms.Success) { $ms.Groups[2].Value } else { "0" }
            }
          }
        }
      }

      $idxB = $agHtml.IndexOf("裝備配置")
      $idxB2 = if ($idxB -ge 0) { $agHtml.IndexOf("常見問題", $idxB) } else { -1 }
      if ($idxB -ge 0 -and $idxB2 -gt $idxB) {
        $bChunk = $agHtml.Substring($idxB, $idxB2 - $idxB)
        $tabs = [regex]::Matches($bChunk, 'id="build-tab-(\d+)"(.*?)</button>', 'Singleline')
        foreach ($t in $tabs) {
          $tIdx = $t.Groups[1].Value; $inner = $t.Groups[2].Value
          $tags = @([regex]::Matches($inner, '<span class="rounded[^"]*">([^<]+)</span>') | ForEach-Object { $_.Groups[1].Value })
          $mWr = [regex]::Match($inner, '<span class="text-xs text-muted-foreground">([\d.]+)%</span>')
          $tWr = if ($mWr.Success) { [double]$mWr.Groups[1].Value } else { 0 }

          $pStart = $bChunk.IndexOf("id=`"build-panel-$tIdx`"")
          $nextIdx = [int]$tIdx + 1
          $pEnd = $bChunk.IndexOf("id=`"build-panel-$nextIdx`"")
          if ($pEnd -lt 0) { $pEnd = $bChunk.Length }
          $pChunk = if ($pStart -ge 0) { $bChunk.Substring($pStart, $pEnd - $pStart) } else { "" }

          $archCores = @()
          $sitIdx = $pChunk.IndexOf("情境裝備")
          $corePart = if ($sitIdx -gt 0) { $pChunk.Substring(0, $sitIdx) } else { $pChunk }
          $sitPart = if ($sitIdx -gt 0) { $pChunk.Substring($sitIdx) } else { "" }
          foreach ($cr in (($corePart -split '>\s*#[123]\s*<') | Select-Object -Skip 1)) {
            $ids = @([regex]::Matches($cr, '/item-icons/(\d+)\.png') | ForEach-Object { [int]$_.Groups[1].Value })
            foreach ($iid in $ids) { Add-ItemToCatalog $iid $null }
            $mStats = [regex]::Matches($cr, '([\d.]+)%')
            if ($ids.Count -ge 2) {
              $archCores += @{
                ids = $ids
                wr = if ($mStats.Count -ge 1) { [double]$mStats[0].Groups[1].Value } else { 0 }
                pr = if ($mStats.Count -ge 2) { [double]$mStats[1].Groups[1].Value } else { 0 }
              }
            }
          }
          $sitIds = @([regex]::Matches($sitPart, '/item-icons/(\d+)\.png') | ForEach-Object { [int]$_.Groups[1].Value } | Select-Object -Unique)
          foreach ($iid in $sitIds) { Add-ItemToCatalog $iid $null }
          if ($tags.Count -gt 0) { $archetypes += @{ tags = $tags; wr = $tWr; cores = $archCores; sit = $sitIds } }
        }
      }
    }

    # 5. Base Stats & Formulas
    $ddC = $ddChampsById[$scid]
    $mkC = $mkById[$scid]
    $baseStats = if ($mkC -and $mkC.stats) {
      $s = $mkC.stats
      @{
        hp = [double]$s.health.flat; hppl = [double]$s.health.perLevel
        mp = [double]$s.mana.flat; mppl = [double]$s.mana.perLevel
        ad = [double]$s.attackDamage.flat; adpl = [double]$s.attackDamage.perLevel
        as = [double]$s.attackSpeed.flat; asRatio = [double]$s.attackSpeedRatio.flat; aspl = [double]$s.attackSpeed.perLevel
        ar = [double]$s.armor.flat; arpl = [double]$s.armor.perLevel
        mr = [double]$s.magicResistance.flat; mrpl = [double]$s.magicResistance.perLevel
        ms = [double]$s.movespeed.flat; range = [double]$s.attackRange.flat
        critDmg = [double]$s.criticalStrikeDamage.flat / 100.0
        aramDealt = if ($s.aramDamageDealt) { [double]$s.aramDamageDealt.flat } else { 1.0 }
        aramTaken = if ($s.aramDamageTaken) { [double]$s.aramDamageTaken.flat } else { 1.0 }
      }
    } elseif ($ddC -and $ddC.stats) {
      $s = $ddC.stats
      @{
        hp = [double]$s.hp; hppl = [double]$s.hpperlevel
        mp = [double]$s.mp; mppl = [double]$s.mpperlevel
        ad = [double]$s.attackdamage; adpl = 3.5
        as = [double]$s.attackspeed; asRatio = [double]$s.attackspeed; aspl = [double]$s.attackspeedperlevel
        ar = [double]$s.armor; arpl = [double]$s.armorperlevel
        mr = [double]$s.spellblock; mrpl = [double]$s.spellblockperlevel
        ms = [double]$s.movespeed; range = [double]$s.attackrange
        critDmg = 1.75; aramDealt = 1.0; aramTaken = 1.0
      }
    } else { @{} }

    $formulas = Parse-MerakiFormulas $mkC
    $championsOut += @{
      id = $cid; key = $k; name = $c.name
      title = if ($ddC) { $ddC.title } else { "" }
      roles = To-JsonList $(if ($ddC -and $ddC.tags) { $ddC.tags })
      partype = if ($ddC) { $ddC.partype } else { "" }
      img = $c.image_url; tier = [int]$c.tier; rank = [int]$c.rank
      wr = $overallWR; pr = $overallPR
      skillOrder = $skillOrder; spells = $sumSpells; skills = $skills
      augs = $champAugs; augWr = $augWrMap
      core = $coreBuilds; boots = $bootsList; starter = $starters; items = $allItems
      combos = $combos; arch = $archetypes; baseStats = $baseStats; formulas = $formulas
    }
  }

  Add-ItemToCatalog 4011 @{ name = "破曉綻放之劍"; image_url = "https://ddragon.leagueoflegends.com/cdn/$ddVer/img/item/124011.png" }

  $generatedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $bundle = @{
    patch = $patch
    ddVer = $ddVer
    generatedAt = $generatedAt
    augments = $augCatalog
    items = $itemCatalog
    champions = $championsOut
  }

  if (-not ("SafeJson" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Collections;
using System.Globalization;
using System.Management.Automation;
using System.Text;

public static class SafeJson {
  private static void AppendString(StringBuilder sb, string s) {
    sb.Append('"');
    if (s != null) {
      for (int i = 0; i < s.Length; i++) {
        char c = s[i];
        switch (c) {
          case '"':  sb.Append("\\\""); break;
          case '\\': sb.Append("\\\\"); break;
          case '\b': sb.Append("\\b"); break;
          case '\f': sb.Append("\\f"); break;
          case '\n': sb.Append("\\n"); break;
          case '\r': sb.Append("\\r"); break;
          case '\t': sb.Append("\\t"); break;
          default:
            if (c < ' ') {
              sb.AppendFormat(CultureInfo.InvariantCulture, "\\u{0:x4}", (int)c);
            } else {
              sb.Append(c);
            }
            break;
        }
      }
    }
    sb.Append('"');
  }

  private static void AppendValue(StringBuilder sb, object obj) {
    if (obj == null) { sb.Append("null"); return; }
    PSObject pso = obj as PSObject;
    if (pso != null) {
      if (pso.BaseObject != null && !(pso.BaseObject is PSCustomObject)) {
        obj = pso.BaseObject;
      } else {
        sb.Append('{');
        bool first = true;
        foreach (PSPropertyInfo prop in pso.Properties) {
          if (!prop.IsGettable) continue;
          if (!first) sb.Append(',');
          first = false;
          AppendString(sb, prop.Name);
          sb.Append(':');
          AppendValue(sb, prop.Value);
        }
        sb.Append('}');
        return;
      }
    }
    if (obj is bool) { sb.Append(((bool)obj) ? "true" : "false"); return; }
    if (obj is string) { AppendString(sb, (string)obj); return; }
    if (obj is char) { AppendString(sb, obj.ToString()); return; }
    if (obj is double) {
      double d = (double)obj;
      if (double.IsNaN(d) || double.IsInfinity(d)) { sb.Append("null"); }
      else { sb.Append(d.ToString("R", CultureInfo.InvariantCulture)); }
      return;
    }
    if (obj is float) {
      float f = (float)obj;
      if (float.IsNaN(f) || float.IsInfinity(f)) { sb.Append("null"); }
      else { sb.Append(f.ToString("R", CultureInfo.InvariantCulture)); }
      return;
    }
    if (obj is decimal) { sb.Append(((decimal)obj).ToString(CultureInfo.InvariantCulture)); return; }
    if (obj is int || obj is long || obj is short || obj is byte || obj is sbyte || obj is uint || obj is ulong || obj is ushort) {
      sb.Append(Convert.ToString(obj, CultureInfo.InvariantCulture));
      return;
    }
    IDictionary idict = obj as IDictionary;
    if (idict != null) {
      sb.Append('{');
      bool first = true;
      foreach (DictionaryEntry de in idict) {
        if (!first) sb.Append(',');
        first = false;
        AppendString(sb, Convert.ToString(de.Key, CultureInfo.InvariantCulture));
        sb.Append(':');
        AppendValue(sb, de.Value);
      }
      sb.Append('}');
      return;
    }
    IEnumerable ienum = obj as IEnumerable;
    if (ienum != null) {
      sb.Append('[');
      bool first = true;
      foreach (object item in ienum) {
        if (!first) sb.Append(',');
        first = false;
        AppendValue(sb, item);
      }
      sb.Append(']');
      return;
    }
    AppendString(sb, Convert.ToString(obj, CultureInfo.InvariantCulture));
  }

  public static string Serialize(object obj) {
    var sb = new StringBuilder(1024 * 1024);
    AppendValue(sb, obj);
    return sb.ToString();
  }
}
"@
  }
  $json = [SafeJson]::Serialize($bundle)
  $jsContent = "window.HEX_DATA = $json;"
  $tmpDataPath = Join-Path $appDir "data.js.tmp"
  $finalDataPath = Join-Path $appDir "data.js"
  [System.IO.File]::WriteAllText($tmpDataPath, $jsContent, [System.Text.Encoding]::UTF8)
  Move-Item -Force $tmpDataPath $finalDataPath

  Write-SyncStatus "done" "5/5" "已同步最新資料" @{
    startedAt = $startedAt
    finishedAt = $generatedAt
    generatedAt = $generatedAt
    patch = $patch
    ddVer = $ddVer
    champions = $championsOut.Count
    augments = $augCatalog.Count
    items = $itemCatalog.Count
    updatedFiles = $updated
  }
} catch {
  Write-SyncStatus "error" "0/0" ("同步失敗：" + $_.Exception.Message) @{ startedAt = $startedAt }
  exit 1
}
