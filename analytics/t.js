/* Privacy-friendly page analytics for tomasbenedicto.com (details: /privacy.html).
   No cookies and nothing stored on the device; it sends the page path, the referring site's name,
   the screen width and the time the page was in use. Global Privacy Control, Do Not Track and the
   opt-out on the privacy page turn it off. */
(function () {
  'use strict';
  var s = document.currentScript, api = s && s.getAttribute('data-api');
  if (!api || /YOUR-|REPLACE/.test(api)) return;
  var dev = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(api);
  if (!dev && !/(^|\.)tomasbenedicto\.com$/.test(location.hostname)) return;
  if (navigator.globalPrivacyControl || navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.webdriver) return;
  try { if (localStorage.getItem('analytics-optout') === '1') return; } catch (e) {}

  var END = api.replace(/\/+$/, '') + '/e', IDLE_MS = 180000, TICK_MS = 5000;
  var id, active, sent, lastTick, lastInput;

  function rid() {
    var a = new Uint8Array(12), out = '';
    crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) out += (a[i] % 36).toString(36);
    return out;
  }
  function send(o) {
    var body = JSON.stringify(o);
    try { if (navigator.sendBeacon && navigator.sendBeacon(END, body)) return; } catch (e) {}
    try { fetch(END, { method: 'POST', body: body, keepalive: true, mode: 'no-cors', credentials: 'omit' }); } catch (e) {}
  }
  function referrer() {
    try { var h = new URL(document.referrer).hostname; return h && h !== location.hostname ? h : null; } catch (e) { return null; }
  }
  function view() {
    id = rid(); active = 0; sent = 0; lastTick = lastInput = Date.now();
    send({ t: 'v', id: id, p: location.pathname, r: referrer(), w: screen.width });
  }
  // Time on page: counted while the page is visible and someone has used it in the last 3 minutes.
  function tick() {
    var now = Date.now();
    if (document.visibilityState === 'visible' && now - lastInput < IDLE_MS) active += Math.min(now - lastTick, 2 * TICK_MS);
    lastTick = now;
  }
  function flush() {
    tick();
    if (active - sent >= 1000) { sent = active; send({ t: 'e', id: id, ms: active }); }
  }
  function input() { var now = Date.now(); if (now - lastInput >= IDLE_MS) lastTick = now; lastInput = now; }

  ['scroll', 'pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
    addEventListener(ev, input, { passive: true, capture: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(); else { lastTick = Date.now(); input(); }
  });
  addEventListener('pagehide', flush);
  addEventListener('pageshow', function (e) { if (e.persisted) view(); });   // back/forward cache: a new view
  setInterval(tick, TICK_MS);

  if (document.prerendering) document.addEventListener('prerenderingchange', view, { once: true });
  else view();
})();
