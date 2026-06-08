# PoC: Rozproszony System Honeypot ze Scentralizowaną Bazą Logów

Działający dowód koncepcji do projektu z **Systemów Rozproszonych**. Pokazuje, że
architektura z prezentacji ma sens: wiele rozproszonych **węzłów-pułapek** (sensorów)
przechwytuje ruch i przesyła ustrukturyzowane logi do **centralnego kolektora**,
który agreguje je w „globalną mapę zagrożeń" (Threat Intelligence).

Całość napisana w **czystym Node.js (tylko moduły wbudowane)** — zero `npm install`,
uruchamia się na dowolnym laptopie z zainstalowanym Node 18+.

---

## Komponenty

| Plik | Rola | Odpowiednik produkcyjny (slajdy) |
|------|------|----------------------------------|
| `collector.js` | Centralny kolektor: przyjmuje logi (`POST /logs`), agreguje, serwuje dashboard i API (`GET /stats`). | Log-Collector + Storage NoSQL + Dashboard |
| `honeypot-node.js` | Węzeł-pułapka: udaje podatny serwer HTTP, rejestruje ataki, przesyła je do kolektora z buforowaniem i retry. | Honeypot Node (Docker, edge) |
| `attacker.js` | Symulator atakującego — generuje zlośliwy ruch (tylko do demo). | — (narzędzie testowe) |
| `run-demo.sh` | Uruchamia cały system jednym poleceniem. | — |
| `test-resilience.sh` | Automatyczny test odporności (awaria + odzyskanie). | — |
| `docker-compose.yml` | Wersja konteneryzowana (izolacja, wiele węzłów). | Docker / izolacja |

---

## Szybki start (lokalnie, bez Dockera)

Wymagany **Node.js 18+**. W katalogu projektu:

```bash
# Wariant A: wszystko jednym poleceniem
bash run-demo.sh
```

Następnie otwórz w przeglądarce: **http://localhost:9000** — zobaczysz dashboard,
który na żywo pokazuje napływające ataki, aktywne węzły i statystyki.

```bash
# Wariant B: ręcznie, w osobnych terminalach (lepsze do tłumaczenia na obronie)
# Terminal 1 - kolektor:
node collector.js

# Terminal 2 - węzeł "warszawski":
NODE_ID=warsaw-edge PORT=8081 COLLECTOR_URL=http://localhost:9000/logs node honeypot-node.js

# Terminal 3 - węzeł "berliński":
NODE_ID=berlin-edge PORT=8082 COLLECTOR_URL=http://localhost:9000/logs node honeypot-node.js

# Terminal 4 - atakujący:
node attacker.js http://localhost:8081 http://localhost:8082
```

## Uruchomienie w Dockerze (historia „rozproszona + izolacja")

```bash
docker compose up --build
# Dashboard: http://localhost:9000
```

---

## Scenariusz demonstracji na obronę (ok. 4 min)

1. **Pokaż architekturę.** Uruchom `run-demo.sh`, otwórz dashboard. Zwróć uwagę:
   dwa niezależne węzły (`warsaw-edge`, `berlin-edge`) raportują do **jednego**
   kolektora → to jest sedno: centralizacja danych z rozproszonych źródeł.

2. **Pokaż przepływ danych.** Na dashboardzie rosną liczniki, w „Live feed" widać
   pojedyncze zdarzenia: IP, typ ataku (SQLi, path traversal, brute-force...), ścieżka.
   W terminalu kolektora widać linie `[COLLECTOR] <- warsaw-edge | sqli | 5.188.206.18`.

3. **Pokaż odporność na awarie (NAJWAŻNIEJSZE).** Uruchom w osobnym terminalu:
   ```bash
   bash test-resilience.sh
   ```
   Skrypt: ubija kolektor → wysyła ataki → pokazuje, że węzeł **buforuje logi i ponawia
   próby** (widać `ECONNREFUSED`, rosnący backoff) → restartuje kolektor → potwierdza,
   że **wszystkie logi z czasu awarii zostały dostarczone** (Eventual Consistency).
   To dowód, że system jest **AP** (Availability + Partition Tolerance) — nie gubi danych.

4. **(Opcjonalnie) Pokaż skalowanie.** Dorzuć trzeci węzeł na porcie 8083 — pojawia się
   na dashboardzie bez restartu reszty systemu (skalowalność horyzontalna).

---

## Jak to mapuje się na slajdy prezentacji

- **Analiza biznesowa / globalna mapa zagrożeń (slajd 2):** kolektor agreguje IP i typy
  ataków ze wszystkich węzłów → `GET /stats` i dashboard.
- **Emulacja usług, przechwytywanie logów, scentralizowana baza, dashboard (slajd 3):**
  realizowane przez `honeypot-node.js` + `collector.js`.
- **Izolacja (slajd 3/4):** węzeł **nigdy nie wykonuje** payloadu — tylko go zapisuje
  (`payload: body.slice(...)`). W Dockerze dodatkowo izolacja procesu.
- **Strukturalne logi JSON: znacznik czasu, IP, typ ataku, payload (slajd 6):** dokładnie
  taki kształt ma obiekt `event` budowany w węźle.
- **Komunikacja sync/async (slajd 6):** dashboard ↔ kolektor po HTTP/REST (sync);
  węzeł → kolektor przez bufor + retry (async, odporne na chwilowy brak połączenia).
- **CAP = AP, Eventual Consistency (slajd 7):** patrz `test-resilience.sh` — przyjmujemy
  ruch nawet gdy kolektor pada, logi dostarczamy z opóźnieniem.
- **Mechanizm Retry + TimeoutException (slajd 11):** `postLog()` ma `setTimeout` →
  `TimeoutException`, a `flushLoop()` ponawia z ograniczonym backoffem.

---

## Czego ten PoC świadomie NIE robi (i jak by to dołożyć w produkcji)

To celowo uproszczona wersja. W realnym systemie:

- **Kolejka:** lokalny bufor w pamięci → **Apache Kafka** (trwałe buforowanie milionów
  zdarzeń, odsprzęgnięcie węzłów od bazy).
- **Baza:** „mock" w pamięci → **Elasticsearch / MongoDB** z replikacją 3×.
- **Bezpieczeństwo:** zwykły HTTP → **TLS 1.3** i autoryzacja węzłów (mTLS / token).
- **Load balancing:** wiele instancji kolektora za **Nginx/HAProxy**.
- **Monitoring:** **Prometheus + Grafana**, health-checki i self-healing kontenerów.

Architektura PoC jest jednak tak zaprojektowana, że każdy z tych elementów to wymiana
jednego klocka, nie przepisywanie całości.
