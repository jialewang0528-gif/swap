/* Fresh bank data from your own private cloud function (cloud/, see README "Auto-update").
   Needs app/private/cloud-config.js (gitignored): window.SwapCloudConfig = { url, token }.
   Without it this file does nothing.
   Runs after the bundled private/live.js and before data.js:
   1. If a newer copy was fetched before (localStorage), use it now, keeping the bundled logos.
   2. In the background, fetch fresh data. If it is newer than what's on screen, save it and
      reload once, unless a sheet is open or the chat has focus (then on the next return to the app).
   3. Fetch again whenever the app comes back to the front, at most every 5 minutes. */
(function () {
  const C = window.SwapCloudConfig;
  if (!C || !C.url || !C.token) return;
  const URL = C.url.replace(/\/$/, "") + "/api/live", KEY = "swapLiveCloud", TOKEN = C.token;
  const bundled = window.SwapLive || null;
  // Cloud data from older sync code can lack newer fields; never let it replace a fuller bundle.
  const complete = d => !!d && (!bundled || (Object.keys(bundled).every(k => k === "logos" || k in d)
    && (!bundled.bank || (d.bank && Object.keys(bundled.bank).every(k => k in d.bank)))));
  const newer = (a, b) => !!a && (!b || String(a.generatedAt || "") > String(b.generatedAt || ""));
  // What the screen shows, without the timestamp: only a real change (new charge, balance) reloads.
  const print = d => d ? JSON.stringify([d.weekStart, d.current, d.charges, d.bank && d.bank.items, d.bank && d.bank.balances, d.usual]) : "";
  const apply = d => Object.assign({}, d, { logos: Object.assign({}, bundled && bundled.logos, d.logos) });
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
  if (complete(cached) && newer(cached, bundled)) window.SwapLive = apply(cached);
  const shown = () => window.SwapLive;
  let last = 0, waiting = null;
  const busy = () => !!document.querySelector(".sheet") || (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName));
  function show(d) {
    if (busy()) { waiting = d; return; }
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    location.reload();
  }
  async function refresh() {
    if (Date.now() - last < 5 * 60e3) return;
    last = Date.now();
    try {
      const r = await fetch(URL, { headers: { Authorization: "Bearer " + TOKEN }, cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      if (!d || !d.generatedAt || !complete(d)) return;
      if (print(d) !== print(shown())) show(d);
      else { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
    } catch (e) {}
  }
  window.SwapCloud = { refresh: () => { last = 0; return refresh(); } };
  addEventListener("load", () => setTimeout(refresh, 400));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (waiting && !busy()) { const d = waiting; waiting = null; show(d); return; }
    refresh();
  });
})();
