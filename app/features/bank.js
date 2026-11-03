/* Whole bank.
   Week tab, under By day. Private build only ("You" with window.SwapLive.bank from sync.py):
   every dollar in and out of the linked bank, not just food and getting around. Money out and in
   by category for last week or this week so far, the checking balance, and a sheet with every
   transaction by day. Card payments and moves between his own accounts are left out (counted once). */
(function () {
  const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const FOOD = new Set(["Eating out", "Clubs & bars", "Bodega & liquor", "Coffee & snacks", "Delivery"]);
  const MOVE = new Set(["Rides", "Subway"]);
  const toneOf = cat => FOOD.has(cat) ? "food" : MOVE.has(cat) ? "move" : "other";

  Swap.feature({
    id: "bank",
    title: "Whole bank",
    pitch: "Every dollar in and out.",
    tab: "week",
    order: 2.5,

    render(slot, api) {
      const B = window.SwapLive && window.SwapLive.bank;
      if (api.profile() !== "you" || !B || !Array.isArray(B.items)) return;
      const { el, esc, money, store, haptic } = api;
      const D = api.data;
      let which = store.get("bankWeek") === "now" ? "now" : "last";

      const start = w => { const d = new Date(D.weekStart + "T12:00:00"); if (w === "now") d.setDate(d.getDate() + 7); return d; };
      const dateOf = (w, day) => { const d = start(w); d.setDate(d.getDate() + day); return d; };
      const short = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const label = w => w === "last" ? `${short(dateOf("last", 0))} – ${short(dateOf("last", 6))}` : `Since ${short(dateOf("now", 0))}`;
      const clock = tm => { const [h, m] = tm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
      const name = n => typeof api.displayMerchant === "function" ? api.displayMerchant(n) : n;
      const items = w => B.items.filter(i => i.week === w);
      const checking = (B.balances || []).find(b => b.type === "depository");

      function totals(list) {
        const out = {}, inn = {};
        let o = 0, n = 0;
        list.forEach(i => {
          if (i.amount > 0) { out[i.cat] = (out[i.cat] || 0) + i.amount; o += i.amount; }
          else { inn[i.cat] = (inn[i.cat] || 0) - i.amount; n -= i.amount; }
        });
        const sort = m => Object.entries(m).map(([cat, v]) => ({ cat, v })).sort((a, b) => b.v - a.v);
        return { out: sort(out), inn: sort(inn), o, n };
      }

      function mark(i) {
        if (!/^zelle|^venmo/i.test(i.name) && api.logo(i.name)) return api.brandMark(i.name, i.swap ? (MOVE.has(i.cat) ? "move" : "food") : "food", 32);
        const ch = String(name(i.name)).replace(/^zelle (to|from) /i, "").trim().charAt(0).toUpperCase() || "$";
        return `<span class="bk-mono ${i.amount < 0 ? "in" : ""}" aria-hidden="true">${esc(ch)}</span>`;
      }
      const amt = i => i.amount < 0 ? `<span class="bk-in">+${money(-i.amount, 2)}</span>` : money(i.amount, 2);

      function draw() {
        const list = items(which), T = totals(list), max = Math.max(1, ...T.out.map(r => r.v));
        const swapOut = T.out.filter(r => toneOf(r.cat) !== "other").reduce((t, r) => t + r.v, 0);
        const row = (r, sign) => `<div class="bk-cat" role="listitem">
            <span class="bk-name t-sub">${esc(r.cat)}</span>
            ${sign > 0 ? `<span class="bk-track" aria-hidden="true"><i class="${toneOf(r.cat)}" style="width:${Math.max(2, r.v / max * 100)}%"></i></span>` : ""}
            <span class="bk-amt num">${sign > 0 ? money(r.v) : `<span class="bk-in">+${money(r.v)}</span>`}</span></div>`;
        slot.innerHTML = `
          <h2 class="section-title">Whole bank <small>${esc(label(which))}</small></h2>
          <div class="card bk">
            <div class="seg bk-seg" role="radiogroup" aria-label="Which week">
              <button role="radio" aria-checked="${which === "last"}" data-w="last">Last week</button>
              <button role="radio" aria-checked="${which === "now"}" data-w="now">This week</button>
            </div>
            <div class="bk-stats">
              <div><span class="t-foot t-3">Out</span><b class="num">${money(T.o)}</b></div>
              <div><span class="t-foot t-3">In</span><b class="num">${money(T.n)}</b></div>
              ${checking && checking.current != null ? `<div><span class="t-foot t-3">Checking</span><b class="num">${money(checking.current)}</b></div>` : ""}
            </div>
            ${T.o ? `<p class="t-foot t-3 bk-note">Food and getting around: ${money(swapOut)} of ${money(T.o)}</p>` : ""}
            ${T.out.length ? `<h3 class="t-foot bk-h">Money out</h3><div class="bk-list" role="list">${T.out.map(r => row(r, 1)).join("")}</div>` : `<p class="t-sub t-3 bk-empty">Nothing out yet.</p>`}
            ${T.inn.length ? `<h3 class="t-foot bk-h">Money in</h3><div class="bk-list" role="list">${T.inn.map(r => row(r, -1)).join("")}</div>` : ""}
            ${list.length ? `<button class="btn tint block bk-all">All ${list.length} transactions</button>` : ""}
            <p class="t-foot t-3 bk-fine">Card payments and moves between your own accounts are left out.</p>
          </div>`;
        slot.querySelectorAll(".bk-seg button").forEach(b => b.addEventListener("click", () => {
          if (b.dataset.w === which) return;
          haptic(); which = b.dataset.w; store.set("bankWeek", which); draw();
          const f = slot.querySelector(`.bk-seg [data-w="${which}"]`); f && f.focus();
        }));
        const all = slot.querySelector(".bk-all");
        all && all.addEventListener("click", () => { haptic(); openAll(); });
      }

      function openAll() {
        const list = items(which);
        api.sheet(body => {
          const days = [...new Set(list.map(i => i.day))].sort((a, b) => a - b);
          body.innerHTML = `<h2 class="t-title bk-sheet-title">${which === "last" ? "Last week" : "This week"}</h2>
            <p class="t-foot t-3">${esc(label(which))} · ${list.length} transactions</p>
            ${days.map(d => {
              const rows = list.filter(i => i.day === d);
              const out = rows.filter(i => i.amount > 0).reduce((t, i) => t + i.amount, 0);
              return `<h3 class="section-title bk-day">${DAY_LONG[d]}, ${esc(short(dateOf(which, d)))} <small class="num">${money(out)} out</small></h3>
                <div class="card bk-day-card"><div class="list">${rows.map(i => `<div class="row">${mark(i)}
                  <span class="grow"><span class="t-sub bk-tx">${esc(name(i.name))}</span><span class="t-foot t-3">${esc(i.cat)}${i.time ? ` · ${clock(i.time)}` : ""}${i.pending ? " · Pending" : ""}</span></span>
                  <span class="amt num">${amt(i)}</span></div>`).join("")}</div></div>`;
            }).join("")}`;
        }, { label: "All transactions" });
      }

      draw();
    }
  });
})();
