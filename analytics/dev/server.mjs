// Local test bench, no Cloudflare account needed: the Worker on :8787 over Node's built-in SQLite (standing in for D1),
// and the website on :8123 with the tracker pointed at it.
//   node analytics/dev/server.mjs [--seed]      (--seed fills 90 days of made-up views to look at the dashboard)
// Dashboard: http://localhost:8787  (any user name, password "dev")
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, cleanUp } from '../app.js';
import { makeEnv } from './d1.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const site = join(here, '..', '..');
const { sql, env } = makeEnv();

if (process.argv.includes('--seed')) {
  const pages = [['/', 0.62], ['/cv.html', 0.3], ['/privacy.html', 0.03], ['/nexus/', 0.05]];
  const refs = [null, null, null, 'linkedin.com', 'google.com', 'github.com'];
  const ctry = ['FR', 'FR', 'FR', 'ES', 'DE', 'GB', 'US', 'IT', 'NL', null];
  const dev = ['desktop', 'desktop', 'mobile', 'mobile', 'tablet'];
  const ins = sql.prepare('INSERT INTO views (id, ts, day, path, ref, country, device, visitor, engaged_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  let k = 0;
  for (let d = 89; d >= 0; d--) {
    const t0 = Date.now() - d * 86400000, day = new Date(t0).toISOString().slice(0, 10);
    const n = Math.round(8 + 6 * Math.sin(d / 9) + Math.random() * 6 + (d < 20 ? 6 : 0));
    for (let v = 0; v < n; v++) {
      const visits = 1 + Math.floor(Math.random() * 2.2), who = `v${day}${v}`, ref = refs[Math.floor(Math.random() * refs.length)];
      for (let j = 0; j < visits; j++) {
        let r = Math.random(), p = pages[0][0];
        for (const [path, w] of pages) { if ((r -= w) < 0) { p = path; break; } }
        ins.run(`s${k++}`, t0, day, p, j ? null : ref, ctry[v % ctry.length], dev[v % dev.length], who, Math.random() < 0.85 ? Math.round(5000 + Math.random() * 150000) : 0);
      }
    }
  }
  console.log(`seeded ${k} views`);
}

createServer(async (req, res) => {
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise((ok) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => ok(Buffer.concat(c))); });
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  headers.set('CF-Connecting-IP', req.socket.remoteAddress || '');
  const request = new Request(`http://localhost:8787${req.url}`, { method: req.method, headers, body });
  Object.defineProperty(request, 'cf', { value: { country: 'FR' } });
  const html = readFileSync(join(here, '..', 'dashboard.html'), 'utf8');
  const out = await handle(request, env, html);
  if (req.url === '/e') console.log(req.method, req.url, out.status, body ? body.toString() : '');
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(8787, () => console.log('worker    http://localhost:8787  (password "dev")'));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.endsWith('/')) p += 'index.html';
  const f = join(site, p);
  if (!f.startsWith(site) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end('not found'); }
  let data = readFileSync(f);
  if (extname(f) === '.html') data = data.toString().replace(/data-api="[^"]*"/g, 'data-api="http://localhost:8787"');
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' });
  res.end(data);
}).listen(8123, () => console.log('website   http://localhost:8123'));

process.on('SIGUSR2', () => cleanUp(env));
