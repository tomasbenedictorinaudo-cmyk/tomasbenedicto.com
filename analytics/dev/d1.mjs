// A stand-in for Cloudflare D1 over Node's built-in SQLite: the part of the API the Worker uses.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function makeEnv(extra = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(q) {
      let args = [];
      const st = {
        bind: (...a) => { args = a; return st; },
        first: async () => { const r = sql.prepare(q).get(...args); return r ? { ...r } : null; },
        all: async () => ({ results: sql.prepare(q).all(...args).map((r) => ({ ...r })) }),
        run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; },
      };
      return st;
    },
  };
  return { sql, env: { DB, DASHBOARD_PASSWORD: 'dev', ALLOWED_ORIGINS: 'http://localhost:8123', ...extra } };
}
