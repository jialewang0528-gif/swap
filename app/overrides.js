/* Your own categories for charges (works for anyone, stored on this phone only).
   The bank's categories are often wrong or vague ("Services" for a crypto deposit, a yearly app
   plan, a bodega). Every answer here is saved per merchant and applied to window.SwapLive.bank
   before the app reads it, and every total is worked out again from the charge history:
   Where your money goes, Whole bank, the usual week and the daily plan's budget.
     SwapOverrides.set("Coin Exchange", "Investing")   // not spending
     SwapOverrides.set("Photo App Pro", "Subscriptions")    // a bill: outside the daily plan
   Runs after cloud.js (which may swap in newer cloud data) and before data.js. */
(function () {
  const KEY = "swapCatOverrides", SKIP = "swapCatSkipped";
  const FIXED = new Set(["Subscriptions", "Phone & bills", "Rent", "Loan payments", "Bank fees"]);
  // The choices offered when the app asks, in the order shown.
  const CHOICES = ["Eating out", "Coffee & snacks", "Clubs & bars", "Bodega & liquor", "Delivery", "Groceries", "Rides",
    "Shopping", "Fun", "Personal care", "Health", "Travel", "Subscriptions", "Phone & bills", "Rent", "Sent to friends",
    "Services", "Investing"];
  // Vague bank categories worth asking about when the money is real.
  const VAGUE = new Set(["Services", "Other", "Venmo & other transfers", "Loan payments"]);
  // One answer = one merchant in one bank category ("Anthropic" token top-ups filed as Services
  // stay apart from the Anthropic plan filed as Subscriptions).
  const keyOf = (n, cat) => String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + "|" + String(cat || "");
  const read = k => { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch (e) { return {}; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  function apply() {
    const B = window.SwapLive && window.SwapLive.bank;
    const map = read(KEY);
    if (!B || !Array.isArray(B.history) || !Object.keys(map).length) return;
    const fix = it => {
      const was = it.bankCat || it.cat, cat = map[keyOf(it.name, was)];
      if (cat) { it.bankCat = was; it.cat = cat; it.fixed = FIXED.has(cat); it.mine = true; }
    };
    (B.items || []).forEach(fix);
    B.history.forEach(fix);
    // Recompute what the sync worked out, from the same 10 weeks of history.
    const A = B.analysis;
    if (!A || !A.from || !A.to) return;
    const weeks = A.weeks || 10, inWin = h => h.d >= A.from && h.d <= A.to;
    const cats = {}, places = {}, ins = {}, weekday = [0, 0, 0, 0, 0, 0, 0];
    let out = 0, inn = 0, flex = 0, fixed = 0;
    B.history.filter(inWin).forEach(h => {
      if (h.cat === "Investing") return;
      if (h.amount > 0) {
        const c = cats[h.cat] || (cats[h.cat] = { cat: h.cat, total: 0, count: 0, fixed: FIXED.has(h.cat) });
        c.total += h.amount; c.count++;
        const p = places[h.name] || (places[h.name] = { name: h.name, cat: h.cat, total: 0, count: 0 });
        p.total += h.amount; p.count++; p.cat = h.cat;
        out += h.amount;
        if (FIXED.has(h.cat)) fixed += h.amount;
        else { flex += h.amount; weekday[(new Date(h.d + "T12:00:00").getDay() + 6) % 7] += h.amount; }
      } else { inn -= h.amount; ins[h.cat] = (ins[h.cat] || 0) - h.amount; }
    });
    const old = {}; (A.cats || []).forEach(c => { old[c.cat] = c; });
    A.cats = Object.values(cats).map(c => Object.assign({}, old[c.cat] && old[c.cat].net != null ? { net: old[c.cat].net } : {},
      { cat: c.cat, perWeek: Math.round(c.total / weeks), total: Math.round(c.total), count: c.count, fixed: c.fixed })).sort((a, b) => b.total - a.total);
    A.places = Object.values(places).map(p => ({ name: p.name, cat: p.cat, total: Math.round(p.total), count: p.count })).sort((a, b) => b.total - a.total).slice(0, 15);
    A.ins = Object.entries(ins).map(([cat, v]) => ({ cat, perWeek: Math.round(v / weeks), total: Math.round(v) })).sort((a, b) => b.total - a.total);
    A.outPerWeek = Math.round(out / weeks); A.inPerWeek = Math.round(inn / weeks);
    B.usualOut = A.outPerWeek;
    const sum = weekday.reduce((a, b) => a + b, 0);
    B.flex = Object.assign({}, B.flex, { usual: Math.round(flex / weeks), fixedUsual: Math.round(fixed / weeks),
      dayWeights: sum ? weekday.map(x => Math.round(x / sum * 1e4) / 1e4) : (B.flex && B.flex.dayWeights) });
    B.overridden = Object.keys(map).length;
  }

  // Merchants worth asking about: a vague bank category, at least $50 in the last 10 weeks, not answered or skipped.
  function questions() {
    const B = window.SwapLive && window.SwapLive.bank;
    if (!B || !Array.isArray(B.history)) return [];
    const map = read(KEY), skipped = read(SKIP), by = {};
    // A merchant that already bills a subscription (a plan) plus one-off top-ups: the top-ups are
    // plain spending, nothing to ask.
    const billed = new Set(B.history.filter(h => h.cat === "Subscriptions").map(h => keyOf(h.name, "")));
    B.history.forEach(h => {
      if (h.amount <= 0 || !VAGUE.has(h.cat) || /^(zelle|venmo)\b/i.test(h.name) || billed.has(keyOf(h.name, ""))) return;
      const k = keyOf(h.name, h.cat);
      if (map[k] || skipped[k]) return;
      const q = by[k] || (by[k] = { name: h.name, cat: h.cat, total: 0, count: 0, last: h.d });
      q.total += h.amount; q.count++; if (h.d > q.last) q.last = h.d;
    });
    return Object.values(by).filter(q => q.total >= 50).sort((a, b) => b.total - a.total);
  }

  window.SwapOverrides = {
    CHOICES, FIXED, keyOf,
    get: (name, cat) => read(KEY)[keyOf(name, cat)] || null,
    all: () => read(KEY),
    // set(name, bankCat, newCat): newCat null puts the bank's category back.
    set(name, bankCat, cat) { const m = read(KEY), k = keyOf(name, bankCat); if (cat) m[k] = cat; else delete m[k]; write(KEY, m); },
    skip(name, bankCat) { const s = read(SKIP); s[keyOf(name, bankCat)] = 1; write(SKIP, s); },
    questions,
    // After a change: reload so every screen and total is worked out again from the new answers.
    reload() { try { sessionStorage.setItem("swapPlaceKeep", "1"); } catch (e) {} location.reload(); },
  };
  apply();
})();
