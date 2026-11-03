/* Wallet tab.
   Subscriptions first: one recurring monthly total (subscriptions + memberships), then every row.
   Rows can be renamed inline (store "subNames"). Swipe a row left (or focus its action) to mark it
   cancelled: that writes store "cancelledSubs", the same list as the Swaps tab's "Cancelled any
   subscriptions?" checklist, so the row moves to Ended and its "Cancel X" swap leaves the goal.
   Then the passes the student already pays for, as a Wallet-style stack: meal plan (only with a
   plan), DashPass / Uber One, and the OMNY fare cap. Uber One for Students shows only when the
   week has 4 or more Uber rides (it discounts Uber rides only).
   Meal swipe pace (window.SwapWallet.mealPace, mirror it in Chat):
     weeksElapsed = max(1, round((today - move.date) / 7 days)), or 10 with no move date
     using  = round(swipesUsed / weeksElapsed)   "Using ~N a week"
     canUse = round(swipesLeft / weeksLeft)       "Can use ~N a week"
   Tap or Enter/Space on a card's header lifts it to the front (the one signature motion);
   again, or Escape, puts it back. Collapsed bodies are hidden, so screen readers skip them. */
(function () {
const quiet = { on: false };
Swap.feature({
  id: "wallet",
  title: "Wallet",
  pitch: "What you already pay for.",
  tab: "wallet",
  order: 1,

  render(slot, api) {
    let alive = true, dispose = () => {};
    const onFacts = () => { if (alive) build(); };
    document.addEventListener("swap:facts", onFacts);

    function build() {
      dispose();
      slot.replaceChildren();
      dispose = draw(slot, api);
    }
    build();
    // A subscription marked cancelled on the Swaps tab moves to Ended here right away. Our own
    // writes redraw just the list (quiet), so focus stays put.
    const offGone = api.store.on("cancelledSubs", () => { if (alive && !quiet.on) build(); });
    return () => { alive = false; document.removeEventListener("swap:facts", onFacts); offGone && offGone(); dispose(); };
  }
});

function draw(slot, api) {
  const { el, esc, money, animate, haptic, kindIcon } = api;
  const D = api.data, f = api.facts(), ch = api.charges();
  const MONTH = 52 / 12;                                                     // weeks in a month
  const fmt = n => (n < 100 && Math.abs(n - Math.round(n)) > .004) ? money(n, 2) : money(Math.round(n));
  const one = n => (Math.round(n * 10) / 10).toString();
  const isYou = api.profile() === "you";
  const row = (label, value) => `<div class="row"><span class="grow">${label}</span><span class="amt">${value}</span></div>`;

  // ---------- what this profile pays for ----------
  const mem = name => (D.memberships || []).find(m => m.name === name) || null;
  const dp = mem("DashPass"), uo = mem("Uber One");
  const rides = ch.filter(c => c.kind === "ride");
  // Uber One discounts Uber rides only: never count the lower-fare app, Lyft or a cab toward it.
  const uberRides = rides.filter(c => /\buber\b/i.test(c.merchant || "") && !api.isRideApp(c.merchant));
  const weekWord = (typeof api.weekName === "function" ? api.weekName() : "This week").toLowerCase();   // "last week" on live data
  const transit = ch.filter(c => c.kind === "transit");
  const SUB = D.subway || { fare: 3, weeklyCap: 35 };
  const PAID_TAPS = Math.ceil(SUB.weeklyCap / SUB.fare);                   // 12: the 12th tap reaches $35
  const mp = f.hasMealPlan ? D.mealPlan : null;

  const meal = mp ? mealPace(D) : null;

  // ---------- cards ----------
  const CARDS = [];
  if (f.hasMealPlan) CARDS.push(mp ? {
    id: "meal", name: "Meal plan", tone: "accent", kind: "dining", face: `${mp.swipesLeft} left`,
    body: `<p class="wl-hero"><span class="n-l">${mp.swipesLeft}</span> <span class="t-sub t-2">swipes left</span></p>
      <div class="list">${row("Used", `${mp.swipesUsed} of ${mp.swipesPerSemester}`)}
        ${row("Using", `~${meal.using} a week`)}
        ${row("Can use", `~${meal.canUse} a week`)}
        ${row(`Left by ${esc(mp.expires)}`, `~${meal.leftAtEnd}`)}
        ${row("Dining hall", esc(mp.hallHours))}
        ${row("Guest swipes", String(mp.guestSwipes))}</div>`
  } : {
    id: "meal", name: "Meal plan", tone: "accent", kind: "dining", face: "Not connected",
    body: `<p class="t-sub t-2 wl-p">Swipes show here once connected.</p>`
  });
  if (dp) {
    const perMonth = dp.ordersPerWeek * MONTH;
    CARDS.push({ id: "dashpass", name: "DashPass", brand: "DashPass", tone: "food", kind: "delivery", face: `${fmt(dp.price)}/mo`,
      body: `<p class="wl-hero"><span class="n-l">${fmt(dp.price / perMonth)}</span> <span class="t-sub t-2">per order</span></p>
        <div class="list">${row("Price", `${fmt(dp.price)} a month`)}
          ${row("Orders", `~${one(dp.ordersPerWeek)} a week`)}
          ${dp.student ? row("Student plan", `${fmt(dp.student)} a month`) : ""}</div>
        ${dp.student ? `<p class="t-foot t-3 wl-p">Student ID needed.</p>` : ""}` });
  }
  if (uo) {
    const perMonth = uo.ridesPerWeek * MONTH;
    CARDS.push({ id: "uberone", name: "Uber One", brand: "Uber One", tone: "move", kind: "ride", face: `${fmt(uo.price)}/mo`,
      body: `<p class="wl-hero"><span class="n-l">${fmt(uo.price / perMonth)}</span> <span class="t-sub t-2">per ride</span></p>
        <div class="list">${row("Price", `${fmt(uo.price)} a month`)}
          ${row("Rides", `~${one(uo.ridesPerWeek)} a week`)}
          ${uo.student ? row("Student plan", `${fmt(uo.student)} a month`) : ""}</div>
        ${uo.student ? `<p class="t-foot t-3 wl-p">Student ID needed.</p>` : ""}` });
  }
  const taps = transit.length, on = Math.min(taps, PAID_TAPS);
  const ring = (() => {
    const C = 48, R = 40, seg = 360 / PAID_TAPS, gap = 8;
    const pt = d => { const r = (d - 90) * Math.PI / 180; return `${(C + R * Math.cos(r)).toFixed(2)} ${(C + R * Math.sin(r)).toFixed(2)}`; };
    let s = "";
    for (let i = 0; i < PAID_TAPS; i++) s += `<path class="${i < on ? "on" : ""}" d="M${pt(i * seg + gap / 2)} A${R} ${R} 0 0 1 ${pt((i + 1) * seg - gap / 2)}"/>`;
    return `<div class="wl-ring" role="img" aria-label="${taps} of ${PAID_TAPS} paid taps ${weekWord}"><svg viewBox="0 0 96 96" aria-hidden="true">${s}</svg>
      <span class="wl-ring-c" aria-hidden="true"><span class="n-m">${taps}</span><span class="t-foot t-2">of ${PAID_TAPS}</span></span></div>`;
  })();
  CARDS.push({ id: "omny", name: "OMNY fare cap", brand: "OMNY", tone: "move", kind: "transit", face: `${taps} of ${PAID_TAPS} taps`,
    body: `<div class="wl-omny">${ring}<div class="list">${row("Fare", money(SUB.fare))}${row("Cap", money(SUB.weeklyCap))}${row("Free after", `${PAID_TAPS} taps`)}</div></div>
      <div class="list">${row(`Taps ${weekWord}`, `${taps} (${money(taps * SUB.fare)})`)}
        ${isYou && SUB.tapsPerWeek ? row("Usual", `~${one(SUB.tapsPerWeek)} a week`) : ""}
        ${row("Resets", "7 days after first tap")}</div>` });

  // ---------- markup ----------
  const subsHost = el(`<div class="wl-subs-host"></div>`);
  const root = el(`<div class="wl">
    <h2 class="section-title" id="wl-cards-h">Passes<small>${CARDS.length}</small></h2>
    <div class="wl-stack" role="list" aria-labelledby="wl-cards-h"></div>
  </div>`);
  root.prepend(subsHost);

  // Uber One for Students: only when the week has 4+ Uber rides and no Uber One yet. The badge
  // comes from core (none on live data); the week word matches the charges' week.
  if (!uo && uberRides.length >= 4) {
    const uberSpend = uberRides.reduce((s, c) => s + c.amount, 0);
    root.appendChild(el(`<div class="wl-opts">
      <h2 class="section-title" id="wl-opt-h">Options ${typeof api.badge === "function" ? api.badge("memberships") : ""}</h2>
      <section class="card wl-opt" aria-labelledby="wl-opt-h">
        <div class="wl-opt-row">${api.brandMark("Uber One", "move", 40)}
          <div class="grow"><p class="t-headline">Uber One for Students</p>
            <p class="t-sub t-2">Uber rides ${weekWord}: <span class="num">${uberRides.length}</span> · <span class="num">${money(uberSpend)}</span></p></div>
          <p class="wl-opt-price"><span class="n-m">${money(4.99, 2)}</span> <span class="t-foot t-2">a month</span></p></div>
        <p class="t-foot t-3 wl-p">Student ID needed.</p>
      </section></div>`));
  }
  const offSubs = subscriptions(subsHost, api);
  slot.appendChild(root);
  const stack = root.querySelector(".wl-stack");

  const nodes = CARDS.map((c, i) => {
    const n = el(`<article class="wl-card t-${c.tone}" role="listitem" data-id="${c.id}">
      <h3 class="wl-h"><button class="wl-head" aria-expanded="false" aria-controls="wl-b-${c.id}" id="wl-hd-${c.id}">
        ${c.brand ? api.brandMark(c.brand, c.kind, 32) : kindIcon(c.kind, { tile: true, size: 20 })}
        <span class="wl-name"><span class="t-headline">${esc(c.name)}</span></span>
        <span class="wl-face t-sub">${esc(c.face)}</span></button></h3>
      <div class="wl-body" id="wl-b-${c.id}" role="region" aria-labelledby="wl-hd-${c.id}">${c.body}</div></article>`);
    n.style.zIndex = String(i + 1);
    stack.appendChild(n);
    return { el: n, head: n.querySelector(".wl-head"), body: n.querySelector(".wl-body") };
  });

  // ---------- layout ----------
  // Closed: overlapping passes, each showing its header (Wallet). Open: the card lifts to the
  // front at the top; the others line up under it with their headers showing, so any of them
  // can be tapped to switch.
  const GAP = 12;
  let open = -1, sizes = "";
  function setOpenState() {
    nodes.forEach((n, i) => {
      const on = i === open;
      n.body.hidden = !on; n.body.inert = !on;
      if (on) n.body.removeAttribute("aria-hidden"); else n.body.setAttribute("aria-hidden", "true");
      n.head.setAttribute("aria-expanded", String(on));
      n.el.classList.toggle("open", on);
      n.el.style.zIndex = String(on ? 50 : i + 1);
    });
  }
  function measure() {
    const h = nodes.map(n => n.head.offsetHeight), H = nodes.map(n => n.el.offsetHeight);
    sizes = H.join(",") + "|" + h.join(",");
    let y = [], total;
    if (open < 0) {
      let acc = 0; nodes.forEach((_, i) => { y[i] = acc; acc += h[i]; });
      total = y[nodes.length - 1] + H[nodes.length - 1];
    } else {
      y[open] = 0; let acc = H[open] + GAP, last = open;
      nodes.forEach((_, i) => { if (i === open) return; y[i] = acc; acc += h[i]; last = i; });
      total = last === open ? H[open] : y[last] + H[last];
    }
    return { y, total };
  }
  function apply(moved, lifted) {
    setOpenState();
    const t = measure();
    const fromH = stack.offsetHeight;
    stack.style.height = t.total + "px";
    nodes.forEach((n, i) => {
      const to = `translate3d(0,${t.y[i]}px,0)`;
      const from = getComputedStyle(n.el).transform;
      n.el.getAnimations().forEach(a => a.cancel());
      n.el.style.transform = to;
      if (!moved) return;
      if (api.reduced) { if (i === lifted) animate(n.el, [{ opacity: 0 }, { opacity: 1 }]); return; }
      // The lifted card leads on the standard spring; the rest settle on the gentle one.
      animate(n.el, [{ transform: from === "none" ? to : from }, { transform: to }], { preset: i === lifted ? "standard" : "gentle" });
    });
    if (moved && !api.reduced && fromH && fromH !== t.total) animate(stack, [{ height: fromH + "px" }, { height: t.total + "px" }], { preset: "gentle" });
  }
  function reveal(i) {
    // Keep the open card in view. Scroll the view itself, never scrollIntoView (it moves .app).
    const v = root.closest(".view"); if (!v) return;
    const cs = getComputedStyle(v), vr = v.getBoundingClientRect();
    const top = vr.top + parseFloat(cs.paddingTop), bottom = vr.bottom - parseFloat(cs.paddingBottom);
    const sr = stack.getBoundingClientRect(), cardBottom = sr.top + nodes[i].el.offsetHeight;
    let d = 0;
    if (sr.top < top) d = sr.top - top - 8;
    else if (cardBottom > bottom) d = Math.min(cardBottom - bottom + 8, sr.top - top - 8);
    if (d) v.scrollBy({ top: d, behavior: api.reduced ? "auto" : "smooth" });
  }
  function toggle(i) {
    const was = open;
    open = open === i ? -1 : i;
    haptic(open < 0 ? "light" : "heavy");
    apply(true, open >= 0 ? open : was);
    if (open >= 0) reveal(open);
  }
  nodes.forEach((n, i) => {
    n.head.addEventListener("click", () => toggle(i));
    n.el.addEventListener("keydown", e => {
      if (e.key === "Escape" && open === i) { e.preventDefault(); e.stopPropagation(); toggle(i); n.head.focus({ preventScroll: true }); }
    });
  });
  apply(false);

  // Card heights follow text size and width; re-lay out when a size actually changes.
  let ro = null;
  if ("ResizeObserver" in window) {
    ro = new ResizeObserver(() => {
      const H = nodes.map(n => n.el.offsetHeight).join(",") + "|" + nodes.map(n => n.head.offsetHeight).join(",");
      if (H !== sizes) apply(false);
    });
    nodes.forEach(n => ro.observe(n.el));
  }
  return () => { ro && ro.disconnect(); offSubs(); };
}

// ---------- Subscriptions ----------
// Recurring charges. "you" reads the on-device private list when it exists (REAL); otherwise a short
// SAMPLE list per profile. Marking one cancelled writes store "cancelledSubs" (names), shared with Swaps.
const SAMPLE_SUBS = {
  you: [
    { name: "DashPass", amount: 9.99, freq: "monthly", since: "2026-10", active: true },
    { name: "Apple Music Student", amount: 5.99, freq: "monthly", since: "2025-09", active: true },
    { name: "Apple iCloud+", amount: 2.99, freq: "monthly", since: "2025-01", active: true },
    { name: "Hulu", amount: 9.99, freq: "monthly", since: "2026-06", active: true },
    { name: "Uber One", amount: 9.99, freq: "monthly", since: "2026-02", until: "2026-05", active: false }
  ],
  mealplan: [
    { name: "DashPass", amount: 9.99, freq: "monthly", since: "2026-09", active: true },
    { name: "Apple Music Student", amount: 5.99, freq: "monthly", since: "2026-08", active: true },
    { name: "Apple iCloud+", amount: 0.99, freq: "monthly", since: "2025-06", active: true },
    { name: "Hulu", amount: 9.99, freq: "monthly", since: "2026-01", until: "2026-08", active: false }
  ],
  social: [
    { name: "Uber One", amount: 9.99, freq: "monthly", since: "2026-03", active: true },
    { name: "Apple Music Student", amount: 5.99, freq: "monthly", since: "2025-09", active: true },
    { name: "Hulu", amount: 9.99, freq: "monthly", since: "2026-05", active: true },
    { name: "Apple iCloud+", amount: 2.99, freq: "monthly", since: "2025-04", active: true },
    { name: "DashPass", amount: 9.99, freq: "monthly", since: "2026-02", until: "2026-06", active: false }
  ]
};
const PER_MONTH = { monthly: 1, yearly: 1 / 12, annual: 1 / 12, weekly: 52 / 12, quarterly: 1 / 3 };
const FOOD_RIDE = /dashpass|doordash|uber|lyft|grubhub|seamless|citi ?bike|instacart/i;

function subscriptions(host, api) {
  const { el, esc, money, store, haptic } = api;
  const D = api.data;
  const priv = api.privateData();
  const isReal = api.profile() === "you" && !!(priv && Array.isArray(priv.subscriptions) && priv.subscriptions.length);
  const base = (isReal ? priv.subscriptions : (SAMPLE_SUBS[api.profile()] || [])).slice();
  // Memberships the profile pays for count in the same monthly total; add any the list lacks.
  (D.memberships || []).forEach(m => {
    if (!base.some(s => s.active && (s.name === m.name || (s.brand && new RegExp(s.brand, "i").test(m.name)))))
      base.push({ name: m.name, amount: m.price, freq: m.period === "year" ? "yearly" : "monthly", active: true });
  });
  if (!base.length) return () => {};
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const seen = {};
  const rows = base.map(s => {
    let id = s.id || slug(`${s.name}-${s.amount}-${s.since || ""}-${s.until || ""}`);
    seen[id] = (seen[id] || 0) + 1; if (seen[id] > 1) id += "-" + seen[id];
    const month = s.amount * (PER_MONTH[s.freq] != null ? PER_MONTH[s.freq] : 1);
    return Object.assign({}, s, { id, month, year: month * 12 });
  });
  const goneSet = () => new Set(store.get("cancelledSubs") || []);
  const setGone = names => { quiet.on = true; try { store.set("cancelledSubs", [...new Set(names)]); } finally { quiet.on = false; } };
  // Older builds hid rows by id (store "hiddenSubs"): fold them into the one cancelled list, once.
  const hid = store.get("hiddenSubs");
  if (Array.isArray(hid) && hid.length) {
    const names = rows.filter(s => hid.includes(s.id) && s.active).map(s => s.name);
    store.set("hiddenSubs", []);
    if (names.length) setGone([...goneSet(), ...names]);
  }
  // Rows as they stand now: marked ones show as ended this month.
  const subsNow = () => { const g = goneSet(); return rows.map(s => s.active && g.has(s.name) ? Object.assign({}, s, { active: false, marked: true }) : s); };
  const totalNow = () => subsNow().filter(s => s.active).reduce((t, s) => t + s.month, 0);
  const mon = ym => { if (!ym) return ""; const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) + (y !== 2026 ? ` ’${String(y).slice(2)}` : ""); };
  const when = s => s.marked ? "Marked cancelled" : s.active ? (s.since ? `Since ${mon(s.since)}` : "Active") : [mon(s.since), mon(s.until)].filter(Boolean).join(" – ");
  const nameOf = s => ((store.get("subNames") || {})[s.id] || s.name);
  const mark = s => api.logo(s.name)
    ? api.brandMark(s.name, "food", 36)
    : `<span class="brandmark generic wl-mono" style="--bm:36px" aria-hidden="true">${esc(String(s.name).trim().charAt(0).toUpperCase())}</span>`;
  const badge = typeof api.badge === "function" ? (isReal && !api.data.live ? `<span class="real">Real</span>` : api.badge("memberships"))
    : isReal || (api.profile() === "you" && api.data.live) ? `<span class="real">Real</span>` : `<span class="sample">Sample</span>`;
  let openEnded = false, editing = null;

  // focus: { id, part: "name" | "still" } | { part: "heading" | "ended" }
  function draw(focus) {
    const subs = subsNow();
    const active = subs.filter(s => s.active).sort((a, b) => b.month - a.month);
    const ended = subs.filter(s => !s.active);
    const total = active.reduce((t, s) => t + s.month, 0);
    const foodRide = active.filter(s => FOOD_RIDE.test(`${s.name} ${s.brand || ""}`)).reduce((t, s) => t + s.month, 0);
    // Rows that share a name (five "Apple" charges) get a rename hint on the first one.
    const names = {}; active.forEach(s => { const n = nameOf(s); names[n] = (names[n] || 0) + 1; });
    let hinted = false;
    const row = s => {
      const name = nameOf(s);
      const dup = names[name] > 1 && !(store.get("subNames") || {})[s.id];
      const hint = dup && !hinted && s.active ? (hinted = true, " · Tap to rename") : "";
      const label = `${name}, ${money(s.month, 2)} a month`;
      const nameNode = editing === s.id
        ? `<input class="wl-rename t-sub" value="${esc(name)}" maxlength="32" enterkeyhint="done" autocomplete="off" aria-label="Name for ${esc(label)}">`
        : `<button class="wl-name-btn t-sub" aria-label="${esc(label)}. Rename">${esc(name)}</button>`;
      return `<li class="wl-sub${s.marked ? " is-marked" : ""}" data-id="${esc(s.id)}">
        <div class="wl-sub-fg">${mark(s)}
          <div class="wl-sub-main">
            <span class="grow">${nameNode}<span class="t-foot t-2">${esc(when(s))}${hint}</span></span>
            <span class="wl-sub-amt"><b class="num">${money(s.month, 2)}<span class="t-foot t-2" aria-hidden="true">/mo</span><span class="vh"> a month</span></b><span class="t-foot t-3 num"><span aria-hidden="true">${money(s.year, 2)}/yr</span><span class="vh">${money(s.year, 2)} a year</span></span></span>
            ${s.marked ? `<button class="btn tint small wl-still" aria-label="Still paying for ${esc(name)}">Still paying</button>` : ""}
          </div>
        </div>
        ${s.active ? `<button class="wl-gone-act t-foot" aria-label="Mark ${esc(label)} cancelled">Mark cancelled</button>` : ""}</li>`;
    };
    host.replaceChildren(el(`<section class="wl-subs" aria-labelledby="wl-subs-h">
      <div class="card wl-subs-card">
        <div class="wl-subs-sum">
          <div class="wl-subs-top"><h2 class="t-headline" id="wl-subs-h" tabindex="-1">Subscriptions</h2>${badge}</div>
          <p class="wl-hero"><span class="n-l">${money(total, 2)}</span> <span class="t-sub t-2">a month</span></p>
          <p class="t-sub t-2"><b class="num">${money(total * 12, 0)}</b> a year · <b class="num">${active.length}</b> active</p>
          ${foodRide > 0 && total - foodRide > 0 ? `<p class="t-foot t-2">Food and rides <b class="num">${money(foodRide, 2)}</b> · Other <b class="num">${money(total - foodRide, 2)}</b></p>` : ""}
        </div>
        ${active.length ? `<ul class="wl-sublist" aria-label="Active">${active.map(row).join("")}</ul>` : ""}
        ${ended.length ? `<div class="wl-ended">
          <button class="wl-ended-btn t-sub" aria-expanded="${openEnded}" aria-controls="wl-ended-l" aria-label="Ended subscriptions, ${ended.length}"><span>Ended</span><span class="t-2">${ended.length}</span>${api.icon("chevronDown", 16, 2.2)}</button>
          <ul class="wl-sublist" id="wl-ended-l" aria-label="Ended"${openEnded ? "" : " hidden"}>${ended.map(row).join("")}</ul></div>` : ""}
        ${active.length ? `<p class="t-foot t-3 wl-swipehint">Swipe a row left if you cancelled it.</p>` : ""}
      </div></section>`));
    const sec = host.firstElementChild;

    // Rename inline
    sec.querySelectorAll(".wl-name-btn").forEach(b => b.addEventListener("click", () => {
      if (swiped) return;
      editing = b.closest(".wl-sub").dataset.id; haptic(); draw();
    }));
    const inp = sec.querySelector(".wl-rename");
    if (inp) {
      const id = inp.closest(".wl-sub").dataset.id;
      let done = false;
      const finish = keep => {
        if (done) return; done = true;
        const v = inp.value.trim(), names = Object.assign({}, store.get("subNames") || {});
        const orig = rows.find(s => s.id === id).name;
        if (keep) { if (v && v !== orig) names[id] = v; else delete names[id]; store.set("subNames", names); }
        editing = null; draw({ id, part: "name" });
        if (keep && v && v !== orig) api.toast(`Renamed ${v}`);
      };
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } });
      inp.addEventListener("blur", () => finish(true));
      requestAnimationFrame(() => { inp.focus({ preventScroll: true }); inp.select(); });
    }

    // Mark cancelled (the action behind the row, revealed by a left swipe or keyboard focus) and Still paying
    sec.querySelectorAll(".wl-gone-act").forEach(b => b.addEventListener("click", () => markRow(b.closest(".wl-sub"))));
    sec.querySelectorAll(".wl-still").forEach(b => b.addEventListener("click", () => {
      const id = b.closest(".wl-sub").dataset.id, s = rows.find(x => x.id === id);
      haptic(); setGone([...goneSet()].filter(n => n !== s.name));
      draw({ id, part: "name" });
      api.toast(`${nameOf(s)} counted. Now ${money(totalNow(), 2)} a month.`);
    }));
    sec.querySelectorAll(".wl-sub:not(.is-marked) .wl-sub-fg").forEach(bindSwipe);

    const eb = sec.querySelector(".wl-ended-btn");
    eb && eb.addEventListener("click", () => {
      openEnded = !openEnded; haptic();
      eb.setAttribute("aria-expanded", String(openEnded));
      sec.querySelector("#wl-ended-l").hidden = !openEnded;
    });

    if (focus) {
      const t = focus.id ? sec.querySelector(`.wl-sub[data-id="${CSS.escape(focus.id)}"] ${focus.part === "still" ? ".wl-still" : ".wl-name-btn"}`)
        : focus.part === "ended" ? sec.querySelector(".wl-ended-btn") : null;
      (t || sec.querySelector("h2")).focus({ preventScroll: true });
    }
  }

  function markRow(li) {
    const id = li.dataset.id, s = rows.find(x => x.id === id);
    const hadFocus = host.contains(document.activeElement);
    // Next row to land on: the one below, else above, else the Ended toggle.
    const sib = [li.nextElementSibling, li.previousElementSibling].find(n => n && n.classList.contains("wl-sub"));
    haptic();
    const before = [...goneSet()];
    setGone(before.concat(s.name));
    draw(hadFocus ? (sib ? { id: sib.dataset.id, part: "name" } : { part: "ended" }) : null);
    api.toast(`${nameOf(s)} marked cancelled. Now ${money(totalNow(), 2)}/mo.`, "check", { action: { label: "Undo", onClick: () => {
      setGone(before); draw({ id, part: "name" });
    } } });
  }

  // Swipe left on a row: past 40% marks it cancelled, past 56px leaves the action showing.
  let swiped = false, openFg = null;
  const ACT = 88;
  function closeOpen(except) {
    if (openFg && openFg !== except) { openFg.style.translate = ""; openFg.closest(".wl-sub").classList.remove("is-open"); openFg = null; }
  }
  function bindSwipe(fg) {
    let g = null;
    fg.addEventListener("pointerdown", e => {
      if (e.button > 0 || e.target.closest("input")) return;
      closeOpen(fg);
      const base = fg === openFg ? -ACT : 0;
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base, dx: base, drag: false };
      swiped = false;
    });
    fg.addEventListener("pointermove", e => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.drag) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }
        if (Math.abs(dx) < 8) return;
        g.drag = true; swiped = true;
        try { fg.setPointerCapture(e.pointerId); } catch (err) {}
        fg.classList.add("dragging");
      }
      g.dx = Math.min(0, g.base + dx);
      fg.style.translate = `${g.dx}px 0`;
    });
    const end = e => {
      if (!g || e.pointerId !== g.id) return;
      const gg = g; g = null;
      fg.classList.remove("dragging");
      if (!gg.drag) return;
      const w = fg.offsetWidth, li = fg.closest(".wl-sub");
      if (e.type !== "pointercancel" && -gg.dx > w * .4) { fg.style.translate = `${-w}px 0`; setTimeout(() => markRow(li), api.reduced ? 0 : 140); }
      else if (-gg.dx > 56) { fg.style.translate = `${-ACT}px 0`; li.classList.add("is-open"); openFg = fg; haptic(); }
      else { fg.style.translate = ""; li.classList.remove("is-open"); if (openFg === fg) openFg = null; }
      setTimeout(() => { swiped = false; }, 50);
    };
    fg.addEventListener("pointerup", end);
    fg.addEventListener("pointercancel", end);
  }
  const onDocDown = e => { if (openFg && !openFg.closest(".wl-sub").contains(e.target)) closeOpen(); };
  document.addEventListener("pointerdown", onDocDown, true);

  draw();
  return () => { document.removeEventListener("pointerdown", onDocDown, true); };
}

// Meal swipe pace, one formula for every screen (Chat mirrors it).
function mealPace(D) {
  const mp = D.mealPlan; if (!mp) return null;
  const start = D.move && D.move.date ? new Date(D.move.date + "T12:00:00") : null, today = new Date((D.today || "2026-11-01") + "T12:00:00");
  const elapsed = start ? Math.max(1, Math.round((today - start) / 864e5 / 7)) : 10;
  const usedPerWeek = mp.swipesUsed / elapsed;
  return { weeksElapsed: elapsed, using: Math.round(usedPerWeek), canUse: Math.round(mp.swipesLeft / Math.max(1, mp.weeksLeft)),
    leftAtEnd: Math.max(0, Math.round(mp.swipesLeft - usedPerWeek * mp.weeksLeft)) };
}
window.SwapWallet = { mealPace };
})();
