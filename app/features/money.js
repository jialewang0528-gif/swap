/* Where your money goes.
   Week tab, first. All money out of the bank over the last 10 full weeks (sync.py bank.analysis),
   ranked by category with a weekly average, then the places that took the most, then a link to the
   swaps that act on it. Founder's build only (needs window.SwapLive.bank.analysis). */
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
      const cats = A.cats.filter(c => c.cat !== "Investing" && c.perWeek >= 1);
      const top = cats.slice(0, 8), rest = cats.slice(8);
      const max = Math.max(1, ...top.map(c => c.perWeek));
      const note = c => c.cat === "Sent to friends" && friendsIn ? `Friends sent back ${money(friendsIn.perWeek)} a week`
        : c.cat === "Rides" ? "Night rides always OK" : `${c.count} charges`;
      const restSum = rest.reduce((t, c) => t + c.perWeek, 0);

      slot.innerHTML = `
        <h2 class="section-title">Where your money goes <small>${esc(fmt(A.from))} – ${esc(fmt(A.to))}</small></h2>
        <div class="card mo">
          <div class="mo-head">
            <div><span class="t-foot t-3">Out, a week</span><b class="num mo-big">${money(A.outPerWeek)}</b></div>
            <div class="mo-in"><span class="t-foot t-3">In, a week</span><b class="num">${money(A.inPerWeek)}</b></div>
          </div>
          <ol class="mo-list">${top.map((c, i) => `<li class="mo-cat">
              <span class="mo-rank num t-foot t-3" aria-hidden="true">${i + 1}</span>
              <span class="mo-name"><span class="t-sub">${esc(c.cat)}</span><span class="t-foot t-3">${esc(note(c))}</span></span>
              <span class="mo-track" aria-hidden="true"><i class="${tone(c.cat)}" style="width:${Math.max(3, c.perWeek / max * 100)}%"></i></span>
              <span class="mo-amt num">${money(c.perWeek)}<span class="t-foot t-3">/wk</span></span></li>`).join("")}</ol>
          ${rest.length ? `<p class="t-foot t-3 mo-rest">Everything else: ${money(restSum)} a week (${esc(rest.map(c => c.cat).join(", "))})</p>` : ""}
          <h3 class="t-foot mo-h">Biggest places</h3>
          <div class="list">${(A.places || []).slice(0, 5).map(p => `<div class="row">
              <span class="grow"><span class="t-sub mo-place">${esc(name(p.name))}</span><span class="t-foot t-3">${esc(p.cat)} · ${p.count} ${p.count === 1 ? "time" : "times"}</span></span>
              <span class="amt num">${money(p.total)}</span></div>`).join("")}</div>
          <button class="btn primary block mo-act">See swaps for these</button>
          <p class="t-foot t-3 mo-fine">All money out of your bank except investing, last ${A.weeks} full weeks.</p>
        </div>`;
      slot.querySelector(".mo-act").addEventListener("click", () => { haptic(); api.go("swaps"); });
    }
  });
})();
