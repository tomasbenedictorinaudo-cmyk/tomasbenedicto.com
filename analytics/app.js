// Site analytics: the collector and the private dashboard's API, for a Cloudflare Worker with a D1 database.
// Privacy by design: no cookies, nothing stored on the visitor's device, no IP address stored.
// A visitor is a hash of (a random salt that changes every UTC day, the site, the IP, the user agent): it
// counts unique visitors within one day and cannot be reversed or linked across days once the salt is deleted.

const DAY_MS = 86400000;
const RETENTION_DAYS = 760;            // about 25 months, the CNIL's ceiling for audience-measurement data
const MAX_ENGAGED_MS = 4 * 3600000;    // a view's engaged time is capped at 4 h
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|headless|lighthouse|pagespeed|preview|monitor|uptime|curl|wget|python|httpclient|axios|node-fetch|go-http|java\//i;

const saltCache = new WeakMap();        // database -> { day, salt }, for this isolate

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function cors(origin) {
  return origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' } : {};
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function saltFor(env, day) {
  const c = saltCache.get(env.DB);
  if (c && c.day === day) return c.salt;
  await env.DB.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').bind(day, randomHex(32)).run();
  const row = await env.DB.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first();
  saltCache.set(env.DB, { day, salt: row.salt });
  return row.salt;
}

function deviceClass(w) {
  if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) return null;
  return w < 600 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop';
}

