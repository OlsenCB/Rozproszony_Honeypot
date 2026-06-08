
const http = require('http');
const { URL } = require('url');

const NODE_ID = process.env.NODE_ID || 'node-1';
const PORT = parseInt(process.env.PORT || '8081', 10);
const COLLECTOR_URL = process.env.COLLECTOR_URL || 'http://localhost:9000/logs';
const REQUEST_TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '800', 10);
const BACKOFF_BASE_MS = parseInt(process.env.BACKOFF_BASE_MS || '150', 10);
const BACKOFF_MAX_MS = parseInt(process.env.BACKOFF_MAX_MS || '1500', 10);

const buffer = [];

function classifyAttack(method, path, body) {
  const p = (path || '').toLowerCase();
  const b = (body || '').toLowerCase();
  if (/('|%27)\s*(or|union|select|--)/.test(b) || /union\s+select/.test(p)) return 'sqli';
  if (p.includes('../') || p.includes('..%2f') || p.includes('/etc/passwd') || p.includes('/.env')) return 'path_traversal';
  if (/(login|admin|wp-login|signin|auth)/.test(p) && method === 'POST') return 'credential_access';
  if (/(phpmyadmin|\.git|\.env|xmlrpc|wp-|cgi-bin|shell|config)/.test(p)) return 'scanner';
  if (method === 'GET') return 'recon';
  return 'other';
}

function postLog(event) {
  return new Promise((resolve, reject) => {
    const u = new URL(COLLECTOR_URL);
    const payload = JSON.stringify(event);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        res.resume(); 
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error('HTTP ' + res.statusCode));
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('TimeoutException')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function flushLoop() {
  let backoff = BACKOFF_BASE_MS;
  let fails = 0;
  while (true) {
    if (buffer.length === 0) {
      await sleep(150);
      continue;
    }
    try {
      await postLog(buffer[0]);
      buffer.shift();           
      backoff = BACKOFF_BASE_MS; 
      fails = 0;
    } catch (err) {
      fails += 1;
      console.log(`[${NODE_ID}] ! Dostarczenie nieudane (${err.message}). Proba #${fails}, retry za ${backoff}ms. W buforze: ${buffer.length}`);
      await sleep(backoff);
      backoff = Math.min(BACKOFF_MAX_MS, backoff * 2); 
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 1e5) req.destroy();
  });
  req.on('end', () => {

    const sourceIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
    const attackType = classifyAttack(req.method, req.url, body);

    const event = {
      nodeId: NODE_ID,
      timestamp: new Date().toISOString(),
      sourceIp,
      method: req.method,
      path: req.url,
      userAgent: req.headers['user-agent'] || '',
      payload: body.slice(0, 500), 
      attackType,
    };

    buffer.push(event);
    console.log(`[${NODE_ID}] PULAPKA: ${req.method} ${req.url} od ${sourceIp} -> ${attackType}`);

    res.writeHead(200, { 'Content-Type': 'text/html', Server: 'Apache/2.4.41 (Ubuntu)' });
    res.end('<html><body><h1>Admin Panel</h1><form>Login required</form></body></html>');
  });
});

server.listen(PORT, () => {
  console.log(`\n=== HONEY-NODE "${NODE_ID}" nasluchuje na porcie ${PORT} ===`);
  console.log(`  Przekazuje logi do: ${COLLECTOR_URL}`);
  console.log(`  Timeout=${REQUEST_TIMEOUT_MS}ms, backoff=${BACKOFF_BASE_MS}..${BACKOFF_MAX_MS}ms\n`);
  flushLoop();
});
