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
  // Status for the screen: "checking" | "fresh" (new data, reloading) | "same" | "error", with times.
  const status = { state: "idle", at: null, bankCheckedAt: (shown() || {}).bankCheckedAt || null };
  const tell = (state, extra) => {
    Object.assign(status, { state, at: new Date().toISOString() }, extra || {});
    try { dispatchEvent(new CustomEvent("swap:cloud", { detail: status })); } catch (e) {}
  };
  // Bank items that weren't on screen before: kept across the reload so the app can say what's new.
  const newItems = d => {
    const had = new Set((((shown() || {}).bank || {}).items || []).map(i => i.id));
    return ((d.bank || {}).items || []).filter(i => !had.has(i.id)).map(i => ({ name: i.name, amount: i.amount, cat: i.cat }));
  };
  function show(d) {
    if (busy()) { waiting = d; return; }
    const fresh = newItems(d);
    try { localStorage.setItem(KEY, JSON.stringify(d)); if (fresh.length) localStorage.setItem("swapNew", JSON.stringify(fresh)); } catch (e) {}
    location.reload();
  }
  async function refresh() {
    if (Date.now() - last < 5 * 60e3) return;
    last = Date.now();
    tell("checking");
    try {
      const r = await fetch(URL, { headers: { Authorization: "Bearer " + TOKEN }, cache: "no-store" });
      if (!r.ok) { tell("error"); return; }
      const d = await r.json();
      if (!d || !d.generatedAt || !complete(d)) { tell("error"); return; }
      if (print(d) !== print(shown())) { tell("fresh", { bankCheckedAt: d.bankCheckedAt || null }); show(d); }
      else { tell("same", { bankCheckedAt: d.bankCheckedAt || null }); try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
    } catch (e) { tell("error"); }
  }
  window.SwapCloud = { refresh: () => { last = 0; return refresh(); }, status: () => status };
  addEventListener("load", () => setTimeout(refresh, 400));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (waiting && !busy()) { const d = waiting; waiting = null; show(d); return; }
    refresh();
  });
})();
