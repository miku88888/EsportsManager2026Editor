$ErrorActionPreference = 'Stop'
$editorRoot = $PSScriptRoot
$nodePath = Join-Path $editorRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) { $nodePath = (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath (Join-Path $editorRoot 'settings.json'))) {
    & (Join-Path $editorRoot 'Setup.ps1')
    if (-not (Test-Path -LiteralPath (Join-Path $editorRoot 'settings.json'))) { return }
}
$runningFile = Join-Path $editorRoot 'running.json'
$editorUrl = $null
if (Test-Path -LiteralPath $runningFile) {
    try {
        $info = Get-Content -LiteralPath $runningFile -Raw | ConvertFrom-Json
        $reply = Invoke-RestMethod -Uri ($info.url + '/api/bootstrap') -TimeoutSec 3
        if ($reply.version -eq '1.3.1') { $editorUrl = $info.url }
    } catch {}
}
if (-not $editorUrl) {
    Start-Process -FilePath $nodePath -ArgumentList @('server.mjs') -WorkingDirectory $editorRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $editorRoot 'server.log') -RedirectStandardError (Join-Path $editorRoot 'server-error.log')
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $info = Get-Content -LiteralPath $runningFile -Raw | ConvertFrom-Json
            $reply = Invoke-RestMethod -Uri ($info.url + '/api/bootstrap') -TimeoutSec 2
            if ($reply.version -eq '1.3.1') { $editorUrl = $info.url; break }
        } catch {}
    }
}
if ($editorUrl) { Start-Process $editorUrl } else {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show('编辑器启动失败，请查看程序目录的 server-error.log。', '电竞经理 2026 数据库编辑器') | Out-Null
}
