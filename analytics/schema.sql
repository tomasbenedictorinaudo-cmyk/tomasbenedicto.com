-- Site analytics: one row per page view, no personal data.
-- visitor is a hash of (today's random salt, IP, user agent); the salt is deleted the next day,
-- so a visitor can be counted once per day but never followed from one day to the next or identified.

CREATE TABLE IF NOT EXISTS salts (
  day  TEXT PRIMARY KEY,          -- UTC date, YYYY-MM-DD
  salt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS views (
  id         TEXT PRIMARY KEY,    -- random id the page made for this view (never stored on the device)
  ts         INTEGER NOT NULL,    -- ms since epoch, UTC
  day        TEXT NOT NULL,       -- UTC date
  path       TEXT NOT NULL,       -- page path, no query string
  ref        TEXT,                -- referring site's host name only, when it is another site
  country    TEXT,                -- two-letter country code from Cloudflare, no finer location
  device     TEXT,                -- mobile | tablet | desktop, from the screen width
  visitor    TEXT NOT NULL,       -- daily hash, see above
  engaged_ms INTEGER NOT NULL DEFAULT 0  -- time the page was visible and in use
);

CREATE INDEX IF NOT EXISTS views_day ON views (day);
CREATE INDEX IF NOT EXISTS views_day_path ON views (day, path);
