
$dir = $PSScriptRoot
Set-Location $dir

function Send-Attack($path, $method, $ip) {
    $p = @{ Uri = "http://localhost:8081$path"; Method = $method;
            Headers = @{ 'X-Forwarded-For' = $ip }; UseBasicParsing = $true; TimeoutSec = 3 }
    if ($method -eq 'POST') { $p.Body = 'u=admin&p=admin123' }
    try { Invoke-WebRequest @p | Out-Null } catch {}
}

$busy = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -in 9000, 8081, 8069 }
if ($busy) {
    Write-Host "!! Porty 9000/8081/8082 sa zajete." -ForegroundColor Red
    Write-Host "   Zamknij najpierw run-demo (okna COLLECTOR / NODE / ATTACKER, Ctrl+C),"
    Write-Host "   poczekaj chwile i uruchom test ponownie - on stawia wlasny kolektor i wezel."
    exit 1
}

Write-Host ">>> Start kolektora i wezla (otworza sie 2 osobne okna)..."
$col = Start-Process node -ArgumentList 'collector.js' -PassThru
Start-Sleep -Seconds 1
$env:NODE_ID = 'warsaw-edge'; $env:PORT = '8081'; $env:COLLECTOR_URL = 'http://localhost:9000/logs'
$node = Start-Process node -ArgumentList 'honeypot-node.js' -PassThru
Start-Sleep -Seconds 2

Write-Host ">>> 1) Kolektor DZIALA -> wysylam 2 ataki"
Send-Attack '/admin' 'GET' '66.66.66.1'
Send-Attack '/admin' 'GET' '66.66.66.2'
Start-Sleep -Seconds 1

Write-Host ">>> 2) UBIJAM kolektor (symulacja awarii / partycji sieci)"
Stop-Process -Id $col.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Host ">>> 3) W trakcie awarii: 3 ataki."
Write-Host "    >> SPOJRZ TERAZ NA OKNO WEZLA: buforuje i ponawia (ECONNREFUSED). <<"
Send-Attack '/login' 'POST' '77.77.77.1'
Send-Attack '/login' 'POST' '77.77.77.2'
Send-Attack '/login' 'POST' '77.77.77.3'
Start-Sleep -Seconds 4

Write-Host ">>> 4) RESTART kolektora -> bufor sie dostarcza (Eventual Consistency)"
$col2 = Start-Process node -ArgumentList 'collector.js' -PassThru
Start-Sleep -Seconds 4
try {
    $stats = Invoke-RestMethod -Uri 'http://localhost:9000/stats' -TimeoutSec 3
    Write-Host ("    Zdarzen w nowym kolektorze: {0} (oczekiwane 3 - logi z czasu awarii odzyskane z bufora)" -f $stats.totalEvents)
    $ips = ($stats.recent | ForEach-Object { $_.sourceIp } | Select-Object -Unique) -join ', '
    Write-Host ("    IP, ktore przetrwaly awarie: {0}" -f $ips)
} catch {
    Write-Host "    Nie udalo sie odczytac /stats"
}

Write-Host ">>> Sprzatanie (zamykam okna wezla i kolektora)..."
Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $col2.Id -Force -ErrorAction SilentlyContinue
Write-Host "OK - test zakonczony."
