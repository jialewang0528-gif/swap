/* Fresh bank data from your own private cloud function (cloud/, see README "Auto-update").
   Needs app/private/cloud-config.js (gitignored): window.SwapCloudConfig = { url, token }.
   Without it this file does nothing.
   Runs after the bundled private/live.js and before data.js:
   1. If a newer copy was fetched before (localStorage), use it now, keeping the bundled logos.
   2. In the background, fetch fresh data. If it changes what the screen shows, save it and reload
      once, keeping the tab and scroll position (core restores them). While a sheet, the setup cover
      or a text field is in use, the data waits and is applied when the last sheet closes or the app
      comes back to the front.
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
  // What the screen shows, without the timestamp: a real change (new charge, balance, a new day or
  // week) reloads; the same data fetched again does not.
  const print = d => d ? JSON.stringify([d.today, d.weekStart, d.current, d.charges, d.bank && d.bank.items, d.bank && d.bank.balances, d.bank && d.bank.flex, d.usual]) : "";
  const apply = d => Object.assign({}, d, { logos: Object.assign({}, bundled && bundled.logos, d.logos) });
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
  if (complete(cached) && newer(cached, bundled)) window.SwapLive = apply(cached);
  const shown = () => window.SwapLive;
  let last = 0, waiting = null;
  const busy = () => !!document.querySelector(".sheet, .ob") || (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName));
  // Status for the screen: "checking" | "waiting" (new data, held while a sheet is open) | "fresh"
  // (reloading) | "same" | "error". bankCheckedAt is the time of the data ON SCREEN, so it only
  // moves on after a reload.
  const status = { state: "idle", at: null, bankCheckedAt: (shown() || {}).bankCheckedAt || null };
  const tell = (state, extra) => {
    Object.assign(status, { state, at: new Date().toISOString() }, extra || {});
    try { dispatchEvent(new CustomEvent("swap:cloud", { detail: status })); } catch (e) {}
  };
  // Bank items that weren't on screen before: kept across the reload so the app can say what's new.
  const newItems = d => {
    const had = new Set((((shown() || {}).bank || {}).items || []).map(i => i.id));
    return ((d.bank || {}).items || []).filter(i => !had.has(i.id)).map(i => ({ id: i.id, name: i.name, amount: i.amount, cat: i.cat }));
  };
  // Where he is: the open tab and its scroll, restored by core after the reload.
  function savePlace() {
    try {
      const api = window.Swap && window.Swap.api, tab = api ? api.current() : "week";
      const v = document.getElementById("view-" + tab);
      sessionStorage.setItem("swapPlace", JSON.stringify({ tab, top: v ? v.scrollTop : 0, at: Date.now() }));
    } catch (e) {}
  }
  function show(d) {
    if (busy()) { waiting = d; tell("waiting"); return; }
    // Reload only when the reloaded page will really use this data: it must be stored and newer than
    // the bundle. Never twice within 30 seconds (a loop when storage is full or blocked).
    let stored = false;
    try { localStorage.setItem(KEY, JSON.stringify(d)); stored = true; } catch (e) {}
    let recent = false;
    try { recent = Date.now() - (+sessionStorage.getItem("swapReloadAt") || 0) < 30e3; } catch (e) {}
    if (!stored || !newer(d, bundled) || recent) { tell("same"); return; }
    const fresh = newItems(d);
    try { if (fresh.length) localStorage.setItem("swapNew", JSON.stringify(fresh)); sessionStorage.setItem("swapReloadAt", String(Date.now())); } catch (e) {}
    tell("fresh");
    savePlace();
    location.reload();
  }
  const flush = () => { if (waiting && !busy()) { const d = waiting; waiting = null; show(d); } };
  async function refresh() {
    if (Date.now() - last < 5 * 60e3) return;
    last = Date.now();
    tell("checking");
    try {
      const r = await fetch(URL, { headers: { Authorization: "Bearer " + TOKEN }, cache: "no-store" });
      if (!r.ok) { tell("error"); return; }
      const d = await r.json();
      if (!d || !d.generatedAt || !complete(d)) { tell("error"); return; }
      if (print(d) !== print(shown())) show(d);
      else { tell("same"); try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
    } catch (e) { tell("error"); }
  }
  // Ask Plaid to check the bank now (POST to the cloud link), then poll for up to 3 minutes until
  // Plaid's "bank checked" time moves. At most once every 10 minutes from the button, once an hour
  // on its own (when the bank hasn't been checked for 4+ hours).
  const ASK = "swapBankAsk";
  const askedAt = () => { try { return +localStorage.getItem(ASK) || 0; } catch (e) { return 0; } };
  const checkedMs = d => d && d.bankCheckedAt ? new Date(d.bankCheckedAt).getTime() : 0;
  let asking = false;
  async function refreshBank(auto) {
    if (asking) return;
    if (Date.now() - askedAt() < (auto ? 60 : 10) * 60e3) { last = 0; return refresh(); }
    asking = true;
    const before = checkedMs(shown());
    try { localStorage.setItem(ASK, String(Date.now())); } catch (e) {}
    tell("asking");
    try {
      const r = await fetch(URL, { method: "POST", headers: { Authorization: "Bearer " + TOKEN }, cache: "no-store" });
      if (!r.ok) { asking = false; tell("error"); return; }
      for (let i = 0; i < 12; i++) {
        await new Promise(res => setTimeout(res, 15000));
        const g = await fetch(URL, { headers: { Authorization: "Bearer " + TOKEN }, cache: "no-store" });
        if (!g.ok) continue;
        const d = await g.json();
        if (!d || !d.generatedAt || !complete(d)) continue;
        if (checkedMs(d) > before) {
          asking = false; last = Date.now();
          if (print(d) !== print(shown())) show(d);
          else { tell("same", { bankCheckedAt: d.bankCheckedAt || null }); try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
          return;
        }
        tell("asking");
      }
      asking = false; tell("slow");
    } catch (e) { asking = false; tell("error"); }
  }
  window.SwapCloud = { refresh: () => { last = 0; return refresh(); }, refreshBank: () => refreshBank(false), status: () => status };
  addEventListener("load", () => setTimeout(() => {
    const old = Date.now() - checkedMs(shown()) > 4 * 3600e3;
    old ? refreshBank(true) : refresh();
  }, 400));
  // The last sheet closed (core) or the chat field lost focus: apply data that was waiting.
  addEventListener("swap:sheets-closed", () => setTimeout(flush, 300));
  document.addEventListener("focusout", () => setTimeout(flush, 300));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (waiting && !busy()) { flush(); return; }
    refresh();
  });
})();
