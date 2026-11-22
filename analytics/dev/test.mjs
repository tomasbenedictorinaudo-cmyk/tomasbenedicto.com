// node --test analytics/dev/test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, cleanUp } from '../app.js';
import { makeEnv } from './d1.mjs';

const ORIGIN = 'http://localhost:8123';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15';
const auth = (p = 'dev') => ({ Authorization: 'Basic ' + btoa('me:' + p) });

function post(env, body, { origin = ORIGIN, ua = UA, ip = '1.2.3.4', headers = {} } = {}) {
  const r = new Request('https://w.example/e', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { Origin: origin, 'User-Agent': ua, 'CF-Connecting-IP': ip, ...headers } });
  Object.defineProperty(r, 'cf', { value: { country: 'FR' } });
  return handle(r, env, '<html>dash</html>');
}
const get = (env, path, headers = {}) => handle(new Request('https://w.example' + path, { headers }), env, '<html>dash</html>');
const rows = (sql) => sql.prepare('SELECT * FROM views ORDER BY ts, id').all();

test('a page view is stored without the IP, with a daily visitor hash', async () => {
  const { env, sql } = makeEnv();
  const r = await post(env, { t: 'v', id: 'abc12345', p: '/cv.html?email=x@y.z#top', r: 'www.LinkedIn.com', w: 390 });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const [v] = rows(sql);
  assert.equal(v.path, '/cv.html');            // query and hash dropped
  assert.equal(v.ref, 'linkedin.com');
  assert.equal(v.device, 'mobile');
  assert.equal(v.country, 'FR');
  assert.match(v.visitor, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(v).includes('1.2.3.4'));
});

test('the same person counts once a day; another IP or browser is another visitor', async () => {
  const { env, sql } = makeEnv();
  await post(env, { t: 'v', id: 'aaaaaaaa', p: '/' });
  await post(env, { t: 'v', id: 'bbbbbbbb', p: '/cv.html' });
  await post(env, { t: 'v', id: 'cccccccc', p: '/' }, { ip: '5.6.7.8' });
  await post(env, { t: 'v', id: 'dddddddd', p: '/' }, { ua: UA + ' Firefox' });
  const vs = rows(sql).map((r) => r.visitor);
  assert.equal(vs[0], vs[1]);
  assert.equal(new Set(vs).size, 3);
});

test('engagement keeps the largest reported time, capped', async () => {
  const { env, sql } = makeEnv();
  await post(env, { t: 'v', id: 'eeeeeeee', p: '/' });
  await post(env, { t: 'e', id: 'eeeeeeee', ms: 42000 });
  await post(env, { t: 'e', id: 'eeeeeeee', ms: 12000 });   // a late, smaller beacon does not lower it
  assert.equal(rows(sql)[0].engaged_ms, 42000);
  await post(env, { t: 'e', id: 'eeeeeeee', ms: 1e12 });
  assert.equal(rows(sql)[0].engaged_ms, 4 * 3600000);
});

test('other sites, bots, Do Not Track, GPC and bad input record nothing', async () => {
  const { env, sql } = makeEnv();
  assert.equal((await post(env, { t: 'v', id: 'ffffffff', p: '/' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(env, { t: 'v', id: 'ffffffff', p: '/' }, { ua: 'Googlebot/2.1' })).status, 204);
  assert.equal((await post(env, { t: 'v', id: 'ffffffff', p: '/' }, { headers: { DNT: '1' } })).status, 204);
  assert.equal((await post(env, { t: 'v', id: 'ffffffff', p: '/' }, { headers: { 'Sec-GPC': '1' } })).status, 204);
  assert.equal((await post(env, 'not json')).status, 400);
  assert.equal((await post(env, { t: 'v', id: 'x', p: '/' })).status, 400);
  assert.equal((await post(env, { t: 'v', id: 'gggggggg', p: 'javascript:alert(1)' })).status, 400);
  assert.equal((await post(env, { t: 'v', id: 'gggggggg', p: '/' + 'a'.repeat(2000) })).status, 413);
  assert.equal(rows(sql).length, 0);
});

test('the referrer is dropped when it is the site itself', async () => {
  const { env, sql } = makeEnv();
  await post(env, { t: 'v', id: 'hhhhhhhh', p: '/', r: 'localhost' });
  assert.equal(rows(sql)[0].ref, null);
});

test('the dashboard and its data need the password', async () => {
  const { env } = makeEnv();
  assert.equal((await get(env, '/')).status, 401);
  assert.equal((await get(env, '/api/stats', auth('wrong'))).status, 401);
  const ok = await get(env, '/', auth());
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Cache-Control'), 'no-store');
  assert.equal((await get(env, '/api/stats', auth())).status, 200);
  const { env: unset } = makeEnv({ DASHBOARD_PASSWORD: '' });
  assert.equal((await get(unset, '/', auth(''))).status, 503);
});

test('statistics: visitors per day, views, time on page and top pages', async () => {
  const { env } = makeEnv();
  await post(env, { t: 'v', id: 'iiiiiiii', p: '/', w: 1440 });
  await post(env, { t: 'e', id: 'iiiiiiii', ms: 30000 });
  await post(env, { t: 'v', id: 'jjjjjjjj', p: '/cv.html', w: 1440 });
  await post(env, { t: 'e', id: 'jjjjjjjj', ms: 90000 });
  await post(env, { t: 'v', id: 'kkkkkkkk', p: '/', w: 800 }, { ip: '9.9.9.9' });
  const s = await (await get(env, '/api/stats', auth())).json();
  assert.equal(s.series.length, 1);
  assert.deepEqual({ views: s.series[0].views, visitors: s.series[0].visitors, engagedMs: s.series[0].engagedMs, engagedViews: s.series[0].engagedViews },
    { views: 3, visitors: 2, engagedMs: 120000, engagedViews: 2 });
  assert.deepEqual(s.pages.map((p) => [p.path, p.views, p.visitors]), [['/', 2, 2], ['/cv.html', 1, 1]]);
  assert.deepEqual(s.devices.map((d) => [d.device, d.visitors]), [['desktop', 1], ['tablet', 1]]);
});

test('clean-up deletes past salts and views past 25 months', async () => {
  const { env, sql } = makeEnv();
  sql.prepare("INSERT INTO salts VALUES ('2020-01-01', 'x')").run();
  sql.prepare("INSERT INTO views (id, ts, day, path, visitor) VALUES ('old00000', 0, '2020-01-01', '/', 'v')").run();
  await post(env, { t: 'v', id: 'llllllll', p: '/' });
  await cleanUp(env);
  assert.deepEqual(sql.prepare('SELECT day FROM salts').all().map((r) => r.day), [new Date().toISOString().slice(0, 10)]);
  assert.deepEqual(rows(sql).map((r) => r.id), ['llllllll']);
});
