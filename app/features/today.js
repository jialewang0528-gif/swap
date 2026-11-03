/* Daily plan.
   Week tab, near the top. THIS week (Mon to today) from live data: the weekly budget (usual minus
   savings) split across the 7 days by the student's own weekday pattern, so Saturday gets more
   than Wednesday. Days gone keep their plan; what's left is spread over today and the days ahead
   (core's api.dailyPlan()). Shows what's left today, the week so far, and one bar per day.
   Tap a day to list what was spent that day (today is picked to start).
   Hidden when there is no current-week data (sample profiles, or a sync from an older week). */
(function () {
  Swap.feature({
    id: "today",
    title: "Daily plan",
    pitch: "What you can spend today to hit the week.",
    tab: "week",
    order: 0.5,

    render(slot, api) {
      if (typeof api.dailyPlan !== "function") return;
      const P = api.dailyPlan();
      if (!P) return;
      const { esc, money, haptic } = api;
      const T = P.days[P.today];
      const all = P.scope === "all";
      const dayOfCharge = c => all ? c.day : api.dayOf(c);
      const name = n => typeof api.displayMerchant === "function" ? api.displayMerchant(n) : n;
      const clock = tm => { const [h, m] = tm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
      const over = P.todayLeft < 0;
      const status = P.today === 0 ? "" : P.aheadBy >= 0 ? `${money(P.aheadBy)} under plan so far` : `${money(-P.aheadBy)} over plan so far`;
      const synced = P.syncedAt ? new Date(P.syncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
      const mark = c => {
        if (!/^zelle|^venmo/i.test(c.merchant) && api.logo(name(c.merchant))) return api.brandMark(name(c.merchant), c.kind || "food", 28);
        const ch = String(name(c.merchant)).replace(/^zelle (to|from) /i, "").trim().charAt(0).toUpperCase() || "$";
        return `<span class="td-mono ${c.amount < 0 ? "in" : ""}" aria-hidden="true">${esc(ch)}</span>`;
      };
      const fill = d => d.plan > 0 ? Math.min(100, Math.round(d.spent / d.plan * 100)) : d.spent > 0 ? 100 : 0;
      const label = d => `${d.dow} ${d.short}: plan ${money(d.plan)}${d.past || d.isToday ? `, spent ${money(d.spent)}` : ""}`;
      let sel = P.today;

      // What was spent on one day: every charge, money in with a +.
      function dayList() {
        const d = P.days[sel], list = P.charges.filter(c => dayOfCharge(c) === sel);
        const title = d.isToday ? "Today" : `${d.dow}, ${d.short}`;
        const sum = d.past || d.isToday ? `${money(d.spent)} of ${money(d.plan)}` : `Plan ${money(d.plan)}`;
        const empty = d.past || d.isToday ? (d.isToday ? "Nothing on your bank today yet." : "Nothing spent.") : "Not here yet.";
        return `<h3 class="t-foot td-h" id="td-day-h"><span>${esc(title)}</span><span class="num t-3">${esc(sum)}</span></h3>
          ${list.length ? `<div class="list">${list.map(c => `<div class="row">${mark(c)}
            <span class="grow"><span class="t-sub td-tx">${esc(name(c.merchant))}</span><span class="t-foot t-3">${esc(c.cat || "")}${c.time ? ` · ${clock(c.time)}` : ""}${c.pending ? " · Pending" : ""}</span></span>
            <span class="amt num">${c.amount < 0 ? `<span class="td-in">+${money(-c.amount, 2)}</span>` : money(c.amount, 2)}</span></div>`).join("")}</div>`
            : `<p class="t-foot t-3 td-none">${empty}</p>`}`;
      }

      slot.innerHTML = `
        <h2 class="section-title">Today <small>${esc(T.dow)}, ${esc(T.short)}</small></h2>
        <div class="card td">
          <div class="td-top">
            <div><span class="t-foot t-3">${over ? "Over today" : "Left today"}</span>
              <b class="num td-big ${over ? "over" : ""}">${money(Math.abs(P.todayLeft))}</b>
              <span class="t-foot t-2">Spent ${money(T.spent)} of ${money(T.plan)}</span></div>
            <div class="td-week"><span class="t-foot t-3">This week</span>
              <b class="num">${money(P.spent)} <span class="t-3">of ${money(P.cap)}</span></b>
              <span class="t-foot ${P.left < 0 ? "td-bad" : "t-2"}">${P.left < 0 ? `${money(-P.left)} over` : `${money(P.left)} left`}</span></div>
          </div>
          <div class="td-meter${over ? " over" : ""}" aria-hidden="true"><i style="width:${fill(T)}%"></i></div>
          <div class="td-strip" role="group" aria-label="Pick a day to see what you spent">
            ${P.days.map(d => `<button class="td-day${d.isToday ? " on" : ""}${d.past ? " past" : ""}${d.spent > d.plan ? " over" : ""}" data-i="${d.i}" aria-pressed="${d.i === sel}" aria-label="${esc(label(d))}">
              <span class="td-cap" aria-hidden="true"><i style="height:${d.past || d.isToday ? fill(d) : 0}%"></i></span>
              <b class="t-cap" aria-hidden="true">${esc(d.dow.slice(0, 3))}</b>
              <span class="td-amt num t-cap" aria-hidden="true">${money(d.past || d.isToday ? d.spent : d.plan)}</span></button>`).join("")}
          </div>
          <p class="td-legend t-foot t-3"><span aria-hidden="true">Each bar is that day's plan. Tap a day.</span>${status ? `<b class="td-status">${esc(status)}</b>` : ""}</p>
          <div class="td-list" aria-live="polite">${dayList()}</div>
          <p class="t-foot t-3 td-fine">${all ? `All money out of your bank, not investing. Budget: ${money(P.usual)} usual week − ${money(P.save)} save.` : "Food and getting around."} Plan follows your usual week.${synced ? ` Bank synced ${esc(synced)}.` : ""}</p>
        </div>`;

      const listEl = slot.querySelector(".td-list");
      slot.querySelectorAll(".td-day").forEach(b => b.addEventListener("click", () => {
        const i = +b.dataset.i;
        if (i === sel) return;
        haptic(); sel = i;
        slot.querySelectorAll(".td-day").forEach(x => x.setAttribute("aria-pressed", String(+x.dataset.i === sel)));
        listEl.innerHTML = dayList();
      }));
    }
  });
})();