function cleanPath(p) {
  if (typeof p !== 'string' || !p.startsWith('/')) return null;
  p = p.split(/[?#]/)[0].slice(0, 200).replace(/\/index\.html$/, '/');
  return /^[\w\-./~%@]*$/.test(p) ? p : null;
}

async function collect(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return new Response(null, { status: 403 });
  const h = cors(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: h });
  const done = new Response(null, { status: 204, headers: h });

  // The visitor's own choices first: Global Privacy Control and Do Not Track mean nothing is recorded.
  if (req.headers.get('Sec-GPC') === '1' || req.headers.get('DNT') === '1') return done;
  const ua = req.headers.get('User-Agent') || '';
  if (!ua || BOT.test(ua)) return done;

  const text = await req.text();
  if (text.length > 1000) return new Response(null, { status: 413, headers: h });
  let e;
  try { e = JSON.parse(text); } catch { return new Response(null, { status: 400, headers: h }); }
  if (!e || typeof e.id !== 'string' || !/^[a-z0-9]{8,32}$/.test(e.id)) return new Response(null, { status: 400, headers: h });
  const now = Date.now();

  if (e.t === 'v') {
    const path = cleanPath(e.p);
    if (!path) return new Response(null, { status: 400, headers: h });
    const site = new URL(origin).hostname.replace(/^www\./, '');
    let ref = typeof e.r === 'string' ? e.r.toLowerCase().replace(/^www\./, '').slice(0, 100) : null;
    if (ref && (!/^[a-z0-9.-]+$/.test(ref) || ref === site || ref.endsWith('.' + site))) ref = null;
    const country = typeof req.cf?.country === 'string' && /^[A-Z]{2}$/.test(req.cf.country) ? req.cf.country : null;
    const ip = req.headers.get('CF-Connecting-IP') || '';
    const day = utcDay(now);
    const visitor = (await sha256Hex(`${await saltFor(env, day)}|${site}|${ip}|${ua}`)).slice(0, 16);
    await env.DB.prepare('INSERT OR IGNORE INTO views (id, ts, day, path, ref, country, device, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(e.id, now, day, path, ref, country, deviceClass(e.w), visitor).run();
  } else if (e.t === 'e') {
    const ms = Math.round(Number(e.ms));
    if (!Number.isFinite(ms) || ms <= 0) return done;
    await env.DB.prepare('UPDATE views SET engaged_ms = MAX(engaged_ms, ?) WHERE id = ? AND ts > ?')
      .bind(Math.min(ms, MAX_ENGAGED_MS), e.id, now - DAY_MS).run();
  }
  return done;
}

// ---------- the dashboard: Basic authentication against the DASHBOARD_PASSWORD secret ----------

async function authorised(req, env) {
  if (!env.DASHBOARD_PASSWORD) return false;
  const m = /^Basic\s+(.+)$/i.exec(req.headers.get('Authorization') || '');
  if (!m) return false;
  let pass = '';
  try { pass = atob(m[1]).split(':').slice(1).join(':'); } catch { return false; }
  // Compare digests, so the comparison takes the same time whatever the guess.
  const [a, b] = await Promise.all([sha256Hex(pass), sha256Hex(env.DASHBOARD_PASSWORD)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const PRIVATE = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function stats(env, url) {
  const now = Date.now();
  const to = isDay(url.searchParams.get('to')) ? url.searchParams.get('to') : utcDay(now);
  const from = isDay(url.searchParams.get('from')) ? url.searchParams.get('from') : utcDay(now - 29 * DAY_MS);
  const q = (sql) => env.DB.prepare(sql).bind(from, to).all().then((r) => r.results);
  const W = 'WHERE day BETWEEN ? AND ?';
  // A visitor is unique within a day, so "visitors" over a range is the sum of each day's (as day || visitor).
  const [series, pages, refs, countries, devices, first] = await Promise.all([
    q(`SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors,
               SUM(engaged_ms) AS engagedMs, SUM(engaged_ms > 0) AS engagedViews
         FROM views ${W} GROUP BY day ORDER BY day`),
    q(`SELECT path, COUNT(*) AS views, COUNT(DISTINCT day || visitor) AS visitors,
               SUM(engaged_ms) AS engagedMs, SUM(engaged_ms > 0) AS engagedViews
         FROM views ${W} GROUP BY path ORDER BY COUNT(*) DESC, COUNT(DISTINCT day || visitor) DESC, path LIMIT 50`),
    q(`SELECT COALESCE(ref, '') AS ref, COUNT(DISTINCT day || visitor) AS visitors, COUNT(*) AS views
         FROM views ${W} GROUP BY ref ORDER BY COUNT(DISTINCT day || visitor) DESC, COUNT(*) DESC LIMIT 20`),
    q(`SELECT COALESCE(country, '') AS country, COUNT(DISTINCT day || visitor) AS visitors, COUNT(*) AS views
         FROM views ${W} GROUP BY country ORDER BY COUNT(DISTINCT day || visitor) DESC, COUNT(*) DESC LIMIT 20`),
    q(`SELECT COALESCE(device, '') AS device, COUNT(DISTINCT day || visitor) AS visitors, COUNT(*) AS views
         FROM views ${W} GROUP BY device ORDER BY COUNT(DISTINCT day || visitor) DESC, COUNT(*) DESC`),
    env.DB.prepare('SELECT MIN(day) AS day FROM views').all().then((r) => r.results),
  ]);
  return { from, to, firstDay: first[0]?.day ?? null, series, pages, refs, countries, devices };
}

export async function handle(req, env, html) {
  const url = new URL(req.url);
  if (url.pathname === '/e') return collect(req, env);
  if (url.pathname === '/' || url.pathname === '/api/stats') {
    if (!env.DASHBOARD_PASSWORD) return new Response('Set the DASHBOARD_PASSWORD secret first (see README).', { status: 503, headers: PRIVATE });
    if (!(await authorised(req, env))) {
      return new Response('Authentication required', { status: 401, headers: { ...PRIVATE, 'WWW-Authenticate': 'Basic realm="Site analytics", charset="UTF-8"' } });
    }
    if (url.pathname === '/') return new Response(html, { headers: { ...PRIVATE, 'Content-Type': 'text/html; charset=utf-8' } });
    return new Response(JSON.stringify(await stats(env, url)), { headers: { ...PRIVATE, 'Content-Type': 'application/json' } });
  }
  if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
  return new Response('Not found', { status: 404 });
}

// Daily clean-up: yesterday's salt goes (so the day's hashes can no longer be recomputed), and views past the retention.
export async function cleanUp(env, now = Date.now()) {
  await env.DB.prepare('DELETE FROM salts WHERE day < ?').bind(utcDay(now)).run();
  await env.DB.prepare('DELETE FROM views WHERE day < ?').bind(utcDay(now - RETENTION_DAYS * DAY_MS)).run();
}
