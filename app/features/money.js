/* Where your money goes.
   Week tab, first. All money out of the bank over the last 10 full weeks (sync.py bank.analysis),
   ranked by category with a weekly average (Sent to friends by its net after friends paid back), the
   places that took the most behind one row, then a link to the swaps that act on it. Founder's build only (needs window.SwapLive.bank.analysis). */
(function () {
  const FOOD = new Set(["Eating out", "Clubs & bars", "Bodega & liquor", "Coffee & snacks", "Delivery"]);
  const MOVE = new Set(["Rides", "Subway"]);
  const tone = c => FOOD.has(c) ? "food" : MOVE.has(c) ? "move" : "other";

  Swap.feature({
    id: "money",
    title: "Where your money goes",
    pitch: "What you spend the most on, last 10 weeks.",
    tab: "week",
    order: 0.4,

    render(slot, api) {
      const B = api.profile() === "you" && window.SwapLive && window.SwapLive.bank;
      const A = B && B.analysis;
      if (!A || !Array.isArray(A.cats) || !A.cats.length) return;
      const { esc, money, haptic } = api;
      const name = n => typeof api.displayMerchant === "function" ? api.displayMerchant(n) : n;
      const fmt = s => new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const friendsIn = (A.ins || []).find(x => x.cat === "From friends");
      // Sent to friends ranks by what is left after friends paid back (sync.py friendsNet when present).
      const sentNet = c => {
        const fn = A.friendsNet;
        if (typeof fn === "number") return fn;
        if (fn && typeof fn.perWeek === "number") return fn.perWeek;
        if (typeof c.net === "number") return c.net;
        return friendsIn ? c.perWeek - friendsIn.perWeek : null;
      };
      const all = A.cats.filter(c => c.cat !== "Investing" && c.perWeek >= 1).map(c => c.cat === "Sent to friends" && sentNet(c) != null
        ? Object.assign({}, c, { gross: c.perWeek, perWeek: Math.max(0, Math.round(sentNet(c))), isNet: true }) : c)
        .sort((a, b) => b.perWeek - a.perWeek);
      // Top 8, plus any category a swap acts on, so the biggest swap is never hidden in "Everything else".
      const swapCats = new Set((window.SwapLive.swapOptions || []).map(o => o.cat).filter(Boolean));
      const top = all.filter((c, i) => i < 8 || swapCats.has(c.cat)), rest = all.filter(c => !top.includes(c) && c.perWeek >= 1);
      const max = Math.max(1, ...top.map(c => c.perWeek));
      const foodWk = A.cats.filter(c => FOOD.has(c.cat)).reduce((t, c) => t + c.perWeek, 0);
      const note = c => c.isNet ? `Sent ${money(c.gross)}, got back ${money(c.gross - c.perWeek)}`
        : c.cat === "Rides" ? `${c.count} rides` : `${c.count} charges`;
      const amtText = c => `${c.isNet ? "net " : ""}${money(c.perWeek)}`;
      const restSum = rest.reduce((t, c) => t + c.perWeek, 0);
      const places = (A.places || []).slice(0, 5);

      slot.innerHTML = `
        <h2 class="section-title">Where your money goes <small>${esc(fmt(A.from))} – ${esc(fmt(A.to))}</small></h2>
        <div class="card mo">
          <div class="mo-head">
            <div><span class="t-foot t-3">Out, a week</span><b class="num mo-big">${money(A.outPerWeek)}</b></div>
            <div class="mo-in"><span class="t-foot t-3">In, a week</span><b class="num">+${money(A.inPerWeek)}</b></div>
          </div>
          ${foodWk ? `<p class="t-foot t-2 mo-food">Food and drinks: <b class="num">${money(foodWk)}</b> a week</p>` : ""}
          <ol class="mo-list">${top.map((c, i) => `<li class="mo-cat tap-row" data-cat="${esc(c.cat)}" role="button" tabindex="0" aria-label="${esc(c.cat)}, ${c.isNet ? "net " : ""}${money(c.perWeek)} a week, ${esc(note(c))}. Show charges">
              <span class="mo-rank num t-foot t-3" aria-hidden="true">${i + 1}</span>
              <span class="mo-name"><span class="t-sub">${esc(c.cat)}</span><span class="t-foot t-3">${esc(note(c))}</span></span>
              <span class="mo-track" aria-hidden="true"><i class="${tone(c.cat)}" style="width:${Math.max(3, c.perWeek / max * 100)}%"></i></span>
              <span class="mo-amt num">${amtText(c)}<span class="t-foot t-3">/wk</span></span></li>`).join("")}</ol>
          ${rest.length ? `<p class="t-foot t-3 mo-rest">Everything else: ${money(restSum)} a week (${esc(rest.map(c => c.isNet ? `${c.cat} (net)` : c.cat).join(", "))})</p>` : ""}
          ${places.length ? `<details class="bk-more mo-more"><summary class="t-sub">Biggest places <span class="t-foot t-3">${places.length}</span>${api.icon("chevronDown", 16, 2.4)}</summary>
            <div class="bk-more-body"><div class="list">${places.map(p => `<div class="row">
              <span class="grow"><span class="t-sub mo-place">${esc(name(p.name))}</span><span class="t-foot t-3">${esc(p.cat)} · ${p.count} ${p.count === 1 ? "time" : "times"}</span></span>
              <span class="amt num">${money(p.total)}</span></div>`).join("")}</div></div></details>` : ""}
          <button class="btn primary block mo-act">See swaps for these</button>
          <p class="t-foot t-3 mo-fine">All money out of your bank except investing, last ${A.weeks} full weeks. Night rides are never a swap. Tap a category to see its charges.</p>
        </div>`;
      // Tap (or Enter / Space) a category row to see every charge in it.
      const openable = (root, range) => root.querySelectorAll("[data-cat]").forEach(r => {
        const go = () => { haptic(); window.SwapCategory && window.SwapCategory.open(api, r.dataset.cat, range); };
        r.addEventListener("click", go);
        r.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      });
      openable(slot, { from: A.from, to: A.to, title: `${fmt(A.from)} – ${fmt(A.to)}` });
      slot.querySelector(".mo-act").addEventListener("click", () => { haptic(); api.go("swaps"); });
    }
  });
})();
