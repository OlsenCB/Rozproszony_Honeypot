
$dir = $PSScriptRoot

Write-Host ">>> Start kolektora (port 9000)..."
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$dir'; `$Host.UI.RawUI.WindowTitle='COLLECTOR'; node collector.js"
Start-Sleep -Seconds 1

Write-Host ">>> Start wezla warsaw-edge (port 8081)..."
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$dir'; `$Host.UI.RawUI.WindowTitle='NODE warsaw-edge'; `$env:NODE_ID='warsaw-edge'; `$env:PORT='8081'; `$env:COLLECTOR_URL='http://localhost:9000/logs'; node honeypot-node.js"

Write-Host ">>> Start wezla berlin-edge (port 8082)..."
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$dir'; `$Host.UI.RawUI.WindowTitle='NODE berlin-edge'; `$env:NODE_ID='berlin-edge'; `$env:PORT='8069'; `$env:COLLECTOR_URL='http://localhost:9000/logs'; node honeypot-node.js"
Start-Sleep -Seconds 1

Write-Host ">>> Start symulatora atakujacego..."
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$dir'; `$Host.UI.RawUI.WindowTitle='ATTACKER'; node attacker.js http://localhost:8081 http://localhost:8069"

Start-Sleep -Seconds 1
Write-Host ""
Write-Host "============================================================"
Write-Host "  System dziala. Otwieram dashboard: http://localhost:9000"
Write-Host "  Kazdy komponent ma wlasne okno - zamknij je, by zatrzymac."
Write-Host "============================================================"
Start-Process "http://localhost:9000"
