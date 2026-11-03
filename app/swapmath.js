/* Swap math and this week's picks: one rule for every screen (Swaps deck, Your goal, Today, Chat).
   Loaded after category.js, before the features.

   SwapMath.timesPerWeek(s): how often a swap counts in a week.
     s.timesPerWeek when the data gives it; a monthly cancel counts 12/52 of a month;
     a weekly swap counts once; else half as often as now: max(1, round(perWeek / 2)) for
     perWeek >= 1, every other week (0.5) for 0 < perWeek < 1 (or s.everyOtherWeek).
   SwapMath.weeklySave(s): save x timesPerWeek, whole dollars (rows always add up to the total).
   SwapMath.formula(s): "6 × $12 = $72 a week", "Every other week: $54 = $27 a week",
     "$109 a month = $25 a week", "$54 a night, once a week".
   SwapMath.planFor(swaps, target): fewest swap actions to reach target, biggest saving first.

   SwapPicks: this week's picked swaps. Store "deckPicks" = { week, ids, done: { id: n }, last, pick }.
     week = the current week's Monday (api.dailyPlan().weekStart, else data.current.weekStart).
     A new week starts empty; last week's ids stay in `last` for "Keep last week's swaps".
     The old plain-array format reads as last week's. "deckPick" stays = the first pick (older readers);
     a deckPick written elsewhere (Move-in) joins this week's picks.
   Night rides are never a swap, so nothing here ever targets one. */
