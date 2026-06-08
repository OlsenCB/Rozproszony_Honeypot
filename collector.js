
const http = require('http');

const PORT = parseInt(process.env.PORT || '9000', 10);

const db = {
  events: [],          
  byNode: {},         
  byAttackType: {},    
  bySourceIp: {},      
  startedAt: Date.now(),
};


const REQUIRED_FIELDS = ['nodeId', 'timestamp', 'sourceIp', 'attackType'];

function validate(event) {
  for (const f of REQUIRED_FIELDS) {
    if (event[f] === undefined || event[f] === null || event[f] === '') {
      return `Brak wymaganego pola: ${f}`;
    }
  }
  return null;
}

function ingest(event) {
  db.events.push(event);
  if (db.events.length > 5000) db.events.shift();

  const node = event.nodeId;
  if (!db.byNode[node]) db.byNode[node] = { count: 0, lastSeen: 0 };
  db.byNode[node].count += 1;
  db.byNode[node].lastSeen = Date.now();

  db.byAttackType[event.attackType] = (db.byAttackType[event.attackType] || 0) + 1;
  db.bySourceIp[event.sourceIp] = (db.bySourceIp[event.sourceIp] || 0) + 1;
  dirty = true; 
}

function buildStats() {
  const now = Date.now();
  const nodes = Object.entries(db.byNode).map(([id, v]) => ({
    id,
    count: v.count,
    online: now - v.lastSeen < 10000,
    lastSeenMsAgo: now - v.lastSeen,
  }));

  const topIps = Object.entries(db.bySourceIp)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([ip, count]) => ({ ip, count }));

  const attackTypes = Object.entries(db.byAttackType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));

  return {
    totalEvents: db.events.length,
    uniqueIps: Object.keys(db.bySourceIp).length,
    activeNodes: nodes.filter((n) => n.online).length,
    knownNodes: nodes.length,
    uptimeSec: Math.floor((now - db.startedAt) / 1000),
    nodes,
    topIps,
    attackTypes,
    recent: db.events.slice(-12).reverse(),
  };
}


const sseClients = new Set();
let dirty = false; 

function pushStatsToClients() {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify(buildStats())}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}


const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/logs') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); 
    });
    req.on('end', () => {
      let event;
      try {
        event = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Niepoprawny JSON' }));
      }
      const err = validate(event);
      if (err) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err }));
      }
      event.receivedAt = new Date().toISOString();
      ingest(event);
      process.stdout.write(
        `[COLLECTOR] <- ${event.nodeId.padEnd(10)} | ${String(event.attackType).padEnd(18)} | ${event.sourceIp}\n`
      );
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'stored', total: db.events.length }));
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(buildStats()));
  }

  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');                           
    res.write(`data: ${JSON.stringify(buildStats())}\n\n`);  
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(DASHBOARD_HTML);
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`\n=== LOG-COLLECTOR uruchomiony ===`);
  console.log(`  Ingest logow:  POST http://localhost:${PORT}/logs`);
  console.log(`  API statystyk: GET  http://localhost:${PORT}/stats`);
  console.log(`  Strumien push: GET  http://localhost:${PORT}/events  (SSE)`);
  console.log(`  Dashboard:     GET  http://localhost:${PORT}/  (otworz w przegladarce)\n`);

  setInterval(() => {
    if (dirty) {
      pushStatsToClients();
      dirty = false;
    }
  }, 700);
  setInterval(() => {
    for (const client of sseClients) {
      try { client.write(': keep-alive\n\n'); } catch (e) { sseClients.delete(client); }
    }
  }, 15000);
});

