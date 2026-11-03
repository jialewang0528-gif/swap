/* What was this?
   Week tab, under Today. The bank files some money under vague categories ("Services", "Other").
   When a merchant there adds up to $50 or more in the last 10 weeks, Swap asks the person what it
   was, one at a time: a few likely answers, "Something else" for the full list, or "Skip".
   Answers are saved on the phone (overrides.js) and every total is worked out again. */
(function () {
  const QUICK = [
    { cat: "Investing", label: "Investing", note: "Not spending" },
    { cat: "Subscriptions", label: "Bill or subscription", note: "Out of the daily plan" },
    { cat: "Shopping", label: "Shopping" },
    { cat: "Fun", label: "Fun" },
  ];

  Swap.feature({
    id: "ask",
    title: "What was this?",
    pitch: "Swap asks about charges the bank filed vaguely.",
    tab: "week",
    order: 0.3,

    render(slot, api) {
      const O = window.SwapOverrides;
      if (!O || !api.data.live) return;
      const qs = O.questions();
      if (!qs.length) return;
      const { esc, money, haptic } = api;
      const q = qs[0];
      const name = window.SwapCategory ? window.SwapCategory.txName(api, q.name) : q.name;
      const last = new Date(q.last + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
      slot.innerHTML = `
        <h2 class="section-title">What was this? <small>${qs.length > 1 ? `1 of ${qs.length}` : ""}</small></h2>
        <div class="card ak">
          <div class="ak-top">${window.SwapCategory ? window.SwapCategory.txMark(api, { name: q.name, amount: q.total, cat: q.cat }) : ""}
            <div class="grow"><b class="t-sub ak-name">${esc(name)}</b>
              <span class="t-foot t-3">${money(Math.round(q.total))} · ${q.count} ${q.count === 1 ? "charge" : "charges"} · last ${esc(last)}</span>
              <span class="t-foot t-3">Your bank calls it "${esc(q.cat)}"</span></div></div>
          <div class="ak-opts" role="group" aria-label="What was ${esc(name)}?">
            ${QUICK.map(o => `<button class="btn tint ak-opt" data-cat="${esc(o.cat)}"><span>${esc(o.label)}</span>${o.note ? `<small>${esc(o.note)}</small>` : ""}</button>`).join("")}
          </div>
          <div class="ak-row"><button class="btn plain small ak-more">Something else</button><button class="btn plain small ak-skip">Skip</button></div>
        </div>`;
      const done = (cat, label) => { haptic("success"); O.set(q.name, q.cat, cat); api.toast(`${name}: ${label}`, "check"); setTimeout(() => O.reload(), 350); };
      slot.querySelectorAll(".ak-opt").forEach(b => b.addEventListener("click", () => done(b.dataset.cat, b.querySelector("span").textContent)));
      slot.querySelector(".ak-more").addEventListener("click", () => {
        haptic();
        if (window.SwapCategory) window.SwapCategory.recategorize(api, q.name, q.cat, { title: `What was ${name}?`, lede: `Pick a category. Moves every ${name} charge your bank filed as ${q.cat}.` });
      });
      slot.querySelector(".ak-skip").addEventListener("click", () => {
        haptic(); O.skip(q.name, q.cat);
        slot.replaceChildren(); this.render(slot, api);
      });
    }
  });
})();