(function () {
  const UNIT = { week: "a week", order: "an order", meal: "a meal", ride: "a ride", month: "a month", run: "a run", night: "a night" };
  const per = s => UNIT[s.unit] || (s.unit ? "a " + s.unit : "each time");
  const isMonthly = s => !!s && (!!s.sub || s.unit === "month");
  const usd = n => "$" + Math.round(n).toLocaleString("en-US");

  function timesPerWeek(s) {
    if (!s) return 0;
    if (isMonthly(s)) return 12 / 52;
    if (typeof s.timesPerWeek === "number" && s.timesPerWeek > 0) return s.timesPerWeek;
    if (s.everyOtherWeek) return 0.5;
    if (s.unit === "week") return 1;
    if (typeof s.perWeek === "number") {
      if (!(s.perWeek > 0)) return 0;
      return s.perWeek >= 1 ? Math.max(1, Math.round(s.perWeek / 2)) : 0.5;
    }
    return 1;
  }
  const weeklySave = s => s ? Math.round((s.save || 0) * timesPerWeek(s)) : 0;
  const everyOther = s => !isMonthly(s) && timesPerWeek(s) === 0.5;

  function formula(s) {
    if (!s) return "";
    const t = timesPerWeek(s), w = weeklySave(s);
    if (isMonthly(s)) return `${usd(s.save)} a month = ${usd(w)} a week`;
    if (s.unit === "week") return `${usd(w)} a week`;
    if (t === 0.5) return `Every other week: ${usd(s.save)} = ${usd(w)} a week`;
    if (t === 1) return `${usd(s.save)} ${per(s)}, once a week`;
    return `${Number.isInteger(t) ? t : t.toFixed(1)} × ${usd(s.save)} = ${usd(w)} a week`;
  }
  // Times this week, as a whole count for a tally ("2 of 6"). Every other week shows as 1.
  const target = s => isMonthly(s) ? 1 : Math.max(1, Math.ceil(timesPerWeek(s)));

  // Fewest swap actions to reach `target` a week, from swaps with a known frequency. Each counts at
  // most timesPerWeek, and never more often than he does it now. Still short: subscriptions.
  function planFor(swaps, goal) {
    const pool = (swaps || []).filter(s => !isMonthly(s) && s.save > 0 && typeof s.perWeek === "number" && timesPerWeek(s) > 0 && timesPerWeek(s) <= s.perWeek)
      .map(s => ({ s, max: timesPerWeek(s) }))
      .sort((a, b) => b.s.save - a.s.save);
    const picks = [];
    let left = goal || 0;
    for (const p of pool) {
      if (left <= 0) break;
      const n = p.max < 1 ? p.max : Math.min(p.max, Math.ceil(left / p.s.save));
      const total = Math.round(n * p.s.save);
      picks.push({ s: p.s, n, total, everyOtherWeek: n === 0.5 });
      left -= total;
    }
    const subPicks = [];
    (swaps || []).filter(s => s.sub).sort((a, b) => b.save - a.save).forEach(s => {
      if (left <= 0) return;
      const wk = weeklySave(s);
      subPicks.push({ s, n: 1, total: wk });
      left -= wk;
    });
    return { picks, subPicks, count: picks.reduce((t, p) => t + p.n, 0) + subPicks.length, total: (goal || 0) - left, short: Math.max(0, left) };
  }

  // A sample pickup swap whose place isn't in the student's own price gaps: use the gaps it has.
  function adapt(api, s) {
    if (!s || !/^pick ?up\s/i.test(s.title || "")) return s;
    const gaps = (api.data && api.data.priceGaps) || [], place = s.title.replace(/^pick ?up\s+/i, "").toLowerCase();
    if (!gaps.length || gaps.some(g => g.place.toLowerCase() === place)) return s;
    const avg = Math.round(gaps.reduce((t, g) => t + g.delivered - g.pickup, 0) / gaps.length);
    const top = gaps.slice().sort((a, b) => (b.delivered - b.pickup) - (a.delivered - a.pickup))[0];
    return Object.assign({}, s, { title: "Pick up instead of delivery", detail: "Same food. No delivery markup.", save: avg, unit: "order",
      basis: `${top.place}: delivered ${usd(top.delivered)} vs pickup ${usd(top.pickup)}` });
  }

  // One icon per swap, everywhere: a brand logo when there is one (MTA, Chipotle, Hulu), else the
  // category glyph. The lower-fare ride app never gets a logo. Decorative: a name always sits next to it.
  const GLYPH = { "subway-day": "transit", "subway-am": "transit", bodega: "drinks", "bar-night": "drinks", coffee: "quick", "coffee-home": "quick",
    pickup: "delivery", "counter-meal": "dining", "split-ride": "ride", "dashpass-student": "delivery" };
  function glyph(s) {
    if (GLYPH[s.id]) return GLYPH[s.id];
    const t = s.title || "";
    return /coffee|caf[eé]|snack/i.test(t) ? "quick" : /subway|train/i.test(t) ? "transit" : /\bbar|club|bodega|drink/i.test(t) ? "drinks"
      : /ride|uber|lyft/i.test(t) ? "ride" : /pick ?up|dashpass|order|deliver/i.test(t) ? "delivery" : s.kind === "move" ? "ride" : "dining";
  }
  function brand(api, s) {
    const rideApp = n => typeof api.isRideApp === "function" && api.isRideApp(n);
    if (s.sub) return String(s.title || "").replace(/^Cancel /, "");
    const text = `${s.title} ${s.detail || ""}`;
    if (rideApp(text)) return null;
    if (/subway|train/i.test(`${s.id} ${s.title}`)) return "MTA";
    if (api.logo(s.title)) return s.title;
    if (/\bride\b/i.test(s.title || "")) {
      const c = (api.charges() || []).find(x => x.kind === "ride" && !x.night && x.tag === "out" && !rideApp(x.merchant) && api.logo(x.merchant));
      return c ? c.merchant : null;
    }
    return null;
  }
  const mark = (api, s, size = 36) => {
    const b = brand(api, s);
    return api.brandMark(b && (s.sub || api.logo(b)) ? b : null, glyph(s), size);
  };

  window.SwapMath = { timesPerWeek, weeklySave, formula, target, everyOther, isMonthly, planFor, adapt, mark, glyph, per, UNIT };

  // ---------- this week's picks ----------
  const KEY = "deckPicks";
  function week(api) {
    let p = null;
    try { p = typeof api.dailyPlan === "function" ? api.dailyPlan() : null; } catch (e) {}
    const D = api.data || {};
    return (p && p.weekStart) || (D.current && D.current.weekStart) || (typeof api.weekKey === "function" ? api.weekKey() : D.weekStart) || null;
  }
  // Pure read: { week, ids, done, last }. Never writes.
  function state(api) {
    const store = api.store, v = store.get(KEY), one = store.get("deckPick") || null, cur = week(api);
    let o;
    if (Array.isArray(v)) {
      // Old format, no week: last week's picks (one tap keeps them).
      const ids = one && !v.includes(one) ? [one].concat(v) : v.slice();
      o = { week: "", ids, done: {}, last: null, pick: one };
    } else if (v && typeof v === "object") {
      o = { week: v.week || "", ids: Array.isArray(v.ids) ? v.ids.slice() : [], done: Object.assign({}, v.done), last: v.last || null, pick: v.pick === undefined ? one : v.pick };
    } else o = { week: cur, ids: [], done: {}, last: null, pick: null };
    let { ids, done, last } = o;
    if (o.week !== cur) {
      last = ids.length ? { week: o.week || null, ids } : (last && last.week !== cur ? last : null);
      ids = []; done = {};
    }
    // A single pick written somewhere else (Move-in) joins this week's picks, first.
    if (one && one !== o.pick && !ids.includes(one)) ids = [one].concat(ids);
    if (last && (!Array.isArray(last.ids) || !last.ids.length)) last = null;
    return { week: cur, ids, done, last };
  }
  function write(api, st) {
    const first = st.ids[0] || null;
    api.store.set(KEY, { week: st.week, ids: st.ids, done: st.done || {}, last: st.last || null, pick: first });
    if ((api.store.get("deckPick") || null) !== first) api.store.set("deckPick", first);
    return st;
  }
  // Resolve an id to the swap shown on screen (adapted), or Move-in's built swap.
  function resolve(api, id) {
    const s = (api.swaps() || []).find(x => x.id === id);
    if (s) return adapt(api, s);
    const info = api.store.get("deckPickInfo");
    return info && info.id === id ? Object.assign({ detail: "", basis: "" }, info) : null;
  }
  function list(api, ids) {
    const st = state(api);
    return (ids || st.ids).map(id => resolve(api, id)).filter(Boolean).map(s => ({
      id: s.id, swap: s, times: timesPerWeek(s), weekly: weeklySave(s), formula: formula(s),
      everyOtherWeek: everyOther(s), monthly: isMonthly(s), target: target(s), done: Math.max(0, +st.done[s.id] || 0)
    }));
  }
  const total = api => list(api).reduce((t, p) => t + p.weekly, 0);
  const has = (api, id) => state(api).ids.includes(id);
  function add(api, id) { const st = state(api); if (!st.ids.includes(id)) st.ids = st.ids.concat(id); return write(api, st); }
  function remove(api, id) { const st = state(api); st.ids = st.ids.filter(x => x !== id); delete st.done[id]; return write(api, st); }
  function set(api, ids) { const st = state(api); st.ids = ids.slice(); Object.keys(st.done).forEach(k => { if (!ids.includes(k)) delete st.done[k]; }); return write(api, st); }
  // done(api, id) adds one; done(api, id, n) sets the count. Returns the new count.
  function done(api, id, n) {
    const st = state(api);
    const v = n == null ? (+st.done[id] || 0) + 1 : Math.max(0, Math.round(n));
    st.done = Object.assign({}, st.done, { [id]: v });
    write(api, st);
    return v;
  }
  const lastList = api => { const st = state(api); return st.last ? list(api, st.last.ids) : []; };
  function keepLast(api) {
    const st = state(api);
    if (!st.last) return st;
    st.ids = st.ids.concat(st.last.ids.filter(id => !st.ids.includes(id) && resolve(api, id)));
    st.last = null;
    return write(api, st);
  }
  // Save the rollover (new week: empty picks, deckPick cleared) so older readers of "deckPick" agree.
  function sync(api) {
    const v = api.store.get(KEY), st = state(api);
    const same = v && !Array.isArray(v) && v.week === st.week && (v.pick || null) === (api.store.get("deckPick") || null);
    if (!same && (v || api.store.get("deckPick"))) write(api, st);
    return st;
  }
  window.SwapPicks = { week, state, list, total, has, add, remove, set, done, lastList, keepLast, sync };
})();