const DASHBOARD_HTML = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Honeypot Threat Map</title>
<style>
  :root{
    --bg:#0a0f0d; --panel:#121a18; --line:#1f2c28;
    --green:#2bff88; --cyan:#22d3ee; --muted:#7b8a86; --text:#e6f1ee; --red:#ff5a5a;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:radial-gradient(1200px 600px at 70% -10%, #11261d 0%, var(--bg) 55%);
       color:var(--text);font-family:"DejaVu Sans Mono",ui-monospace,Menlo,Consolas,monospace;
       min-height:100vh;padding:28px 32px}
  header{display:flex;align-items:center;gap:14px;margin-bottom:24px}
  header .bar{width:6px;height:38px;background:var(--green);border-radius:3px;box-shadow:0 0 18px var(--green)}
  h1{font-size:26px;letter-spacing:1px;color:var(--green);text-shadow:0 0 16px rgba(43,255,136,.35)}
  .sub{color:var(--cyan);font-size:13px;margin-top:2px;letter-spacing:.5px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px;position:relative;overflow:hidden}
  .card::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(43,255,136,.05),transparent 40%);pointer-events:none}
  .kpi{font-size:40px;font-weight:700;color:var(--green);line-height:1}
  .kpi.cyan{color:var(--cyan)}
  .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:1.5px;margin-top:8px}
  .cols{display:grid;grid-template-columns:1.1fr 1fr 1.4fr;gap:16px}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
  .panel h2{font-size:13px;color:var(--cyan);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;border-bottom:1px solid var(--line);padding-bottom:10px}
  .row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;font-size:13px;border-bottom:1px dashed #1a2522}
  .row:last-child{border-bottom:none}
  .pill{font-size:11px;padding:2px 9px;border-radius:20px;background:#13241d;color:var(--green);border:1px solid #1f4434}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px}
  .dot.on{background:var(--green);box-shadow:0 0 8px var(--green)}
  .dot.off{background:var(--red)}
  .bar-wrap{flex:1;height:7px;background:#0e1614;border-radius:4px;margin:0 12px;overflow:hidden}
  .bar-fill{height:100%;background:linear-gradient(90deg,var(--cyan),var(--green));border-radius:4px}
  .feed{max-height:340px;overflow:auto;font-size:12px}
  .feed .ev{display:grid;grid-template-columns:64px 92px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid #131d1a}
  .t-cred{color:#ffd166}.t-sqli{color:#ff5a5a}.t-trav{color:#ff9f43}.t-scan{color:var(--cyan)}.t-recon{color:var(--muted)}.t-other{color:var(--text)}
  .ip{color:var(--green)}
  .ts{color:var(--muted)}
  .muted{color:var(--muted)}
  .live{font-size:11px;color:var(--green)}
  .blink{animation:b 1s steps(2) infinite}@keyframes b{50%{opacity:.2}}
</style>
</head>
<body>
  <header>
    <div class="bar"></div>
    <div>
      <h1>ROZPROSZONY HONEYPOT &mdash; GLOBALNA MAPA ZAGROZEN</h1>
      <div class="sub">Scentralizowana baza logow &middot; <span class="live blink">&#9679; LIVE</span></div>
    </div>
  </header>

  <div class="grid">
    <div class="card"><div class="kpi" id="kEvents">0</div><div class="label">Zdarzen (total)</div></div>
    <div class="card"><div class="kpi cyan" id="kNodes">0</div><div class="label">Aktywne wezly</div></div>
    <div class="card"><div class="kpi" id="kIps">0</div><div class="label">Unikalne IP atak.</div></div>
    <div class="card"><div class="kpi cyan" id="kUptime">0s</div><div class="label">Uptime kolektora</div></div>
  </div>

  <div class="cols">
    <div class="panel">
      <h2>Wezly (sensory)</h2>
      <div id="nodes"></div>
    </div>
    <div class="panel">
      <h2>Typy atakow</h2>
      <div id="types"></div>
    </div>
    <div class="panel">
      <h2>Live feed zdarzen</h2>
      <div class="feed" id="feed"></div>
    </div>
  </div>

<script>
  const cls = t => ({credential_access:'t-cred',sqli:'t-sqli',path_traversal:'t-trav',scanner:'t-scan',recon:'t-recon'}[t]||'t-other');
  function render(s){
    kEvents.textContent = s.totalEvents;
    kNodes.textContent  = s.activeNodes + '/' + s.knownNodes;
    kIps.textContent    = s.uniqueIps;
    kUptime.textContent = s.uptimeSec + 's';

    nodes.innerHTML = s.nodes.map(n =>
      '<div class="row"><span><span class="dot '+(n.online?'on':'off')+'"></span>'+n.id+'</span>'+
      '<span class="pill">'+n.count+' logow</span></div>').join('') || '<div class="muted">brak wezlow...</div>';

    const max = Math.max(1, ...s.attackTypes.map(a=>a.count));
    types.innerHTML = s.attackTypes.map(a =>
      '<div class="row"><span class="'+cls(a.type)+'">'+a.type+'</span>'+
      '<div class="bar-wrap"><div class="bar-fill" style="width:'+(a.count/max*100)+'%"></div></div>'+
      '<span class="muted">'+a.count+'</span></div>').join('') || '<div class="muted">brak danych...</div>';

    feed.innerHTML = s.recent.map(e => {
      const t = (e.timestamp||'').slice(11,19);
      return '<div class="ev"><span class="ts">'+t+'</span>'+
             '<span class="'+cls(e.attackType)+'">'+e.attackType+'</span>'+
             '<span><span class="ip">'+e.sourceIp+'</span> <span class="muted">'+(e.method||'')+' '+(e.path||'')+'</span></span></div>';
    }).join('') || '<div class="muted">czekam na ataki...</div>';
  }

  const liveEl = document.querySelector('.live');

  // 1) Synchroniczne zapytanie REST na starcie - dane statystyczne (slajd 6)
  fetch('/stats').then(r => r.json()).then(render).catch(() => {});

  // 2) Strumien push (SSE) - aktualizacja w czasie rzeczywistym (slajd 3).
  //    EventSource sam wznawia polaczenie po zerwaniu (demonstracja odpornosci).
  const es = new EventSource('/events');
  es.onmessage = (e) => { try { render(JSON.parse(e.data)); } catch (_){} };
  es.onopen  = () => { liveEl.textContent = '\u25CF LIVE'; liveEl.className = 'live blink'; };
  es.onerror = () => { liveEl.textContent = '\u25CF RECONNECT...'; liveEl.className = 'live'; };
</script>
</body>
</html>`;
