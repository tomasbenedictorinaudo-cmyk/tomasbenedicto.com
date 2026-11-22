# Site analytics

Private, cookieless audience measurement for tomasbenedicto.com: a Cloudflare Worker collects page views, a D1 database keeps them, and a password-protected dashboard on the Worker shows unique visitors, page views, time on page, history and the most visited pages.

| File | What it is |
|---|---|
| `t.js` | The tracker each page loads (about 2 KB). Served by GitHub Pages with the site. |
| `app.js` | The collector (`POST /e`), the dashboard's data (`GET /api/stats`) and the daily clean-up. |
| `worker.js` | The Worker's entry point. |
| `dashboard.html` | The dashboard, served by the Worker at `/` behind the password. |
| `schema.sql` | The database tables. |
| `wrangler.toml` | The Worker's configuration. |
| `dev/` | A local test bench and the tests (Node 22.5+, no Cloudflare account needed). |

## Privacy

- **No cookies and nothing stored on the visitor's device.** The opt-out on `/privacy.html` is the one exception, and only when a visitor asks for it.
- **No IP address stored.** A visitor is a hash of today's random salt, the site, the IP and the user agent. The salt is deleted the next day, so the hash can't be reversed or linked across days.
- **Sent per page:** the path (no query string), the referring site's host name, a coarse device class from the screen width, and the time the page was visible and in use. Cloudflare adds the country.
- **Not recorded at all** when the browser sends Global Privacy Control or Do Not Track, for bots, and for pages opened from other sites.
- **Raw rows are deleted after 25 months** by the daily cron. Worker request logs are off (`[observability] enabled = false`), so no IPs end up in logs either.

## Set it up (once)

You need a free Cloudflare account. Run these from this folder (`analytics/`).

1. Log in:
   ```bash
   npx wrangler@4 login
   ```
2. Create the database, keeping the data in the EU:
   ```bash
   npx wrangler@4 d1 create site-analytics --jurisdiction eu
   ```
   Copy the `database_id` it prints into `wrangler.toml`, replacing `REPLACE-WITH-THE-ID-FROM-wrangler-d1-create`.
3. Create the tables:
   ```bash
   npx wrangler@4 d1 execute site-analytics --remote --file schema.sql
   ```
4. Set the dashboard password. Choose a long one; it is stored as an encrypted secret, never in the repo:
   ```bash
   npx wrangler@4 secret put DASHBOARD_PASSWORD
   ```
5. Deploy:
   ```bash
   npx wrangler@4 deploy
   ```
   It prints the Worker's address, for example `https://site-analytics.<your-subdomain>.workers.dev`.
6. In `index.html`, `cv.html` and `privacy.html`, replace `https://site-analytics.YOUR-SUBDOMAIN.workers.dev` in the `data-api` attribute with that address. Until then the tracker does nothing.
7. Merge the branch into `main`. GitHub Pages publishes the site, and counting starts.

**Dashboard:** open the Worker's address in a browser. It asks for a password; type any user name and the password from step 4.

**Optional, stronger lock:** in the Cloudflare dashboard, go to Zero Trust › Access › Applications. Protect the Worker's hostname for your email only, so you get a one-time code by email in front of the password. Leave the `/e` path out of the policy (a bypass rule), or visits won't be recorded.

**Excluding your own visits:** open `/privacy.html` on each of your browsers and turn measurement off.

## Work on it locally

```bash
node analytics/dev/server.mjs --seed
```
- Run it from the repository root.
- The website is on http://localhost:8123, with the tracker pointed at the local Worker.
- The dashboard is on http://localhost:8787 (password `dev`).
- `--seed` adds 90 days of made-up data so the dashboard has something to show.

Tests:
```bash
node --test analytics/dev/test.mjs
```

## Notes

- **Unique visitors are counted per day.** With no cookies, the same person on two days counts twice, so "unique visitors" over a period is the sum of each day's. Plausible and similar tools count the same way.
- **Time on page** counts while the tab is visible and has had input (scroll, pointer, keys, touch) within the last 3 minutes. It is capped at 4 h per view.
- **Days are UTC days.**
- **These files are public.** GitHub Pages serves everything in this repository, so these files are public too. That is deliberate: they show exactly what is collected. They contain no secrets: the password is a Cloudflare secret, and the database ID is useless without your account.
