/* Open a spending category and see every charge in it (founder's build: window.SwapLive.bank.history,
   the last 10 full weeks plus this week). Used by Where your money goes, Whole bank and This week:
     SwapCategory.open(api, "Personal care", { from: "2026-08-24", to: "2026-11-08", title: "Last 10 weeks" })
   Charges are newest first, grouped by day, money in with a +.

   Also the one transaction row used by By day, Whole bank and this sheet (styles: .tx-* in features/bank.css):
     SwapCategory.txRow(api, { name, amount, cat, time, pending, tone }, { cents, tag, meta, aria })
   32px mark, title-cased name, "Category · time · Pending" under it, amount right, money in with a +. */
(function () {
  const has = () => !!(window.SwapLive && window.SwapLive.bank && Array.isArray(window.SwapLive.bank.history));
  // Bank category names, one list for every screen.
  const FOOD = new Set(["Eating out", "Clubs & bars", "Bodega & liquor", "Coffee & snacks", "Delivery"]);
  const MOVE = new Set(["Rides", "Subway"]);
  const toneOf = cat => FOOD.has(cat) ? "food" : MOVE.has(cat) ? "move" : "other";
  // A charge kind (data.js) to its bank category. "drinks" covers two bank categories.
  const KIND_CAT = { dining: "Eating out", drinks: "Clubs & bars, bodega & liquor", quick: "Coffee & snacks", delivery: "Delivery", ride: "Rides", transit: "Subway" };

  const rideApp = (api, n) => typeof api.isRideApp === "function" ? api.isRideApp(n) : /lower-fare/i.test(String(n || ""));
  // Bank names, cleaned for reading: the private build's display name, then title case when the bank sent all lowercase.
  function txName(api, n) {
    let s = String(typeof api.displayMerchant === "function" ? api.displayMerchant(n) : n || "").trim();
    if (s && s === s.toLowerCase()) s = s.replace(/(^|[\s.'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
    return s.replace(/\bNyu\b/g, "NYU").replace(/\bMta\b/g, "MTA");
  }
  const clock = tm => { const [h, m] = String(tm).split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  // One 32px mark: the merchant's logo, else a letter tile tinted by food / move / night, else a neutral letter tile.
  function txMark(api, t) {
    const n = txName(api, t.name), inn = t.amount < 0, transfer = /^(zelle|venmo)\b/i.test(n);
    const tone = t.tone || toneOf(t.cat);
    if (rideApp(api, t.name)) return api.brandMark(null, tone === "night" ? "night" : "move", 32);
    if (!transfer && api.logo(t.name)) return api.brandMark(t.name, tone === "other" ? "food" : tone, 32);
    if (!inn && tone !== "other") return api.brandMark(t.name, tone, 32);
    const ch = n.replace(/^(zelle|venmo)\s+(to|from)\s+/i, "").trim().charAt(0).toUpperCase() || "$";
    return `<span class="tx-mono${inn ? " in" : ""}" aria-hidden="true">${api.esc(ch)}</span>`;
  }
  function txRow(api, t, o = {}) {
    const { esc, money } = api, inn = t.amount < 0, d = o.cents ? 2 : 0;
    const meta = [t.cat ? esc(t.cat) : "", t.time ? `<span class="num">${clock(t.time)}</span>` : "", t.pending ? "Pending" : ""].filter(Boolean).join(" · ");
    const tag = o.tag || "div";
    return `<${tag} class="tx-row${o.cls ? " " + o.cls : ""}"${o.attrs ? " " + o.attrs : ""}>${txMark(api, t)}
      <span class="tx-main"><b class="t-sub tx-name">${o.prefix ? `<span class="vh">${esc(o.prefix)}: </span>` : ""}${esc(txName(api, t.name))}</b>${meta || o.meta ? `<span class="tx-meta t-foot">${meta ? `<span class="t-3">${meta}</span>` : ""}${o.meta || ""}</span>` : ""}</span>
      <span class="tx-amt num${inn ? " in" : ""}">${inn ? "+" + money(-t.amount, d) : money(t.amount, d)}</span></${tag}>`;
  }

  function open(api, cat, opts = {}) {
    if (!has()) return false;
    const { esc, money } = api;
    const from = opts.from || "0000", to = opts.to || "9999";
    const list = window.SwapLive.bank.history.filter(h => h.cat === cat && h.d >= from && h.d <= to);
    const out = list.filter(h => h.amount > 0).reduce((t, h) => t + h.amount, 0);
    const back = list.filter(h => h.amount < 0).reduce((t, h) => t - h.amount, 0);
    const day = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const days = [...new Set(list.map(h => h.d))];
    api.sheet(body => {
      body.innerHTML = `
        <h2 class="t-title">${esc(cat)}</h2>
        <p class="t-foot t-3">${esc(opts.title || "")}${opts.title ? " · " : ""}${list.length} ${list.length === 1 ? "charge" : "charges"}</p>
        <div class="card cg-sum">
          ${out ? `<div><span class="t-foot t-3">Spent</span><b class="num">${money(out, 2)}</b></div>` : ""}
          ${back ? `<div><span class="t-foot t-3">In</span><b class="num cg-in">+${money(back, 2)}</b></div>` : ""}
          ${!out && !back ? `<p class="t-sub t-3">Nothing here in this period.</p>` : ""}
        </div>
        ${days.map(d => `<h3 class="section-title cg-day">${esc(day(d))}</h3>
          <div class="card cg-list"><div class="list">${list.filter(h => h.d === d).map(h =>
            txRow(api, { name: h.name, amount: h.amount, pending: h.pending, time: h.time, tone: toneOf(cat) },
              { cents: true, cls: "tap-row tx-fix", attrs: `role="button" tabindex="0" data-name="${esc(h.name)}" data-bank="${esc(h.bankCat || h.cat)}" aria-label="${esc(txName(api, h.name))}, ${money(Math.abs(h.amount), 2)}. Change category"` })).join("")}</div></div>`).join("")}
        ${window.SwapOverrides ? `<p class="t-foot t-3 cg-hint">Wrong category? Tap a charge to change it.</p>` : ""}`;
      body.querySelectorAll(".tx-fix").forEach(r => {
        const go = () => recategorize(api, r.dataset.name, r.dataset.bank, { current: cat });
        r.addEventListener("click", go);
        r.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      });
    }, { label: cat });
    return true;
  }
  // Pick a category for every charge from one merchant. Saved on this phone (SwapOverrides), then
  // the app reloads so every total is worked out again.
  const PICK_NOTE = { Investing: "Not spending: money you still have", Subscriptions: "A bill: kept out of the daily plan",
    "Phone & bills": "A bill: kept out of the daily plan", Rent: "A bill: kept out of the daily plan", "Sent to friends": "Money to a person" };
  // bankCat = the category the bank gave these charges; opts.current = what they show as now.
  function recategorize(api, name, bankCat, opts = {}) {
    const O = window.SwapOverrides;
    if (!O) return;
    const { esc, haptic } = api;
    const mine = O.get(name, bankCat), current = opts.current || bankCat;
    api.sheet((body, close) => {
      body.innerHTML = `<h2 class="t-title">${esc(opts.title || txName(api, name))}</h2>
        <p class="t-sub t-2">${esc(opts.lede || `Moves every ${txName(api, name)} charge your bank filed as ${bankCat}.`)}</p>
        <div class="card cg-pick" role="radiogroup" aria-label="Category">${O.CHOICES.map(c => `<button class="cg-opt" role="radio" aria-checked="${c === (mine || current)}" data-cat="${esc(c)}">
          <span class="t-sub">${esc(c === "Investing" ? "Investing (not spending)" : c)}</span>${PICK_NOTE[c] ? `<span class="t-foot t-3">${esc(PICK_NOTE[c])}</span>` : ""}</button>`).join("")}</div>
        ${mine ? `<button class="btn plain block cg-reset">Use the bank's category</button>` : ""}`;
      body.querySelectorAll(".cg-opt").forEach(b => b.addEventListener("click", () => {
        haptic("success"); O.set(name, bankCat, b.dataset.cat); close(); api.toast(`${txName(api, name)}: ${b.dataset.cat}`, "check"); setTimeout(() => O.reload(), 350);
      }));
      const reset = body.querySelector(".cg-reset");
      reset && reset.addEventListener("click", () => { haptic(); O.set(name, bankCat, null); close(); setTimeout(() => O.reload(), 350); });
    }, { label: `Category for ${txName(api, name)}` });
  }
  window.SwapCategory = { open, recategorize, available: has, txRow, txMark, txName, toneOf, KIND_CAT, FOOD, MOVE };
})();
