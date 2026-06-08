/**
 * ============================================================
 *  ATTACKER  (Symulator atakujacego - tylko do DEMO)
 * ============================================================
 *  Nie jest czescia systemu - to narzedzie, ktore generuje
 *  realistyczny zlosliwy ruch HTTP wobec wezlow honeypot,
 *  zeby bylo widac przeplyw danych na zywo.
 *
 *  Symuluje wielu atakujacych (rozne zrodlowe IP) i rozne
 *  typy atakow: skanowanie, brute-force, SQLi, path traversal.
 *
 *  Uzycie:
 *    node attacker.js http://localhost:8081 http://localhost:8082
 *    node attacker.js --burst http://localhost:8081   (tryb DDoS)
 * ============================================================
 */

const http = require('http');
const { URL } = require('url');

const args = process.argv.slice(2);
const burst = args.includes('--burst');
const targets = args.filter((a) => a.startsWith('http'));
if (targets.length === 0) targets.push('http://localhost:8081');

// Pula falszywych zrodlowych IP (rozni "atakujacy" z calego swiata)
const ips = ['185.220.101.5', '45.155.205.99', '193.32.162.10', '212.83.146.7',
  '104.244.78.231', '89.248.165.33', '5.188.206.18', '141.98.10.60'];

// Repertuar atakow (sciezka, metoda, payload)
const attacks = [
  { method: 'GET', path: '/admin' },
  { method: 'GET', path: '/wp-login.php' },
  { method: 'GET', path: '/.env' },
  { method: 'GET', path: '/phpmyadmin/' },
  { method: 'GET', path: '/.git/config' },
  { method: 'GET', path: '/../../../../etc/passwd' },
  { method: 'POST', path: '/login', body: 'user=admin&pass=admin123' },
  { method: 'POST', path: '/login', body: 'user=root&pass=toor' },
  { method: 'POST', path: '/api/users', body: "id=1' OR '1'='1" },
  { method: 'POST', path: '/search', body: "q=1' UNION SELECT password FROM users--" },
  { method: 'GET', path: '/cgi-bin/shell.cgi' },
  { method: 'GET', path: '/xmlrpc.php' },
];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

function fire() {
  const target = new URL(rand(targets));
  const atk = rand(attacks);
  const ip = rand(ips);
  const data = atk.body || '';
  const req = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: encodeURI(atk.path), // kodujemy sciezke, by uniknac ERR_UNESCAPED_CHARACTERS
      method: atk.method,
      headers: {
        'X-Forwarded-For': ip, // symulujemy zrodlowy adres atakujacego
        'User-Agent': rand(['sqlmap/1.6', 'Nikto/2.1', 'curl/7.68', 'Mozilla/5.0 zgrab/0.x']),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
      },
    },
    (res) => res.resume()
  );
  req.on('error', () => {}); // wezel moze chwilowo nie odpowiadac - ignorujemy
  if (data) req.write(data);
  req.end();
}

const intervalMs = burst ? 40 : 700;
console.log(`Atakuje cele: ${targets.join(', ')} | tryb: ${burst ? 'BURST/DDoS' : 'normalny'} | co ${intervalMs}ms`);
console.log('Ctrl+C aby zatrzymac.\n');
setInterval(fire, intervalMs);
