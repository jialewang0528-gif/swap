/* Open a spending category and see every charge in it (founder's build: window.SwapLive.bank.history,
   the last 10 full weeks plus this week). Used by Where your money goes, Whole bank and This week:
     SwapCategory.open(api, "Personal care", { from: "2026-08-24", to: "2026-11-08", title: "Last 10 weeks" })
   Charges are newest first, grouped by day, money in with a +. */
(function () {
  const has = () => !!(window.SwapLive && window.SwapLive.bank && Array.isArray(window.SwapLive.bank.history));
  function open(api, cat, opts = {}) {
    if (!has()) return false;
    const { esc, money } = api;
    const name = n => typeof api.displayMerchant === "function" ? api.displayMerchant(n) : n;
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
          <div class="card cg-list"><div class="list">${list.filter(h => h.d === d).map(h => `<div class="row">
            <span class="grow"><span class="t-sub cg-name">${esc(name(h.name))}</span>${h.pending ? `<span class="t-foot t-3">Pending</span>` : ""}</span>
            <span class="amt num">${h.amount < 0 ? `<span class="cg-in">+${money(-h.amount, 2)}</span>` : money(h.amount, 2)}</span></div>`).join("")}</div></div>`).join("")}`;
    }, { label: cat });
    return true;
  }
  window.SwapCategory = { open, available: has };
})();
