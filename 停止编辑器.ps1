$ErrorActionPreference = 'Stop'
$info = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'running.json') -Raw | ConvertFrom-Json
$reply = Invoke-RestMethod -Uri ($info.url + '/api/bootstrap') -TimeoutSec 3
Invoke-RestMethod -Uri ($info.url + '/api/shutdown') -Method Post -Headers @{ 'X-Editor-Token' = $reply.token } -ContentType 'application/json' -Body '{}' | Out-Null
