/* Daily plan.
   Week tab, near the top. THIS week (Mon to today, by the phone's date) from live data: the weekly
   budget (api.budget: usual flexible week minus savings) split across the 7 days by the student's own
   weekday pattern, so Saturday gets more than Wednesday. Days gone keep their plan; what's left is
   spread over today and the days ahead, never below half a day's first plan (core's api.dailyPlan()).
   Shows what's left today, the week so far, bills once, one bar per day (height = plan, fill = spent),
   this week's picked swaps and the saving goal. Tap a day to list what was spent that day.
   Hidden when there is no current-week data (sample profiles). */
(function () {
  const SEL_KEY = "swapTodaySel";

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
      const S = typeof api.planStatus === "function" ? api.planStatus(P) : null;
      const dayOfCharge = c => all ? c.day : api.dayOf(c);
      const name = n => typeof api.displayMerchant === "function" ? api.displayMerchant(n) : n;
      const clock = tm => { const [h, m] = tm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
      const shortDate = iso => iso ? new Date(String(iso).length <= 10 ? iso + "T12:00" : iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
      const stale = !!P.staleSince;
      const staleLine = `Bank not checked since ${shortDate(P.staleSince)}`;
      const over = !stale && P.todayLeft < 0;
      const ON = 5;   // same tolerance as api.planStatus
      const isOver = d => !d.stale && (d.past || d.isToday) && d.spent > d.plan + ON;
      const fill = d => d.stale || !(d.past || d.isToday) ? 0 : d.plan > 0 ? Math.min(100, Math.round(d.spent / d.plan * 100)) : d.spent > 0 ? 100 : 0;
      const maxPlan = Math.max(1, ...P.days.map(d => d.plan));
      const barH = d => Math.max(24, Math.round(d.plan / maxPlan * 64));
      const label = d => `${d.dow} ${d.short}: plan ${money(d.plan)}${d.stale ? ", bank not checked" : d.past || d.isToday ? `, spent ${money(d.spent)}${isOver(d) ? `, ${money(Math.round(d.spent - d.plan))} over` : ""}` : ""}`;
      const allShown = P.charges.concat(P.fixedCharges || []);
      // The picked day survives a data reload (cloud.js) for a few minutes.
      let sel = P.today;
      try { const s = JSON.parse(sessionStorage.getItem(SEL_KEY) || "null"); const i = s && P.days.findIndex(d => d.date === s.date); if (i >= 0 && Date.now() - s.at < 10 * 60e3) sel = i; } catch (e) {}

      // Refresh status: when Plaid last checked the bank (one time on the card), and what the app is doing.
      const when = iso => {
        if (!iso) return null;
        const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
        const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        return d.toDateString() === now.toDateString() ? `today ${t}` : d.toDateString() === y.toDateString() ? `yesterday ${t}` : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${t}`;
      };
      const syncText = st => {
        const bank = when((st && st.bankCheckedAt) || (window.SwapLive || {}).bankCheckedAt);
        const checked = bank ? `Bank checked ${bank}` : "Bank check time unknown";
        if (!window.SwapCloud || !st) return checked;
        if (st.state === "checking") return "Checking for new charges";
        if (st.state === "asking") return "Asking your bank for new charges";
        if (st.state === "slow") return `Your bank hasn't answered yet. ${checked}`;
        if (st.state === "waiting") return "New charges. Close to update";
        if (st.state === "fresh") return "Updating";
        if (st.state === "same") return `No new charges. ${checked}`;
        if (st.state === "error") return `Can't reach your bank link. ${checked}`;
        return checked;
      };
      // Charges that arrived since the last time the app showed data (saved by cloud.js on reload).
      let fresh = [];
      try { fresh = JSON.parse(localStorage.getItem("swapNew") || "[]"); localStorage.removeItem("swapNew"); } catch (e) {}
      const amt = i => i.amount < 0 ? `+${money(-i.amount, 2)}` : money(i.amount, 2);
      // One row style for every transaction list (category.js txRow), so Today matches By day and Whole bank.
      const CAT = window.SwapCategory;
      const billNote = `<span class="t-3"> · Bill, not in plan</span>`;
      const chargeRow = c => CAT && typeof CAT.txRow === "function"
        ? CAT.txRow(api, { name: c.merchant, amount: c.amount, cat: c.cat, time: c.time, pending: c.pending, tone: c.kind ? api.kindOf(c) : undefined }, { cents: true, meta: c.fixed ? billNote : "" })
        : `<div class="row"><span class="grow"><span class="t-sub td-tx">${esc(name(c.merchant))}</span><span class="t-foot t-3">${esc(c.cat || "")}${c.time ? ` · ${clock(c.time)}` : ""}${c.pending ? " · Pending" : ""}${c.fixed ? " · Bill, not in plan" : ""}</span></span>
          <span class="amt num">${c.amount < 0 ? `<span class="td-in">+${money(-c.amount, 2)}</span>` : money(c.amount, 2)}</span></div>`;

      // What was spent on one day: every charge, money in with a +, bills marked.
      function dayList() {
        const d = P.days[sel], list = allShown.filter(c => dayOfCharge(c) === sel);
        const title = `${d.dow}, ${d.short}`;
        const sum = d.stale ? "" : d.isToday ? "" : d.past ? `${money(d.spent)} of ${money(d.plan)}` : `Plan ${money(d.plan)}`;
        const empty = d.stale ? `${staleLine}.` : d.isToday ? "Nothing posted yet. Card charges can take a day." : d.past ? "Nothing spent." : "Not here yet.";
        return `<h3 class="t-foot td-h" id="td-day-h"><span>${esc(title)}</span>${sum ? `<span class="num t-3">${esc(sum)}</span>` : ""}</h3>
          ${list.length ? `<div class="list td-txs">${list.map(chargeRow).join("")}</div>` : `<p class="t-foot t-3 td-none">${empty}</p>`}`;
      }

      // This week's picked swaps (app/swapmath.js, when present) and the saving goal.
      const SP = window.SwapPicks;
      const picks = () => { try { return SP && typeof SP.list === "function" ? (SP.list(api) || []).filter(p => p && p.swap) : []; } catch (e) { console.warn("[swap] picks", e); return []; } };
      const known = P.days.filter(d => d.past && !d.stale);
      const onPlanDays = known.filter(d => d.spent <= d.plan + ON).length;
      const keep = P.pace != null ? Math.max(0, Math.round(P.usual - P.pace)) : null;
      function goalHTML() {
        const list = picks();
        const rows = list.map(p => {
          const id = p.swap.id, times = Math.max(1, +p.times || 1), done = Math.max(0, +p.done || 0), full = done >= times;
          return `<div class="row td-pick"><span class="grow"><span class="t-sub td-tx">${esc(p.swap.title)}</span><span class="t-foot t-3 num">${done}/${times} this week</span></span>
            <button class="btn ${full ? "plain" : "tint"} small td-did" data-id="${esc(id)}"${full ? " disabled" : ""} aria-label="${esc(`${full ? "Done" : "Did it"}: ${p.swap.title}, ${done} of ${times}`)}">${full ? "Done" : "Did it"}</button></div>`;
        }).join("");
        const goal = P.save > 0 ? `<div class="td-goal-h"><span class="t-sub">Saving goal</span><b class="num t-sub">${money(P.save)} a week</b></div>
          ${keep != null ? `<div class="td-goal-bar" aria-hidden="true"><i style="width:${Math.min(100, Math.round(keep / P.save * 100))}%"></i></div>
            <span class="t-foot t-2">On pace to keep <b class="num">${money(keep)}</b></span>` : ""}
          ${known.length && !stale ? `<span class="t-foot t-2">${onPlanDays} of ${known.length} ${known.length === 1 ? "day" : "days"} on plan</span>` : ""}` : "";
        if (!rows && !goal) return "";
        return `${rows ? `<h3 class="t-foot td-h"><span>This week's swaps</span></h3><div class="list td-picks">${rows}</div>` : ""}${goal ? `<div class="td-goal">${goal}</div>` : ""}`;
      }

      const bills = P.flex ? `<div class="td-bills"><span class="t-foot t-2">Bills this week</span><b class="num t-sub">${money(Math.round(P.bills))}</b></div>` : "";
      const weekLine = P.left < 0 ? `<span class="t-foot td-bad">Over budget by ${money(Math.round(-P.left))} this week</span>` : `<span class="t-foot t-2">${money(Math.round(P.left))} left</span>`;
      const status = S && P.today > 0 && !S.first ? S.text : "";
      // Why "Left today" moved since the last time he looked (saved when the app goes to the
      // background): new charges, a budget change, or both. Shown until the number settles.
      const SNAP = "swapTodaySnap", leftNow = Math.round(P.todayLeft);
      let why = "";
      try {
        const snap = JSON.parse(localStorage.getItem(SNAP) || "null");
        if (snap && snap.date === T.date && !stale && Math.abs(leftNow - snap.left) >= 1) {
          const seen = new Set(snap.ids || []);
          const fresh2 = P.charges.filter(c => c.amount > 0 && !seen.has(c.id));
          const newSum = Math.round(fresh2.reduce((t, c) => t + c.amount, 0));
          const budgetMove = Math.round(P.cap - snap.budget);
          const parts = [];
          if (newSum) parts.push(`${fresh2.length === 1 ? esc(name(fresh2[0].merchant || fresh2[0].name)) : `${fresh2.length} new charges`} ${money(newSum)}`);
          if (budgetMove) parts.push(`budget ${budgetMove > 0 ? "up" : "down"} ${money(Math.abs(budgetMove))}`);
          if (!parts.length) parts.push("plan rebalanced");
          const when = new Date(snap.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
          why = `${leftNow < snap.left ? "Down" : "Up"} ${money(Math.abs(leftNow - snap.left))} since ${when}: ${parts.join(", ")}`;
        }
        const save = () => { try { localStorage.setItem(SNAP, JSON.stringify({ date: T.date, left: leftNow, budget: P.cap, ids: P.charges.map(c => c.id), at: Date.now() })); } catch (e) {} };
        if (!snap || snap.date !== T.date) save();
        // Re-arm when he leaves the app, so the next look compares against what he last saw.
        const onHide = () => { if (document.visibilityState === "hidden") save(); };
        document.addEventListener("visibilitychange", onHide);
        addEventListener("pagehide", save);
        slot._todaySnapOff = () => { document.removeEventListener("visibilitychange", onHide); removeEventListener("pagehide", save); };
      } catch (e) {}

      slot.innerHTML = `
        <h2 class="section-title">Today <small>${esc(T.dow)}, ${esc(T.short)}</small></h2>
        <div class="card td">
          <div class="td-sync t-foot"><span class="td-dot" aria-hidden="true"></span><span class="td-sync-t" role="status">${esc(syncText(window.SwapCloud && window.SwapCloud.status()))}</span>
            ${window.SwapCloud ? `<button class="btn plain small td-check">Check bank</button>` : ""}</div>
          ${fresh.length ? `<div class="td-new"><b class="t-foot">New since last check</b>${fresh.slice(0, 4).map(i => `<div class="td-new-row t-sub"><span>${esc(name(i.name))}</span><span class="num${i.amount < 0 ? " td-in" : ""}">${amt(i)}</span></div>`).join("")}${fresh.length > 4 ? `<span class="t-foot t-3">and ${fresh.length - 4} more</span>` : ""}</div>` : ""}
          <div class="td-top">
            <div class="td-today"><span class="t-foot t-3">${stale ? "Today's plan" : over ? "Over today" : "Left today"}</span>
              <b class="num td-big ${over ? "over" : ""}">${money(Math.round(stale ? T.plan : Math.abs(P.todayLeft)))}</b>
              <span class="t-foot ${stale ? "td-bad" : "t-2"}">${stale ? esc(staleLine) : `Spent ${money(Math.round(T.spent))} of ${money(T.plan)}`}</span>
              ${why ? `<span class="t-foot td-why">${why}</span>` : ""}
              ${stale ? "" : `<div class="td-meter${over ? " over" : ""}" aria-hidden="true"><i style="width:${fill(T)}%"></i></div>`}</div>
            <div class="td-week"><span class="t-foot t-3">This week</span>
              <b class="num">${money(Math.round(P.spent))} <span class="t-3">of ${money(P.cap)}</span></b>
              ${weekLine}</div>
          </div>
          ${bills}
          <div class="td-strip" role="group" aria-label="Pick a day to see what you spent">
            ${P.days.map(d => `<button class="td-day${d.isToday ? " on" : ""}${d.past ? " past" : ""}${d.stale ? " stale" : ""}${isOver(d) ? " over" : ""}" data-i="${d.i}" aria-pressed="${d.i === sel}" aria-label="${esc(label(d))}">
              <span class="td-bar" aria-hidden="true"><span class="td-cap" style="height:${barH(d)}px"><i style="height:${fill(d)}%"></i></span></span>
              <b class="t-cap" aria-hidden="true"><span class="td-dow">${esc(d.dow.slice(0, 3))}</span><span class="td-dow1">${esc(d.dow.slice(0, 1))}</span></b>
              <span class="td-amt num t-cap" aria-hidden="true">${d.stale ? "–" : money(Math.round(d.past || d.isToday ? d.spent : d.plan))}</span>
              ${isOver(d) ? `<span class="td-plus num t-cap" aria-hidden="true">+${money(Math.round(d.spent - d.plan))}</span>` : ""}</button>`).join("")}
          </div>
          <p class="td-legend t-foot t-3"><span>Fill = spent, outline = plan. Tap a day.</span>${status && !stale ? `<b class="td-status td-${S.state}">${esc(status)}</b>` : ""}</p>
          <div class="td-list" aria-live="polite">${dayList()}</div>
          <div class="td-goals">${goalHTML()}</div>
          <button class="btn tint block td-open">Open this week</button>
          <p class="t-foot t-3 td-fine">${all ? `Budget: ${esc(api.capLine(P.save))}.${P.flex ? " Bills not in the daily plan." : " All money out, not investing."}` : "Budget: food and getting around."}</p>
        </div>`;

      slot.querySelector(".td-open").addEventListener("click", () => { haptic(); openWeek(); });

      // In depth: status and pace, today vs a usual day like it, each category vs usual, every day
      // with its charges, and the biggest swaps.
      function openWeek() {
        const B = window.SwapLive && window.SwapLive.bank, A = B && B.analysis;
        const w = all && B ? ((B.flex && B.flex.dayWeights) || B.dayWeights) : null;
        const usualToday = w ? Math.round(P.usual * w[P.today]) : null;
        const daysLeft = 7 - P.today;
        // This week by category (flexible spending), next to a usual week for that category.
        const spentBy = {};
        P.charges.forEach(c => { if (c.amount > 0) spentBy[c.cat || "Other"] = (spentBy[c.cat || "Other"] || 0) + c.amount; });
        const usualBy = {}, countBy = {};
        ((A && A.cats) || []).forEach(c => { usualBy[c.cat] = c.perWeek; countBy[c.cat] = c.count; });
        const fixedCats = new Set(((B && B.flex && B.flex.fixedCats) || []));
        const cats = [...new Set([...Object.keys(spentBy), ...((A && A.cats) || []).filter(c => !fixedCats.has(c.cat)).slice(0, 6).map(c => c.cat)])]
          .filter(c => c !== "Investing")
          .map(c => ({ cat: c, spent: spentBy[c] || 0, usual: usualBy[c] || 0, oneOff: countBy[c] != null && countBy[c] <= 2 }))
          .sort((a, b) => b.spent - a.spent || b.usual - a.usual);
        const high = c => c.usual && c.spent > c.usual && !c.oneOff;
        const inn = P.charges.concat(P.fixedCharges || []).filter(c => c.amount < 0).reduce((t, c) => t - c.amount, 0);
        const swaps = (api.swaps() || []).filter(x => !x.sub && (x.perWeek || 0) >= 0.5).sort((a, b) => b.save - a.save).slice(0, 3);
        const UNIT = { ride: "a ride", order: "an order", run: "a run", night: "a night", meal: "a meal", week: "a week", month: "a month" };
        const tone = c => /Eating out|Clubs|Bodega|Alcohol|Coffee|Delivery/.test(c) ? "food" : /Rides|Subway/.test(c) ? "move" : "other";
        const dayCharges = i => allShown.filter(c => dayOfCharge(c) === i);
        const tenWeeks = A && A.weeks === 10 && (P.flex || (B && B.usualOut === A.outPerWeek));

        api.sheet(body => {
          body.innerHTML = `
            <h2 class="t-title">This week</h2>
            <p class="t-foot t-3">${esc(P.days[0].short)} – ${esc(P.days[6].short)} · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left</p>
            <div class="card tw-sum">
              <div><span class="t-foot t-3">Spent</span><b class="num">${money(Math.round(P.spent))}</b></div>
              <div><span class="t-foot t-3">Budget</span><b class="num">${money(P.cap)}</b></div>
              <div><span class="t-foot t-3">${P.left < 0 ? "Over" : "Left"}</span><b class="num ${P.left < 0 ? "tw-bad" : "tw-good"}">${money(Math.round(Math.abs(P.left)))}</b></div>
            </div>
            ${stale ? `<p class="t-sub tw-pace">${esc(staleLine)}.</p>` : status ? `<p class="t-sub tw-pace"><b class="td-${S.state}">${esc(status)}</b></p>` : ""}
            ${P.pace != null && !stale ? `<p class="t-sub tw-pace">Sunday at this pace <b class="num">${money(P.pace)}</b> · Budget <b class="num">${money(P.cap)}</b></p>` : ""}

            <div class="card tw-today">
              ${usualToday != null ? `<div class="tw-row"><span>Usual ${esc(T.dow)}</span><b class="num">${money(usualToday)}</b></div>` : ""}
              <div class="tw-row"><span>Plan today</span><b class="num">${money(T.plan)}</b></div>
              ${P.flex ? `<div class="tw-row"><span>Bills this week</span><b class="num">${money(Math.round(P.bills))}</b></div>` : ""}
              ${inn > 0 ? `<div class="tw-row"><span>Money in this week</span><b class="num tw-good">+${money(Math.round(inn))}</b></div>` : ""}
            </div>

            <h3 class="section-title">By category <small>vs a usual week</small></h3>
            <div class="card tw-cats">${cats.map(c => `<div class="tw-cat tap-row" data-cat="${esc(c.cat)}" role="button" tabindex="0" aria-label="${esc(c.cat)}: ${money(c.spent)} this week${c.usual ? `, usual ${money(c.usual)}` : ""}${c.oneOff ? ", one-off" : ""}. Show charges">
                <span class="t-sub">${esc(c.cat)}${c.oneOff ? ` <span class="t-foot t-3">one-off</span>` : ""}</span>
                <span class="num t-foot ${high(c) ? "tw-bad" : "t-2"}">${money(c.spent)}${c.usual ? ` of ${money(c.usual)}` : ""}</span>
                <span class="tw-track" aria-hidden="true"><i class="${tone(c.cat)}${high(c) ? " over" : ""}" style="width:${c.usual ? Math.min(100, Math.round(c.spent / c.usual * 100)) : c.spent ? 100 : 0}%"></i></span>
              </div>`).join("")}</div>

            <h3 class="section-title">Every day</h3>
            <div class="card tw-days">${P.days.map(d => {
              const list = dayCharges(d.i);
              const head = `<span class="tw-dname">${esc(d.dow)}, ${esc(d.short)}${d.isToday ? " · today" : ""}</span>
                <span class="num t-foot ${isOver(d) ? "tw-bad" : "t-2"}">${d.stale ? "Bank not checked" : d.past || d.isToday ? `${money(Math.round(d.spent))} of ${money(d.plan)}${isOver(d) ? ` · +${money(Math.round(d.spent - d.plan))}` : ""}` : `Plan ${money(d.plan)}`}</span>`;
              return list.length ? `<details class="tw-day"${d.isToday ? " open" : ""}><summary>${head}</summary><div class="list td-txs">${list.map(chargeRow).join("")}</div></details>`
                : `<div class="tw-day tw-empty">${head}</div>`;
            }).join("")}</div>

            ${swaps.length ? `<h3 class="section-title">Biggest swaps</h3>
            <div class="card tw-swaps"><div class="list">${swaps.map(x => `<div class="row"><span class="grow"><span class="t-sub td-tx">${esc(x.title)}</span><span class="t-foot t-3">${esc(x.detail || "")}</span></span>
              <span class="amt num">${money(x.save)}<span class="t-foot t-3"> ${esc((UNIT[x.unit] || "a " + x.unit).replace(/^an? /, "/"))}</span></span></div>`).join("")}</div></div>` : ""}
            <p class="t-foot t-3 tw-fine">${all ? `${P.flex ? "Bills and subscriptions are not in the daily plan." : "All money out of your bank, not investing."}${tenWeeks ? " Usual = your last 10 weeks." : ""}` : "Food and getting around."}</p>`;
          body.querySelectorAll("[data-cat]").forEach(r => {
            const go = () => { haptic(); window.SwapCategory && window.SwapCategory.open(api, r.dataset.cat, { from: P.days[0].date, to: P.days[6].date, title: "This week" }); };
            r.addEventListener("click", go);
            r.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
          });
        }, { label: "This week in depth" });
      }

      const syncEl = slot.querySelector(".td-sync"), syncT = slot.querySelector(".td-sync-t");
      const onCloud = e => { if (!syncEl.isConnected) return; syncEl.dataset.state = e.detail.state; syncT.textContent = syncText(e.detail); };
      addEventListener("swap:cloud", onCloud);
      if (window.SwapCloud) syncEl.dataset.state = window.SwapCloud.status().state;
      const check = slot.querySelector(".td-check");
      check && check.addEventListener("click", () => { haptic(); (window.SwapCloud.refreshBank || window.SwapCloud.refresh)(); });
      if (fresh.length) api.toast(`New: ${name(fresh[0].name)} ${amt(fresh[0])}${fresh.length > 1 ? `, ${fresh.length - 1} more` : ""}`, "check");

      // The iPhone app: these bank items are on screen now (no notification for them), and the save target.
      if (api.data.live && typeof api.nativePost === "function") {
        const ids = [...new Set(allShown.map(c => c.id).concat(fresh.map(i => i.id)).filter(Boolean))];
        if (ids.length) api.nativePost({ type: "seen", ids });
        api.nativePost({ type: "plan", saveTarget: P.save });
      }

      const goalsEl = slot.querySelector(".td-goals");
      goalsEl.addEventListener("click", e => {
        const b = e.target.closest(".td-did");
        if (!b || b.disabled || !SP || typeof SP.done !== "function") return;
        haptic("success");
        try { SP.done(api, b.dataset.id); } catch (err) { console.warn("[swap] picks", err); }
        goalsEl.innerHTML = goalHTML();
        const again = goalsEl.querySelector(`.td-did[data-id="${CSS.escape(b.dataset.id)}"]`);
        again && again.focus({ preventScroll: true });
      });

      const listEl = slot.querySelector(".td-list");
      slot.querySelectorAll(".td-day").forEach(b => b.addEventListener("click", () => {
        const i = +b.dataset.i;
        if (i === sel) return;
        haptic(); sel = i;
        try { sessionStorage.setItem(SEL_KEY, JSON.stringify({ date: P.days[i].date, at: Date.now() })); } catch (e) {}
        slot.querySelectorAll(".td-day").forEach(x => x.setAttribute("aria-pressed", String(+x.dataset.i === sel)));
        listEl.innerHTML = dayList();
      }));
      return () => { removeEventListener("swap:cloud", onCloud); slot._todaySnapOff && slot._todaySnapOff(); };
    }
  });
})();
