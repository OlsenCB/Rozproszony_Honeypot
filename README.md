# Rozproszony Honeypot — PoC

Wiele węzłów-pułapek łapie ataki i wysyła logi JSON do centralnego kolektora,
który agreguje je i pokazuje na dashboardzie w czasie rzeczywistym.
Czysty Node.js, bez zależności.

## Uruchomienie

Wymaga Node.js 18+. W folderze projektu:

```
# Linux / macOS
bash run-demo.sh

# Windows
powershell -ExecutionPolicy Bypass -File .\run-demo.ps1
```

Dashboard: http://localhost:9000

Test odporności (uruchamiać osobno, gdy nic innego nie działa):
`test-resilience.sh` / `test-resilience.ps1`

## Pliki

- `collector.js` — centralny kolektor (ingest logów, API, dashboard)
- `honeypot-node.js` — węzeł-pułapka (emulacja usług, bufor + retry)
- `attacker.js` — symulator ruchu (tylko do demo)
