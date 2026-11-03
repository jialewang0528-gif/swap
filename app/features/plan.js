/* All swaps, then Your goal. Swaps tab, under the deck.
   All swaps: every swap with its numbers. Each weekly swap has an Add toggle (same picks as the
   deck, window.SwapPicks). Subscriptions are listed apart (cancel once, save every week), under one
   "Cancelled any subscriptions?" row that opens the checklist. That checklist and the Wallet's
   swipe-left "Cancelled" write the same list (store "cancelledSubs").
   Your goal: starts from this week's picks ("Picked $X of $100", the same total the deck shows),
   then, when short, the fewest more swaps to close the gap (window.SwapMath.planFor).
   How often a swap counts comes from SwapMath.timesPerWeek, so every number here matches the deck.
   Shown only when the swaps carry perWeek (the founder's real swaps). */
(function () {
  Swap.feature({
    id: "plan",
    title: "Swaps to hit your goal",
    pitch: "How many swaps it takes to save your amount.",
    tab: "swaps",
    order: 2,

    render(slot, api) {
      // swapmath.js comes before the features in index.html. If a build doesn't have it yet, load it
      // and render once it arrives, instead of failing.
      if (!window.SwapMath || !window.SwapPicks) {
        const self = this;
        let off = false, inner = null;
        let s = document.querySelector("script[data-swapmath]");
        if (!s) { s = document.createElement("script"); s.src = "swapmath.js"; s.dataset.swapmath = "1"; document.head.appendChild(s); }
        const go = () => { if (!off && window.SwapPicks && !inner) inner = self.render(slot, api) || null; };
        s.addEventListener("load", go);
        return () => { off = true; s.removeEventListener("load", go); if (typeof inner === "function") inner(); };
      }
      const { esc, money, haptic, store } = api;
      const SM = window.SwapMath, SP = window.SwapPicks;
      let alive = true;
      const gone = () => new Set(store.get("cancelledSubs") || []);
      const subName = s => s.title.replace(/^Cancel /, "");
      const privSubs = () => ((window.SwapPrivate || {}).subscriptions || []).filter(x => x.active);
      // "/ride" on screen, "a ride" for screen readers.
      const unit = (vis, said) => `<span class="t-foot t-3" aria-hidden="true">${vis}</span><span class="vh"> ${said}</span>`;
      const wk = n => `<span class="num">${money(n)}</span>${unit("/wk", "a week")}`;
      const mark = s => SM.mark(api, s, 32);

      function draw() {
        if (!alive) return;
        // Keep focus on the same control across a redraw (data-k), when it is still there.
        const a = document.activeElement, key = a && slot.contains(a) && a.dataset ? a.dataset.k : null;
        slot.replaceChildren();
        const out = gone();
        const swaps = api.swaps().filter(s => !s.sub || !out.has(subName(s))).map(s => SM.adapt(api, s));
        if (!swaps.some(s => typeof s.perWeek === "number")) return;
        const target = api.data.thisWeek.saveTarget || 0;
        const picks = SP.list(api), pickedIds = picks.map(p => p.id);
        const picked = picks.reduce((t, p) => t + p.weekly, 0);
        const P = SM.planFor(swaps.filter(s => !pickedIds.includes(s.id)), Math.max(0, target - picked));
        const all = swaps.filter(s => typeof s.perWeek === "number" || s.sub || s.id === "dashpass-student");
        const weekly = all.filter(s => !s.sub), subs = all.filter(s => s.sub);
        const hasSubs = subs.length || out.size || privSubs().length;

        const swapRow = s => {
          const on = pickedIds.includes(s.id), u = SM.per(s);
          return `<li class="row pl-row">${mark(s)}
            <span class="grow"><span class="t-sub pl-t">${esc(s.title)}</span>
              <span class="t-foot t-3">${esc(String(s.basis || "").replace(/\s*→\s*/g, " vs "))}</span>
              <span class="t-foot t-2">${esc(SM.formula(s))}</span>
              ${s.when ? `<span class="t-foot t-3">${esc(s.when)}</span>` : ""}</span>
            <span class="pl-side"><span class="amt"><span class="num">${money(s.save)}</span>${unit(esc(u.replace(/^an? /, "/")), esc(u))}</span>
              <button class="btn small ${on ? "secondary" : "tint"} pl-add" data-id="${esc(s.id)}" data-k="add:${esc(s.id)}" aria-pressed="${on}" aria-label="Add ${esc(s.title)} to this week">${on ? "Added" : "Add"}</button></span></li>`;
        };
        const subRow = s => `<li class="row pl-row">${mark(s)}
            <span class="grow"><span class="t-sub pl-t">${esc(s.title)}</span><span class="t-foot t-3">about ${money(SM.weeklySave(s))} a week</span></span>
            <span class="amt"><span class="num">${money(s.save)}</span>${unit("/mo", "a month")}</span></li>`;
        const goalRow = p => `<li class="row pl-row">${mark(p.s)}
            <span class="grow"><span class="t-sub pl-t">${p.everyOtherWeek ? "" : p.n > 1 ? `<b class="num">${p.n} ×</b> ` : ""}${esc(p.s.title)}</span>
              <span class="t-foot t-3">${esc(p.s.sub ? `${money(p.s.save)} a month` : p.everyOtherWeek ? `Every other week · ${money(p.s.save)} ${SM.per(p.s)}` : `${money(p.s.save)} ${SM.per(p.s)} · you do it ${p.s.perWeek} a week`)}</span></span>
            <span class="amt">${wk(p.total)}</span></li>`;
        const marked = [...out];
        const adds = P.picks.filter(p => !p.s.sub);

        slot.innerHTML = `
          <h2 class="section-title">All swaps <small>${all.length}</small></h2>
          <div class="card pl-all">
            <ul class="list" role="list">${weekly.map(swapRow).join("")}</ul>
            ${hasSubs ? `<button class="pl-ask-btn" data-k="ask">
                <span class="grow"><span class="t-sub pl-t">Cancelled any subscriptions?</span>
                  <span class="t-foot t-3">${marked.length ? `Marked: ${esc(marked.join(", "))}` : "Check the ones you already cancelled"}</span></span>
                ${api.icon("chevronDown", 16, 2.2)}</button>` : ""}
            ${subs.length ? `<ul class="list pl-subs" role="list" aria-label="Subscriptions">${subs.map(subRow).join("")}</ul>` : ""}
          </div>
          <h2 class="section-title">Your goal <small>${money(target)} a week</small></h2>
          <div class="card pl">
            ${target > 0 ? `<div class="pl-head">
                <div><span class="t-foot t-3">Picked</span><b class="num pl-big">${money(picked)}</b><span class="t-foot t-2">${picks.length} ${picks.length === 1 ? "swap" : "swaps"} this week</span></div>
                <div class="pl-sum"><span class="t-foot t-3">Goal</span><b class="num">${money(target)}</b><span class="t-foot t-2">a week</span></div>
              </div>
              ${picked >= target ? `<p class="t-sub pl-met">Goal met.</p>`
                : `<h3 class="t-headline pl-gap-h">${picks.length ? "To close the gap" : `To reach ${money(target)}`} <span class="t-foot t-2">${money(target - picked)} a week</span></h3>
                <ul class="list" role="list">${P.picks.map(goalRow).join("")}${P.subPicks.map(goalRow).join("")}</ul>
                ${adds.length ? `<button class="btn tint block pl-addall" data-k="addall">Add ${adds.length === 1 ? "this" : "these"} to this week</button>` : ""}
                ${P.short > 0 ? `<p class="t-foot pl-short">Still ${money(P.short)} short. Lower the goal or add swaps.</p>` : ""}`}`
              : `<p class="t-sub t-2">No weekly save set.</p>`}
            <button class="btn tint block pl-goal" data-k="goal">Change goal</button>
            <p class="t-foot t-3 pl-fine">Each swap counts about half as often as you do it now, or every other week. Night rides never count.</p>
          </div>`;

        slot.querySelectorAll(".pl-add").forEach(b => b.addEventListener("click", () => {
          const id = b.dataset.id, s = all.find(x => x.id === id), on = SP.has(api, id);
          haptic(on ? undefined : "success");
          on ? SP.remove(api, id) : SP.add(api, id);
          draw(); refocus(`add:${id}`);
          api.toast(on ? `Removed: ${s.title}` : `Added: ${s.title}`);
        }));
        const addall = slot.querySelector(".pl-addall");
        addall && addall.addEventListener("click", () => {
          haptic("success");
          adds.forEach(p => SP.add(api, p.s.id));
          draw(); refocus("goal");
          api.toast(`Added ${adds.length} ${adds.length === 1 ? "swap" : "swaps"}`, "check", { action: { label: "Undo", onClick: () => { adds.forEach(p => SP.remove(api, p.s.id)); draw(); } } });
        });
        const ask = slot.querySelector(".pl-ask-btn");
        ask && ask.addEventListener("click", () => { haptic(); askCancelled(); });
        const g = slot.querySelector(".pl-goal");
        g && g.addEventListener("click", () => { haptic(); typeof api.openYou === "function" ? api.openYou("save") : api.go("week"); });
        if (key) refocus(key);
      }
      const refocus = key => { const n = slot.querySelector(`[data-k="${CSS.escape(key)}"]`); n && n.focus({ preventScroll: true }); };

      // Which subscriptions are already cancelled: the bank can't tell (Apple bills to the end of the
      // period). Opened only from the "Cancelled any subscriptions?" row, never on its own.
      function askCancelled() {
        const subs = privSubs();
        if (!subs.length) return;
        const before = [...gone()];
        api.sheet((body, close) => {
          body.innerHTML = `<h2 class="t-title">Cancelled any of these?</h2>
            <p class="t-sub t-2">Your bank shows a subscription until its last bill. Check the ones you already cancelled.</p>
            <div class="card pl-ask"><ul class="list" role="list">${subs.map(x => {
              const month = x.freq === "yearly" ? x.amount / 12 : x.amount;
              return `<li class="row"><label class="pl-ask-row">
                <span class="grow"><span class="t-sub">${esc(x.name)}</span><span class="t-foot t-3">${money(month, 2)} a month${x.freq === "yearly" ? ` · ${money(x.amount, 2)} a year` : ""}</span></span>
                <input type="checkbox" class="pl-ask-box" value="${esc(x.name)}"${before.includes(x.name) ? " checked" : ""}></label></li>`;
            }).join("")}</ul></div>`;
          api.sheetActions(body, [{ label: "Save", onClick: () => {
            const names = [...body.querySelectorAll(".pl-ask-box:checked")].map(b => b.value);
            store.set("cancelledSubs", names); store.set("askedCancelled", true);
            close(); refocus("ask");
            api.toast(names.length ? `${names.length} marked cancelled` : "None marked cancelled", "check",
              { action: { label: "Undo", onClick: () => { store.set("cancelledSubs", before); refocus("ask"); } } });
          } }]);
        }, { label: "Cancelled subscriptions" });
      }

      draw();
      const offs = [store.on("deckPicks", draw), store.on("cancelledSubs", draw)];
      const onFacts = () => draw();
      document.addEventListener("swap:facts", onFacts);
      return () => { alive = false; offs.forEach(f => f && f()); document.removeEventListener("swap:facts", onFacts); };
    }
  });
  window.SwapPlan = { planFor: (s, t) => window.SwapMath.planFor(s, t) };
})();
