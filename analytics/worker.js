// Cloudflare Worker entry: the collector at /e, the private dashboard at /, the daily clean-up on the cron.
import html from './dashboard.html';
import { handle, cleanUp } from './app.js';

export default {
  fetch: (req, env) => handle(req, env, html),
  scheduled: (_event, env, ctx) => ctx.waitUntil(cleanUp(env)),
};
