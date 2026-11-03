/* First-run setup. A full-screen cover (not a sheet, so picking whose data can switch profiles
   without closing it). Opens on first launch while the global store key "onboarded" is unset, and
   from "Set up again" (You sheet) or the desktop panel via Swap open("onboard").
   Steps: welcome + whose data -> findings computed from the active profile -> weekly save target
   (api.setSave, the weekly budget from api.budget: the same number as the Today card) -> kitchen, meal plan, subway, late nights (api.questions,
   store "moveProfile", shared with Move-in and the You sheet) -> reminders (api.notify; iPhone app
   only, the step is left out on the web) -> done (the budget after commit + one swap from api.swaps()).
   Chrome: Back top-left, Close X top-right on every step. "Skip this question" sits under each question.
   One signature motion: the findings stack in. Everything else is a quiet fade under 250ms. */
(function () {
  const PRESETS = [25, 50, 100, 150];
  const UNIT = { week: "a week", order: "an order", meal: "a meal", ride: "a ride", month: "a month" };
  const MINUS = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/></svg>';
  let live = null;   // the open cover, so a deep link and the first-run boot never open two

  // "13 months" when the history covers 3+ months, else "10 weeks".
  function span(weekly) {
    const t0 = Date.parse(weekly[0].wk + "T00:00:00Z"), t1 = Date.parse(weekly[weekly.length - 1].wk + "T00:00:00Z") + 7 * 864e5;
    const months = Math.round((t1 - t0) / (30.44 * 864e5));
    return months >= 3 ? `${months} months` : `${weekly.length} weeks`;
  }
  const one = n => n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);

  // 3-4 findings, every number computed from the active profile's data.
  function findings(api) {
    const { money, esc, brandMark } = api, D = api.data, out = [];
    const card = (label, value, mark, foot, extra = "") => `<div class="card ob-find">
      <div class="ob-fhead"><div class="ob-ftext"><span class="t-sub t-2">${label}</span><span class="n-m">${value}</span></div>${mark ? `<div class="ob-marks">${mark}</div>` : ""}</div>
      ${foot ? `<p class="t-foot t-2 ob-foot">${foot}</p>` : ""}${extra}</div>`;

    const u = D.usual, B = typeof api.budget === "function" ? api.budget() : null;
    if (B && B.scope === "all") {
      // Live build: all his money out, the same usual week the budget is built on.
      out.push(card("Usual week", money(B.usual), "", B.flex ? "Last 10 weeks, all spending except bills" : "All money out, not investing",
        B.fixedUsual ? `<div class="ob-legend t-foot t-2"><span>Bills, apart <b class="num">${money(B.fixedUsual)}</b> a week</span></div>` : ""));
    } else {
      out.push(card("Usual week", money(u.total), "", "Food and getting around, last 6 weeks", `
        <div class="ob-split" aria-hidden="true"><i class="fill-food" style="flex:${u.food}"></i><i class="fill-move" style="flex:${u.move}"></i></div>
        <div class="ob-legend t-foot t-2"><span><i class="dot food"></i>Food <b class="num">${money(u.food)}</b></span><span><i class="dot move"></i>Getting around <b class="num">${money(u.move)}</b></span></div>`));
    }

    const gap = (D.priceGaps || []).slice().sort((a, b) => (b.delivered - b.pickup) - (a.delivered - a.pickup))[0];
    if (gap && gap.delivered > gap.pickup) {
      out.push(card("Delivery markup", `+${money(gap.delivered - gap.pickup)}<small class="t-sub t-2"> an order</small>`, brandMark(gap.place, "delivery", 40),
        `${esc(gap.place)}: ${money(gap.delivered)} delivered, ${money(gap.pickup)} pickup`));
    }

    const m = D.move;
    if (m && m.ridesPerWeekAfter != null) {
      // The ride app shows only where it has a real display name (founder's build); public builds hide it.
      const appList = (D.ridePrices || []).filter(r => !api.isRideApp(r.app) || D.rideAppName).map(r => api.displayMerchant(r.app));
      const apps = appList.length ? `<span class="ob-marks-in" role="img" aria-label="${esc(appList.join(" and "))}">${appList.map(n => brandMark(n, "ride", 36)).join("")}</span>` : "";
      const foot = m.ridesPerWeekBefore != null ? `${esc(m.afterLabel)}. Was ${one(m.ridesPerWeekBefore)} ${esc(m.beforeLabel.toLowerCase())}.` : esc(m.afterLabel);
      out.push(card("Rides a week", one(m.ridesPerWeekAfter), apps, foot));
    }

    const P = D.id === "you" && api.privateData();
    const subs = P && (P.subscriptions || []).filter(s => s.active);
    if (subs && subs.length) {
      const perMonth = s => s.amount * ({ weekly: 52 / 12, yearly: 1 / 12, annual: 1 / 12 }[s.freq] || 1);
      const total = subs.reduce((t, s) => t + perMonth(s), 0);
      // Logos for branded ones only; the rest are counted, never named.
      const brands = [], seen = new Set();
      subs.forEach(s => { const src = api.logo(s.name); if (src && !seen.has(src)) { seen.add(src); brands.push(s.name); } });
      const shown = brands.slice(0, 3), covered = subs.filter(s => shown.some(b => api.logo(b) === api.logo(s.name))).length;
      const rest = subs.length - covered;
      const names = shown.join(", ") + (rest ? ` and ${rest} more` : "");
      const mark = `<span class="ob-marks-in" role="img" aria-label="${esc(names)}">${shown.map(n => brandMark(n, "food", 36)).join("")}${rest ? `<span class="ob-more t-foot" aria-hidden="true">+${rest}</span>` : ""}</span>`;
      out.push(card("Subscriptions", `${money(Math.round(total))}<small class="t-sub t-2"> a month</small>`, mark, `${subs.length} active`));
    } else if (D.source === "sample") {
      const by = {};
      api.charges().forEach(c => { if (api.isRideApp(c.merchant)) return; (by[c.merchant] = by[c.merchant] || { name: c.merchant, kind: c.kind, amt: 0 }).amt += c.amount; });
      const top = Object.values(by).sort((a, b) => b.amt - a.amt).slice(0, 3);
      if (top.length) out.push(`<div class="card ob-find"><span class="t-sub t-2">Top places this week</span><div class="list">${top.map(p =>
        `<div class="row">${brandMark(p.name, p.kind, 32)}<span class="grow t-body">${esc(p.name)}</span><span class="amt">${money(p.amt)}</span></div>`).join("")}</div></div>`);
    }
    return out.slice(0, 4);
  }

  function run(api, { first = false } = {}) {
    if (live) return;
    const { el, esc, money, icon, store, haptic, animate } = api;
    const Q = {}; api.questions.forEach(q => { Q[q.key] = q; });
    // Reminders are iPhone-app only, so the web leaves the step out instead of showing dead rows.
    const STEPS = ["welcome", "findings", "save", ...api.questions.map(q => q.key), ...(api.notify.available ? ["remind"] : []), "done"];
    const app = document.getElementById("app");
    const behind = [app.querySelector(".views"), app.querySelector(".tabbar"), app.querySelector(".navbar"), document.querySelector(".panel")].filter(Boolean);
    const prevFocus = document.activeElement;
    let idx = 0, timers = [], ans = {}, save = 0;

    const ov = el(`<div class="ob" role="dialog" aria-modal="true" aria-label="Set up Swap">
      <div class="ob-bar">
        <button class="icon-btn ob-back" aria-label="Back">${icon("back", 22, 2.2)}</button>
        <div class="ob-prog" role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax="${STEPS.length - 1}">${STEPS.slice(1).map(() => "<i></i>").join("")}</div>
        <button class="icon-btn ob-close" aria-label="Close setup">${icon("close", 18, 2.4)}</button>
      </div>
      <div class="ob-body"></div>
      <div class="ob-actions"><button class="btn primary block ob-next">Continue</button></div>
    </div>`);
    const body = ov.querySelector(".ob-body"), back = ov.querySelector(".ob-back"), closeBtn = ov.querySelector(".ob-close");
    const next = ov.querySelector(".ob-next"), prog = ov.querySelector(".ob-prog"), actions = ov.querySelector(".ob-actions");
    app.appendChild(ov);
    behind.forEach(n => (n.inert = true));
    live = ov;

    const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
    // label null = no Continue on this step (questions advance on tap).
    const setNext = (label, ok = true) => { actions.hidden = label == null; if (label != null) { next.textContent = label; next.disabled = !ok; } };
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); finish(); } };
    document.addEventListener("keydown", onKey);
    closeBtn.addEventListener("click", () => { haptic(); finish(); });

    // Focus goes back to the opener, or (first run, opener was <body>) to the current tab's title.
    function restoreFocus() {
      if (prevFocus && prevFocus !== document.body && prevFocus.isConnected && prevFocus.focus && !prevFocus.closest(".sheet, .ob")) { prevFocus.focus({ preventScroll: true }); return; }
      const h = document.getElementById(`title-${api.current()}`);
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      else { const pb = document.querySelector("[data-profile-btn]"); pb && pb.focus({ preventScroll: true }); }
    }
    function close() {
      clearTimers();
      document.removeEventListener("keydown", onKey);
      behind.forEach(n => (n.inert = false));
      ov.style.pointerEvents = "none"; ov.inert = true;
      live = null;
      animate(ov, [{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: "0 24px" }], { preset: "snappy", duration: 240 }).then(() => ov.remove());
      restoreFocus();
    }
    function finish(toWeek) {
      store.set("onboarded", true);
      if (toWeek) { api.go("week"); haptic("success"); }
      close();
    }

    // Single-choice group: roving tabindex, arrows move and select, spring on the picked option.
    // onPick(value, button, byTap): byTap is true for a click/tap (or Enter/Space), false for arrow keys.
    function radios(group, onPick) {
      const items = () => [...group.querySelectorAll('[role="radio"]')];
      const pick = (b, byTap) => {
        items().forEach(x => { const on = x === b; x.setAttribute("aria-checked", String(on)); x.tabIndex = on ? 0 : -1; });
        haptic();
        animate(b, [{ scale: .96 }, { scale: 1 }], { preset: "snappy" });
        const t = b.querySelector(".tick"); t && animate(t, [{ scale: .5 }, { scale: 1 }], { preset: "standard" });
        onPick(b.dataset.v, b, byTap);
      };
      items().forEach(b => b.addEventListener("click", () => { if (!b.disabled) pick(b, true); }));
      group.addEventListener("keydown", e => {
        const list = items().filter(x => !x.disabled), i = list.indexOf(document.activeElement);
        const j = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1 }[e.key];
        if (j == null || i < 0) return;
        e.preventDefault(); const n = list[(j + list.length) % list.length]; n.focus(); pick(n, false);
      });
      const on = items().find(x => x.getAttribute("aria-checked") === "true") || items()[0];
      if (on) on.tabIndex = 0;
    }

    // Values that depend on whose data is showing; refreshed when leaving the welcome step.
    // Every profile starts with no answers picked; saved answers come back on a re-run.
    function loadProfile() {
      const saved = store.get("moveProfile");
      ans = saved ? Object.assign({}, saved) : {};
      delete ans.at;
      save = api.data.thisWeek.saveTarget;
    }
    // Step position, spoken with the heading (the progress bar itself never gets focus).
    const pos = () => idx > 0 ? `<span class="vh">Step ${idx} of ${STEPS.length - 1}. </span>` : "";

    // ---------- Steps ----------
    const build = {
      welcome(node) {
        node.classList.add("ob-welcome");
        node.innerHTML = `<div class="ob-hero">
            <img class="ob-icon" src="icons/icon.svg" width="84" height="84" alt="">
            <h2 class="t-title">Where your money goes</h2>
            <p class="t-body t-2">${api.data.live ? "From your bank." : "From your card."} Save ${money(api.data.thisWeek.saveTarget)} a week.</p>
          </div>
          <div class="ob-who"><span class="t-foot t-2" id="ob-who-l">Whose data</span>
            <div class="ob-seg" role="radiogroup" aria-labelledby="ob-who-l">${api.profiles().map(p =>
              `<button role="radio" data-v="${p.id}" aria-checked="${p.active}" tabindex="-1"><b>${esc(p.short)}</b><small>${p.source === "real" ? "Real" : "Sample"}</small></button>`).join("")}</div>
          </div>`;
        radios(node.querySelector(".ob-seg"), id => api.setProfile(id));
        setNext("Continue");
      },

      findings(node) {
        const D = api.data, cards = findings(api), real = D.source === "real";
        // One source and one window per screen: the header says where the numbers come from.
        node.innerHTML = `<div class="ob-head"><h2 class="t-title">${pos()}${real ? "Your spending" : "A sample student"}</h2>
          <p class="t-sub t-2">${D.live ? "From your bank." : real ? `From your card, last ${span(D.weekly)}.` : `Last ${span(D.weekly)}.`} ${api.badge()}</p></div>
          <div class="ob-finds">${cards.join("")}</div>`;
        const items = [...node.querySelectorAll(".ob-find")];
        items.forEach(c => c.classList.add("pending"));
        const reveal = (c, now) => {
          if (!c.classList.contains("pending")) return;
          c.classList.remove("pending");
          if (now) return;
          animate(c, [{ opacity: 0, translate: "0 22px", scale: .97 }, { opacity: 1, translate: "0 0", scale: 1 }], { preset: "gentle" });
        };
        const gap = api.reduced ? 160 : 460;
        items.forEach((c, i) => timers.push(setTimeout(() => reveal(c), 220 + i * gap)));
        // A tap anywhere on the cards lands the whole stack at once.
        node.querySelector(".ob-finds").addEventListener("click", () => {
          clearTimers();
          items.forEach(c => { reveal(c, true); c.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} }); });
        });
        setNext("Continue");
      },

      save(node) {
        const max = api.capParts().max;
        const custom = !PRESETS.includes(save);
        node.innerHTML = `<h2 class="t-title">${pos()}How much to save each week?</h2>
          <div class="ob-amts" role="radiogroup" aria-label="Save each week">
            ${PRESETS.map(v => `<button class="ob-amt" role="radio" data-v="${v}" aria-checked="${!custom && v === save}" tabindex="-1"${v > max ? " disabled" : ""}><span class="n-m">${money(v)}</span></button>`).join("")}
            <button class="ob-amt wide" role="radio" data-v="custom" aria-checked="${custom}" tabindex="-1"><span class="t-headline">Custom</span></button>
          </div>
          <div class="ob-stepper card" ${custom ? "" : "hidden"}>
            <button class="icon-btn ob-step-btn" data-d="-5" aria-label="Save $5 less">${MINUS}</button>
            <output class="n-m"></output>
            <button class="icon-btn ob-step-btn" data-d="5" aria-label="Save $5 more">${icon("plus", 22, 2.2)}</button>
          </div>
          <div class="card ob-cap">
            <div class="ob-cap-h"><span class="t-sub t-2">Weekly budget: usual week minus savings</span>${api.badge("usual")}</div>
            <span class="n-l"></span>
            <span class="t-foot t-2 ob-formula"></span>
          </div>
          <p class="vh" role="status" aria-live="polite"></p>`;
        const stepper = node.querySelector(".ob-stepper"), out = stepper.querySelector("output");
        const capEl = node.querySelector(".ob-cap .n-l"), fEl = node.querySelector(".ob-formula"), status = node.querySelector('[role="status"]');
        let statusTimer;
        const sync = bump => {
          out.textContent = money(save);
          capEl.textContent = money(api.capOf(save));
          fEl.textContent = api.capLine(save);
          stepper.querySelector('[data-d="-5"]').disabled = save <= 5;
          stepper.querySelector('[data-d="5"]').disabled = save + 5 > max;
          if (bump) {
            animate(capEl, [{ scale: .94, opacity: .6 }, { scale: 1, opacity: 1 }], { preset: "snappy" });
            // One status line per change, never two bare numbers.
            clearTimeout(statusTimer);
            statusTimer = setTimeout(() => { status.textContent = `Saving ${money(save)} a week. Budget ${money(api.capOf(save))}.`; }, 250);
          }
        };
        radios(node.querySelector(".ob-amts"), v => {
          stepper.hidden = v !== "custom";
          if (v !== "custom") save = +v;
          sync(true);
        });
        stepper.querySelectorAll("[data-d]").forEach(b => b.addEventListener("click", () => {
          save = Math.max(5, Math.min(max, save + +b.dataset.d)); haptic(); sync(true);
        }));
        sync(false);
        setNext("Continue");
      },

      remind(node) {
        const on = api.notify.state() || { sunday: true, daily: false };
        // Same rows as the You sheet (core REMINDERS): Sunday 6 PM plan, 8:30 AM today's number.
        const rows = (api.reminders || [
          { k: "sunday", title: "Plan next week", sub: "Sunday 6 PM", icon: "week" },
          { k: "daily", title: "Morning number", sub: "8:30 AM, what you can spend today", icon: "receipt" }
        ]).map(r => [r.k, r.title, r.sub, r.icon]);
        node.innerHTML = `<div class="ob-head"><h2 class="t-title">${pos()}Reminders</h2><p class="t-sub t-2">Change these any time under You.</p></div>
          <div class="card ob-rem">${rows.map(r => `<button class="switch-row" role="switch" data-k="${r[0]}" aria-checked="${!!on[r[0]]}"><span class="well" aria-hidden="true">${icon(r[3], 20)}</span><span class="grow"><b class="t-headline">${r[1]}</b><span class="t-foot t-2">${r[2]}</span></span><span class="switch" aria-hidden="true"></span></button>`).join("")}</div>`;
        node.querySelectorAll(".switch-row").forEach(b => b.addEventListener("click", () => {
          b.setAttribute("aria-checked", String(b.getAttribute("aria-checked") !== "true")); haptic();
        }));
        setNext("Continue");
      },

      done(node) {
        // The budget after commit: the same number the Today card shows.
        const t = api.data.thisWeek, budget = api.capOf(t.saveTarget);
        const list = api.swaps(), pick = list.find(s => s.id === store.get("deckPick")) || list[0];
        const markFor = s => s.rideApp ? api.brandMark(api.data.rideAppName || "Lower-fare app", "ride", 44)
          : api.logo(s.title) ? api.brandMark(s.title, s.kind, 44)
          : /subway/i.test(s.title) ? api.brandMark("MTA", "move", 44) : api.brandMark("", s.kind === "move" ? "ride" : "food", 44);
        node.innerHTML = `<h2 class="ob-done-h"><span class="t-title3">Your budget</span><span class="ob-capline"><span class="n-xl">${money(budget)}</span><span class="t-title3 t-2">a week</span></span></h2>
          <p class="t-foot t-2 ob-foot">${esc(api.capLine(t.saveTarget))} ${api.badge("usual")}</p>
          ${pick ? `<div class="ob-try"><h3 class="t-headline">One swap to try ${api.badge("swaps") !== api.badge("usual") ? api.badge("swaps") : ""}</h3>
            <div class="card ob-swap">${markFor(pick)}<div class="grow"><b class="t-headline">${esc(pick.title)}</b><span class="t-sub t-2">${esc(pick.detail)}</span></div>
              <div class="ob-save"><span class="n-m">${money(pick.save)}</span><span class="t-foot t-2">${UNIT[pick.unit] || ""}</span></div></div></div>` : ""}`;
        setNext(`Go to ${api.weekName().toLowerCase()}`);
      }
    };
    // Questions share one builder. A tap picks and moves on; arrow keys only select (no surprise jumps).
    // "Skip this question" moves on without an answer.
    Object.keys(Q).forEach(key => {
      build[key] = node => {
        const q = Q[key];
        node.innerHTML = `<div class="ob-head"><h2 class="t-title">${pos()}${esc(q.q)}</h2>${q.hint ? `<p class="t-sub t-2">${esc(q.hint)}</p>` : ""}</div>
          <div class="choices ob-choices" role="radiogroup" aria-label="${esc(q.q)}">${q.opts.map(([v, label]) =>
            `<button class="choice" role="radio" data-v="${v}" aria-checked="${ans[key] === v}" tabindex="-1"><span class="grow"><b>${esc(label)}</b></span><span class="tick" aria-hidden="true">${icon("check", 14, 3)}</span></button>`).join("")}</div>
          <button class="btn plain ob-skipq">Skip this question</button>`;
        radios(node.querySelector(".ob-choices"), (v, b, byTap) => {
          ans[key] = v; commit(key);
          if (byTap) timers.push(setTimeout(() => show(idx + 1, 1), api.reduced ? 120 : 260));
        });
        node.querySelector(".ob-skipq").addEventListener("click", () => { haptic(); show(idx + 1, 1); });
        setNext(null);
      };
    });

    // What each step commits (questions commit on pick; the rest on Continue).
    function commit(name) {
      if (name === "welcome") loadProfile();
      if (name === "save") api.setSave(save);
      if (Q[name] && ans[name] != null) store.set("moveProfile", Object.assign({}, store.get("moveProfile") || {}, { [name]: ans[name], at: Date.now() }));
      if (name === "remind" && api.notify.available) {
        const v = k => ov.querySelector(`.switch-row[data-k="${k}"]`).getAttribute("aria-checked") === "true";
        const o = { sunday: v("sunday"), daily: v("daily") };
        if (o.sunday || o.daily) api.notify.enable(o); else api.notify.disable();
      }
    }

    function show(i, dir = 1) {
      clearTimers();
      idx = i;
      const name = STEPS[i];
      const node = el(`<div class="ob-step" data-step="${name}"></div>`);
      build[name](node);
      body.replaceChildren(node);
      body.scrollTop = 0;
      if (i === 0) back.dataset.off = ""; else delete back.dataset.off;
      back.tabIndex = i === 0 ? -1 : 0;
      prog.hidden = i === 0;
      prog.setAttribute("aria-valuenow", String(Math.max(1, i)));
      prog.setAttribute("aria-valuetext", `Step ${Math.max(1, i)} of ${STEPS.length - 1}`);
      [...prog.children].forEach((b, j) => b.classList.toggle("on", j < i));
      if (dir) animate(node, [{ opacity: 0, translate: `${dir * 18}px 0` }, { opacity: 1, translate: "0 0" }], { preset: "snappy", duration: 240 });
      api.focusTitle(node);
    }

    next.addEventListener("click", () => {
      if (next.disabled) return;
      const name = STEPS[idx];
      commit(name);
      haptic();
      if (name === "done") return finish(true);
      show(idx + 1, 1);
    });
    back.addEventListener("click", () => { if (idx > 0) { haptic(); show(idx - 1, -1); } });

    loadProfile();
    show(0, 0);
    if (first) animate(ov, [{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
    else animate(ov, [{ translate: "0 100%" }, { translate: "0 0" }], { preset: "gentle" });
  }

  Swap.feature({
    id: "onboard",
    title: "First-run setup",
    pitch: "Whose data, what it shows, a weekly budget.",
    boot(api) { if (!api.store.get("onboarded")) run(api, { first: true }); },
    open(api) { run(api); }
  });
})();
