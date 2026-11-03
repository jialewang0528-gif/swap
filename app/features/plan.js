/* Swaps to hit the goal.
   Swaps tab, under the deck: every swap available first, then the goal. Takes the weekly save target and works out the fewest swaps that
   reach it, from the student's own swaps (api.swaps(): each has a saving per time and how often
   they do that thing now, perWeek). Each swap is used at most half as often as they do it now
   (at least once if they do it most weeks), so the plan stays doable. Subscriptions are listed
   apart: cancel once, save every week. Below: every swap available, with its numbers.
   Shown only when the swaps carry perWeek (the founder's real swaps). */
(function () {
  const UNIT = { week: "a week", order: "an order", meal: "a meal", ride: "a ride", month: "a month", run: "a run", night: "a night" };
  const per = s => UNIT[s.unit] || "a " + s.unit;

  // Fewest swap actions to reach `target` a week. Biggest saving per action first.
  function planFor(swaps, target) {
    const pool = swaps.filter(s => !s.sub && s.perWeek >= 0.5 && s.save > 0)
      .map(s => ({ s, max: Math.max(1, Math.round(s.perWeek / 2)) }))
      .sort((a, b) => b.s.save - a.s.save);
    const picks = [];
    let left = target;
    for (const p of pool) {
      if (left <= 0) break;
      const n = Math.min(p.max, Math.ceil(left / p.s.save));
      picks.push({ s: p.s, n, total: n * p.s.save });
      left -= n * p.s.save;
    }
    // Still short: cancelling subscriptions, biggest first, each counted at its weekly share.
    const subs = swaps.filter(s => s.sub).sort((a, b) => b.save - a.save);
    const subPicks = [];
    for (const s of subs) {
      if (left <= 0) break;
      const wk = Math.round(s.save * 12 / 52);
      subPicks.push({ s, n: 1, total: wk });
      left -= wk;
    }
    return { picks, subPicks, count: picks.reduce((t, p) => t + p.n, 0) + subPicks.length, total: target - left, short: Math.max(0, left) };
  }

  Swap.feature({
    id: "plan",
    title: "Swaps to hit your goal",
    pitch: "How many swaps it takes to save your amount.",
    tab: "swaps",
    order: 2,

    render(slot, api) {
      const swaps = api.swaps();
      if (!swaps.some(s => typeof s.perWeek === "number")) return;
      const { esc, money, haptic } = api;
      const target = api.data.thisWeek.saveTarget || 0;
      const P = planFor(swaps, target);
      // A brand logo when there is one (MTA, Hulu, DoorDash), else the category's icon.
      const ICON = { "subway-day": "transit", bodega: "drinks", "bar-night": "drinks", coffee: "quick", pickup: "delivery", "counter-meal": "dining" };
      const mark = s => {
        const brand = /subway/i.test(s.title) ? "MTA" : s.title.replace(/^Cancel /, "").replace(/ →.*$/, "");
        if (api.logo(brand)) return api.brandMark(brand, s.kind, 28);
        if (ICON[s.id]) return api.kindIcon(ICON[s.id], { tile: true, size: 16 });
        return api.brandMark(brand, s.kind, 28);
      };
      const row = p => `<div class="row">${mark(p.s)}
          <span class="grow"><span class="t-sub pl-t">${p.n > 1 ? `<b class="num">${p.n} ×</b> ` : ""}${esc(p.s.title)}</span>
          <span class="t-foot t-3">${p.s.sub ? `${money(p.s.save)} a month` : `${money(p.s.save)} ${per(p.s)} · you do it ${p.s.perWeek} a week`}</span></span>
          <span class="amt num">${money(p.total)}<span class="t-foot t-3"> /wk</span></span></div>`;
      const all = swaps.filter(s => typeof s.perWeek === "number" || s.sub || s.id === "dashpass-student");

      slot.innerHTML = `
        <h2 class="section-title">All swaps <small>${all.length}</small></h2>
        <div class="card pl-all"><div class="list">${all.map(s => `<div class="row">${mark(s)}
            <span class="grow"><span class="t-sub pl-t">${esc(s.title)}</span><span class="t-foot t-3">${esc(String(s.basis || "").replace(/\s*→\s*/g, " vs "))}</span></span>
            <span class="amt num">${money(s.save)}<span class="t-foot t-3"> ${s.sub ? "/mo" : esc(per(s).replace(/^an? /, "/"))}</span></span></div>`).join("")}</div></div>
        <h2 class="section-title">Your goal <small>${money(target)} a week</small></h2>
        <div class="card pl">
          ${target > 0 ? `<div class="pl-head">
              <div><span class="t-foot t-3">Swaps a week</span><b class="num pl-big">${P.count}</b></div>
              <div class="pl-sum"><span class="t-foot t-3">Saves</span><b class="num">${money(P.total)}</b><span class="t-foot t-2">of ${money(target)}</span></div>
            </div>
            <div class="list">${P.picks.map(row).join("")}${P.subPicks.map(row).join("")}</div>
            ${P.short > 0 ? `<p class="t-foot pl-short">Still ${money(P.short)} short. Lower the goal or add swaps.</p>` : ""}`
            : `<p class="t-sub t-2">No weekly save set.</p>`}
          <button class="btn tint block pl-goal">Change goal</button>
          <p class="t-foot t-3 pl-fine">Each swap at most half as often as you do it now. Night rides are never counted.</p>
        </div>`;
      const g = slot.querySelector(".pl-goal");
      g && g.addEventListener("click", () => { haptic(); typeof api.openYou === "function" ? api.openYou("save") : api.go("week"); });
    }
  });
  window.SwapPlan = { planFor };
})();
