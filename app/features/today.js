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
    order: 0.2,

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
      // Refresh status: when Plaid last checked the bank, and what the app is doing right now.
      const when = iso => {
        if (!iso) return null;
        const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
        const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        return d.toDateString() === now.toDateString() ? `today ${t}` : d.toDateString() === y.toDateString() ? `yesterday ${t}` : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${t}`;
      };
      const syncText = st => {
        const bank = when((st && st.bankCheckedAt) || (window.SwapLive || {}).bankCheckedAt);
        const checked = bank ? `Bank checked ${bank}` : "Bank check time unknown";
        if (!window.SwapCloud) return checked;
        if (st && st.state === "checking") return "Checking for new charges";
        if (st && st.state === "same") return `Up to date. ${checked}`;
        if (st && st.state === "error") return `Can't reach your bank link. ${checked}`;
        return checked;
      };
      // Charges that arrived since the last time the app showed data (saved by cloud.js on reload).
      let fresh = [];
      try { fresh = JSON.parse(localStorage.getItem("swapNew") || "[]"); localStorage.removeItem("swapNew"); } catch (e) {}
      const amt = i => i.amount < 0 ? `+${money(-i.amount, 2)}` : money(i.amount, 2);

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
          <div class="td-sync t-foot"><span class="td-dot" aria-hidden="true"></span><span class="td-sync-t" role="status">${esc(syncText(window.SwapCloud && window.SwapCloud.status()))}</span>
            ${window.SwapCloud ? `<button class="btn plain small td-check">Check now</button>` : ""}</div>
          ${fresh.length ? `<div class="td-new"><b class="t-foot">New since last check</b>${fresh.slice(0, 4).map(i => `<div class="td-new-row t-sub"><span>${esc(name(i.name))}</span><span class="num${i.amount < 0 ? " td-in" : ""}">${amt(i)}</span></div>`).join("")}${fresh.length > 4 ? `<span class="t-foot t-3">and ${fresh.length - 4} more</span>` : ""}</div>` : ""}
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
          <button class="btn tint block td-open">Open this week</button>
          <p class="t-foot t-3 td-fine">${all ? `All money out of your bank, not investing. Budget: ${money(P.usual)} usual week − ${money(P.save)} save.` : "Food and getting around."} Plan follows your usual week.${synced ? ` Bank synced ${esc(synced)}.` : ""}</p>
        </div>`;

      slot.querySelector(".td-open").addEventListener("click", () => { haptic(); openWeek(); });

      // In depth: pace, today vs a usual day like it, each category vs usual, every day with its
      // charges, and the swaps that fit today.
      function openWeek() {
        const B = window.SwapLive && window.SwapLive.bank, A = B && B.analysis;
        const w = all && B ? B.dayWeights : null;
        const before = P.days.slice(0, P.today).reduce((t, d) => t + d.spent, 0);
        const wBefore = w ? w.slice(0, P.today).reduce((a, b) => a + b, 0) : P.today / 7;
        const pace = P.today > 0 && wBefore > 0 ? Math.round(before / wBefore) : null;
        const usualToday = w ? Math.round(P.usual * w[P.today]) : null;
        const daysLeft = 7 - P.today;
        // This week by category, next to a usual week for that category.
        const spentBy = {};
        P.charges.forEach(c => { if (c.amount > 0) spentBy[c.cat || "Other"] = (spentBy[c.cat || "Other"] || 0) + c.amount; });
        const usualBy = {};
        ((A && A.cats) || []).forEach(c => { usualBy[c.cat] = c.perWeek; });
        const cats = [...new Set([...Object.keys(spentBy), ...((A && A.cats) || []).slice(0, 6).map(c => c.cat)])]
          .filter(c => c !== "Investing")
          .map(c => ({ cat: c, spent: spentBy[c] || 0, usual: usualBy[c] || 0 }))
          .sort((a, b) => b.spent - a.spent || b.usual - a.usual);
        const inn = P.charges.filter(c => c.amount < 0).reduce((t, c) => t - c.amount, 0);
        const swaps = (api.swaps() || []).filter(x => !x.sub && (x.perWeek || 0) >= 0.5).sort((a, b) => b.save - a.save).slice(0, 3);
        const UNIT = { ride: "a ride", order: "an order", run: "a run", night: "a night", meal: "a meal", week: "a week", month: "a month" };
        const tone = c => /Eating out|Clubs|Bodega|Alcohol|Coffee|Delivery/.test(c) ? "food" : /Rides|Subway/.test(c) ? "move" : "other";
        const dayCharges = i => P.charges.filter(c => dayOfCharge(c) === i);

        api.sheet(body => {
          body.innerHTML = `
            <h2 class="t-title">This week</h2>
            <p class="t-foot t-3">${esc(P.days[0].short)} – ${esc(P.days[6].short)} · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left</p>
            <div class="card tw-sum">
              <div><span class="t-foot t-3">Spent</span><b class="num">${money(P.spent)}</b></div>
              <div><span class="t-foot t-3">Budget</span><b class="num">${money(P.cap)}</b></div>
              <div><span class="t-foot t-3">Left</span><b class="num ${P.left < 0 ? "tw-bad" : "tw-good"}">${money(P.left)}</b></div>
            </div>
            ${pace != null ? `<p class="t-sub tw-pace">At this pace: <b class="num ${pace > P.cap ? "tw-bad" : "tw-good"}">${money(pace)}</b> by Sunday, ${pace > P.cap ? `${money(pace - P.cap)} over` : `${money(P.cap - pace)} under`} budget.</p>` : ""}

            <h3 class="section-title">Today <small>${esc(T.dow)}, ${esc(T.short)}</small></h3>
            <div class="card tw-today">
              <div class="tw-row"><span>Left today</span><b class="num ${over ? "tw-bad" : "tw-good"}">${money(P.todayLeft)}</b></div>
              <div class="tw-row"><span>Spent</span><b class="num">${money(T.spent)} of ${money(T.plan)}</b></div>
              ${usualToday != null ? `<div class="tw-row"><span>Usual ${esc(T.dow)}</span><b class="num">${money(usualToday)}</b></div>` : ""}
              ${inn > 0 ? `<div class="tw-row"><span>Money in this week</span><b class="num tw-good">+${money(inn)}</b></div>` : ""}
            </div>

            <h3 class="section-title">By category <small>vs a usual week</small></h3>
            <div class="card tw-cats">${cats.map(c => `<div class="tw-cat">
                <span class="t-sub">${esc(c.cat)}</span>
                <span class="num t-foot ${c.usual && c.spent > c.usual ? "tw-bad" : "t-2"}">${money(c.spent)}${c.usual ? ` of ${money(c.usual)}` : ""}</span>
                <span class="tw-track" aria-hidden="true"><i class="${tone(c.cat)}${c.usual && c.spent > c.usual ? " over" : ""}" style="width:${c.usual ? Math.min(100, Math.round(c.spent / c.usual * 100)) : c.spent ? 100 : 0}%"></i></span>
              </div>`).join("")}</div>

            <h3 class="section-title">Every day</h3>
            <div class="card tw-days">${P.days.map(d => {
              const list = dayCharges(d.i);
              const head = `<span class="tw-dname">${esc(d.dow)}, ${esc(d.short)}${d.isToday ? " · today" : ""}</span>
                <span class="num t-foot ${d.spent > d.plan ? "tw-bad" : "t-2"}">${d.past || d.isToday ? `${money(d.spent)} of ${money(d.plan)}` : `Plan ${money(d.plan)}`}</span>`;
              return list.length ? `<details class="tw-day"${d.isToday ? " open" : ""}><summary>${head}</summary><div class="list">${list.map(c => `<div class="row">${mark(c)}
                  <span class="grow"><span class="t-sub td-tx">${esc(name(c.merchant))}</span><span class="t-foot t-3">${esc(c.cat || "")}${c.time ? ` · ${clock(c.time)}` : ""}${c.pending ? " · Pending" : ""}</span></span>
                  <span class="amt num">${c.amount < 0 ? `<span class="td-in">+${money(-c.amount, 2)}</span>` : money(c.amount, 2)}</span></div>`).join("")}</div></details>`
                : `<div class="tw-day tw-empty">${head}</div>`;
            }).join("")}</div>

            ${swaps.length ? `<h3 class="section-title">Swaps that fit today</h3>
            <div class="card tw-swaps"><div class="list">${swaps.map(x => `<div class="row"><span class="grow"><span class="t-sub td-tx">${esc(x.title)}</span><span class="t-foot t-3">${esc(x.detail || "")}</span></span>
              <span class="amt num">${money(x.save)}<span class="t-foot t-3"> ${esc((UNIT[x.unit] || "a " + x.unit).replace(/^an? /, "/"))}</span></span></div>`).join("")}</div></div>` : ""}
            <p class="t-foot t-3 tw-fine">${all ? "All money out of your bank, not investing. Usual = your last 10 weeks." : "Food and getting around."}${synced ? ` Bank synced ${esc(synced)}.` : ""}</p>`;
        }, { label: "This week in depth" });
      }

      const syncEl = slot.querySelector(".td-sync"), syncT = slot.querySelector(".td-sync-t");
      const onCloud = e => { if (!syncEl.isConnected) return; syncEl.dataset.state = e.detail.state; syncT.textContent = syncText(e.detail); };
      addEventListener("swap:cloud", onCloud);
      if (window.SwapCloud) syncEl.dataset.state = window.SwapCloud.status().state;
      const check = slot.querySelector(".td-check");
      check && check.addEventListener("click", () => { haptic(); window.SwapCloud.refresh(); });
      if (fresh.length) api.toast(`New: ${name(fresh[0].name)} ${amt(fresh[0])}${fresh.length > 1 ? `, ${fresh.length - 1} more` : ""}`, "check");

      const listEl = slot.querySelector(".td-list");
      slot.querySelectorAll(".td-day").forEach(b => b.addEventListener("click", () => {
        const i = +b.dataset.i;
        if (i === sel) return;
        haptic(); sel = i;
        slot.querySelectorAll(".td-day").forEach(x => x.setAttribute("aria-pressed", String(+x.dataset.i === sel)));
        listEl.innerHTML = dayList();
      }));
      return () => removeEventListener("swap:cloud", onCloud);
    }
  });
})();
