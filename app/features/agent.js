/* Ask Swap: texting a calm friend who knows your week. Chat tab.
   Scripted, deterministic answers built from the active profile (api.data, api.facts(),
   api.charges(), api.swaps()). Keyword intents; anything unknown gets example questions.
   Rules: ONE bubble per answer, 1 or 2 short sentences, plus at most one card. Label + number
   copy, no guilt, no exclamation marks. Terms: Eating out, Coffee & snacks, Delivery, Rides,
   Subway; Food / Getting around; Cap, Left, Usual week, Owed, Paid back.
   Night rides are always OK: never a swap target, never "skip", "walk" or "subway" at night.
   The lower-fare ride app (api.isRideApp) is never suggested, except on the founder's private
   build where api.rideAppAllowed() is true (his choice). Names go through api.displayMerchant.
   This week's total stays hidden until the student has guessed it (store "guess").
   Signature motion: the first answer card grows out of the composer. Everything else is a quiet
   fade under 250ms.
   On the iPhone app with Apple Intelligence (window.SwapAI, app/ai.js), answers come from the
   on-device model, grounded in a compact context built from the same api data. Cards still
   appear when a scripted intent clearly matches. Night-ride, logging, undo, split, savings and
   reminder flows stay scripted. Any model error, unknown number or rule slip falls back.
   Two weeks: THIS week is api.dailyPlan() (Mon to today, live). LAST week is the recap week
   (api.data.charges, D.thisWeek, api.weekName()). Present-tense questions ("my cap", "today",
   "how am I doing", "what did I spend") default to THIS week; "last week" picks the recap.
   A bare follow-up ("no, for this week", "and last week?") re-asks the previous question for
   the week named. Without current-week data the recap week is the only week. */
Swap.feature({
  id: "agent",
  title: "Ask Swap",
  pitch: "Ask about tonight, rides, swipes.",
  tab: "chat",
  order: 1,
  // Re-renders itself only on a real profile switch, so a savings change keeps the conversation.
  profileAware: true,

  render(slot, api) {
    const self = this;
    const { el, icon, money, animate, haptic, store, toast, esc } = api;
    const D = api.data, T = D.thisWeek, U = D.usual, PID = api.profile();
    const view = slot.closest(".view");
    let alive = true;
    const wait = ms => new Promise(r => setTimeout(r, api.reduced ? Math.min(ms, 40) : ms));
    const M = (n, d = 0) => `<b class="num">${money(n, d)}</b>`;
    const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, 100 * a / b)) : 0).toFixed(2) + "%";
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const CAT = { dining: "Eating out", drinks: "Alcohol & bodega", delivery: "Delivery", quick: "Coffee & snacks", ride: "Rides", transit: "Subway" };
    const FOODK = ["dining", "drinks", "delivery", "quick"], MOVEK = ["ride", "transit"];
    const UNIT = { week: "a week", order: "an order", meal: "a meal", ride: "a ride", month: "a month" };
    const unitOf = s => UNIT[s.unit] || "each time";
    const quiet = { duration: 200, easing: "cubic-bezier(.2,.9,.3,1)" };
    const AI = () => !!(window.SwapAI && window.SwapAI.available());

    // ---------- Core helpers (with fallbacks while core catches up) ----------
    const allReal = typeof api.allReal === "function" ? api.allReal() : (D.source === "real" && api.isReal("thisWeek") && api.isReal("charges"));
    const isRideApp = n => typeof api.isRideApp === "function" ? api.isRideApp(n) : /lower-fare|rideapp/i.test(String(n || ""));
    const rideAppOK = () => typeof api.rideAppAllowed === "function" ? api.rideAppAllowed() : false;
    const show = n => typeof api.displayMerchant === "function" ? api.displayMerchant(n) : n;
    const badge = field => typeof api.badge === "function" ? api.badge(field) : (api.isReal(field) ? `<span class="real">Real</span>` : `<span class="sample">Sample</span>`);
    const weekPast = () => typeof api.weekIsPast === "function" ? api.weekIsPast() : false;
    const WN = typeof api.weekName === "function" ? api.weekName() : "This week";   // "This week" | "Last week"
    const wn = WN.toLowerCase();
    const capLine = () => typeof api.capLine === "function" ? api.capLine() : `${money(U.total)} usual − ${money(T.saveTarget)} save`;
    const room = () => T.cap - T.total;
    const guessed = () => { const g = store.get("guess"); return !!(g && (!g.week || g.week === D.weekStart)); };
    // Ride apps sorted by price. The lower-fare app only when the founder allowed it.
    const rideApps = () => D.ridePrices.filter(r => rideAppOK() || !isRideApp(r.app)).map(r => Object.assign({}, r, { app: show(r.app) })).sort((a, b) => a.median - b.median);
    // The day the next week starts, from the profile's own week dates.
    function nextWeekLine() {
      const days = typeof api.weekDays === "function" ? api.weekDays() : null;
      const last = days ? days[6].date : null;
      if (!last) return "The week resets Monday.";
      const d = new Date(last + "T12:00:00"); d.setDate(d.getDate() + 1);
      const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      return D.today && D.today >= d.toISOString().slice(0, 10) ? `A new week started ${label}.` : `New week: ${label}.`;
    }
    const todayStamp = () => typeof api.todayLabel === "function" ? api.todayLabel()
      : new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

    // ---------- Starter questions per profile ----------
    const facts0 = api.facts();
    const changeQ = facts0.moved && D.move && D.move.date ? "What changed since I moved?" : "Where's my money going?";
    const hasPlan0 = typeof api.dailyPlan === "function" && !!api.dailyPlan();
    const BASE = {
      you: hasPlan0 ? ["How much can I spend today?", "Am I on track?", "What's my cap this week?", "What's my most unnecessary spending?"] : ["How's my week?", "Can I get dinner tonight?", rideAppOK() ? "Cheaper ride?" : "Cheaper way to class?", changeQ],
      mealplan: ["How's my week?", "Should I use my swipes?", "Can I get pizza tonight?", changeQ],
      social: ["How's my week?", "Dinner with friends tonight?", "Is Uber One worth it?", "Where's my money going?"]
    };
    const MORE = ["Help me save money", "Is DashPass worth it?", "Save $50 a week", "Remind me Sunday"];
    const PROMPTS = BASE[PID] || BASE.you;

    // ---------- Shell ----------
    // Real data: no header note at all. Sample profiles keep one small badge.
    const note = allReal ? "" : `${badge()}${AI() ? "Sample student" : "Scripted demo"}`;
    const root = el(`<div class="ag">
      ${note ? `<p class="ag-note t-foot t-3">${note}</p>` : ""}
      <p class="ag-stamp t-cap t-3">${esc(todayStamp())}</p>
      <div class="ag-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation with Swap"></div>
      <p class="vh" role="status" data-typing></p>
      <div class="ag-dock">
        <form class="ag-composer glass strong" autocomplete="off">
          <label class="vh" for="ag-input">Message Swap</label>
          <input id="ag-input" class="t-body" type="text" enterkeyhint="send" autocapitalize="sentences" spellcheck="true" placeholder="Message" maxlength="160">
          <button type="submit" class="ag-send" aria-label="Send" disabled>${icon("arrowUp", 20, 2.4)}</button>
        </form>
      </div></div>`);
    slot.appendChild(root);
    const log = root.querySelector(".ag-log"), typingStatus = root.querySelector("[data-typing]");
    const form = root.querySelector("form"), input = form.querySelector("input"), sendBtn = form.querySelector(".ag-send");
    this._view = view; this._input = input;

    input.addEventListener("input", () => { sendBtn.disabled = !input.value.trim(); });
    form.addEventListener("submit", e => {
      e.preventDefault();
      const t = input.value.trim(); if (!t) return;
      input.value = ""; sendBtn.disabled = true;
      send(t);
    });

    const toBottom = (smooth = true) => { if (view && alive) view.scrollTo({ top: view.scrollHeight, behavior: smooth && !api.reduced ? "smooth" : "auto" }); };
    const onTab = e => { if (e.detail === "chat") { requestAnimationFrame(() => toBottom(false)); if (AI()) setTimeout(() => alive && window.SwapAI.prewarm(context(), { rideApp: rideAppSuggestOK() }), 300); } };
    document.addEventListener("swap:tab", onTab);
    // A real profile switch rebuilds the chat. A savings change (same profile) keeps it.
    function rerender() {
      dispose();
      slot.replaceChildren();
      const r = self.render(slot, api);
      self._dispose = typeof r === "function" ? r : null;
    }
    const onProfile = e => { if (alive && e.detail && e.detail !== PID) rerender(); };
    document.addEventListener("swap:profile", onProfile);
    // Guessing on the Week tab unlocks the opening line, if nothing has been asked yet.
    const offGuess = store.on ? store.on("guess", () => { if (alive && log.querySelectorAll(".ag-turn.me").length === 0) setTimeout(() => alive && rerender(), 0); }) : null;

    // ---------- Message primitives ----------
    function turn(who) {
      const t = el(`<div class="ag-turn ${who}"${who === "me" ? ' aria-live="off"' : ""}></div>`);
      log.appendChild(t);
      return t;
    }
    function fadeIn(node, origin) {
      if (origin) node.style.transformOrigin = origin;
      return animate(node, [{ opacity: 0, transform: "translateY(6px) scale(.98)" }, { opacity: 1, transform: "none" }], quiet);
    }
    function addUser(text) {
      const t = turn("me");
      const b = el(`<div class="ag-b me t-body"><span class="vh">You: </span>${esc(text)}</div>`);
      t.appendChild(b);
      fadeIn(b, "100% 100%");
      toBottom();
    }
    // ONE bubble per answer (1 or 2 short sentences). A hidden "Swap:" tells AT who spoke.
    // When the model answered, `override` holds its bubble and replaces the next scripted say().
    let override = null;
    async function say(stack, lines) {
      if (override) { const o = override; override = null; placeModel(stack, o); await wait(120); return; }
      if (!alive) return;
      const first = !stack.querySelector(".ag-b");
      const b = el(`<div class="ag-b bot t-body">${first ? '<span class="vh">Swap: </span>' : ""}${[].concat(lines).filter(Boolean).join(" ")}</div>`);
      stack.appendChild(b);
      fadeIn(b, "0 100%");
      toBottom();
      await wait(140);
    }
    let signed = false;   // the signature motion runs once per conversation
    async function card(stack, node) {
      if (!alive) return node;
      stack.appendChild(node);
      if (!signed && !api.reduced) {
        signed = true;
        node.style.transformOrigin = "50% 100%";
        animate(node, [{ opacity: 0, transform: "translateY(36px) scale(.9)" }, { opacity: 1, transform: "none" }], { preset: "gentle" });
        const fills = node.querySelectorAll("[data-grow]");
        fills.forEach((f, k) => animate(f, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { preset: "gentle", delay: 180 + k * 90 }));
      } else fadeIn(node);
      toBottom();
      await wait(200);
      return node;
    }
    // Buttons that act inside the answer. A pressed button is never disabled (focus stays on it).
    function actions(stack, list) {
      if (!alive) return null;
      const row = el(`<div class="ag-actions"></div>`);
      list.forEach(a => {
        const b = el(`<button type="button" class="btn small ${a.primary ? "primary" : "secondary"}">${a.icon ? icon(a.icon, 16, 2.2) : ""}<span>${esc(a.label)}</span></button>`);
        b.addEventListener("click", () => { if (b.getAttribute("aria-disabled") === "true") return; a.run(b); });
        row.appendChild(b);
      });
      stack.appendChild(row);
      fadeIn(row);
      toBottom();
      return row;
    }
    function markDone(b, label) {
      b.className = "btn small accent";
      b.setAttribute("aria-disabled", "true");
      b.innerHTML = icon("check", 16, 2.4) + `<span>${esc(label)}</span>`;
    }
    function typing(stack) {
      const t = el(`<div class="ag-b bot ag-typing" aria-hidden="true"><i></i><i></i><i></i></div>`);
      stack.appendChild(t);
      typingStatus.textContent = "Swap is typing";
      toBottom();
      return () => { t.remove(); typingStatus.textContent = ""; };
    }
    const guessButton = stack => actions(stack, [{ label: "Guess your week", icon: "chevron", primary: true, run: () => { haptic(); api.open("guess"); } }]);

    // ---------- Data helpers ----------
    const charges = () => api.charges();
    const lastRows = () => D.weekly.slice(-6);
    const usualOf = k => Math.round(lastRows().reduce((s, r) => s + (r[k] || 0), 0) / lastRows().length);
    const weekOf = k => charges().filter(c => c.kind === k).reduce((s, c) => s + c.amount, 0);
    const byTime = (a, b) => (a.day - b.day) || String(a.time || "").localeCompare(String(b.time || ""));
    const vsUsual = (now, usual) => {
      const d = now - usual;
      if (Math.abs(d) <= Math.max(5, usual * .05)) return `about your usual ${M(usual)}`;
      return d < 0 ? `${M(-d)} under your usual ${M(usual)}` : `${M(d)} above your usual ${M(usual)}`;
    };
    // A brand for a swap's logo (Chipotle, DashPass, MTA for the subway, the ride app for a split ride).
    const brandOf = s => {
      const text = `${s.title} ${s.detail || ""}`;
      if (api.logo(s.title)) return s.title;
      if (/subway|train/i.test(text)) return "MTA";
      if (api.logo(text)) return text;
      if (/\bride\b/i.test(text)) { const c = charges().find(x => x.kind === "ride" && !x.night && x.tag === "out" && api.logo(x.merchant)); return c ? show(c.merchant) : null; }
      return null;
    };
    // Median price of one meal out this week (the student's own number).
    function typicalMeal() {
      const a = charges().filter(c => c.kind === "dining").map(c => c.amount).sort((x, y) => x - y);
      return a.length ? a[Math.floor(a.length / 2)] : null;
    }
    // Cheapest meal out this week, from their own history.
    function cheapestMeal() {
      const a = charges().filter(c => c.kind === "dining" && c.amount >= 5).sort((x, y) => x.amount - y.amount);
      return a[0] || null;
    }
    // Swipes used per week since move-in (the Wallet's formula).
    function swipePace(mp) {
      const start = D.move && D.move.date ? new Date(D.move.date + "T12:00:00") : null, today = new Date((D.today || "2026-11-01") + "T12:00:00");
      const elapsed = start ? Math.max(1, Math.round((today - start) / 864e5 / 7)) : 10;
      return mp.swipesUsed / elapsed;
    }

    // ---------- Which week ----------
    // weekView("this") = THIS week from api.dailyPlan() (falls back to the recap week when there is
    // no current-week data). weekView("last") = the recap week. `open` is false only while the recap
    // week's total is hidden behind the guess.
    const plan = () => typeof api.dailyPlan === "function" ? api.dailyPlan() : null;
    const sumOf = l => l.reduce((s, c) => s + c.amount, 0);
    const dayIdx = c => typeof api.dayOf === "function" ? api.dayOf(c) : c.day;
    const isNight = c => c.kind === "ride" && (c.tag === "night" || (c.time ? inNight(+c.time.slice(0, 2)) : false));
    const dLabel = d => `${d.dow} ${d.short}`;
    const recapLabel = () => (weekPast() || plan()) ? "Last week" : WN;
    // Bank categories that map onto the food / getting-around kinds.
    const KIND_OF_CAT = { "Eating out": "dining", "Alcohol & bodega": "drinks", "Coffee & snacks": "quick", "Delivery": "delivery", "Rides": "ride", "Subway": "transit" };
    // What counts as cuttable for "most unnecessary". Rides, money to friends, bills and health are not.
    const CUTTABLE = /eating out|shopping|alcohol|bodega|subscription|coffee|snack|delivery|\bfun\b|entertainment|prediction|gambl/i;
    // A charge from dailyPlan(): food/ride charges ({kind, merchant}) or, with whole-bank data, bank
    // items ({cat, name}). Both become { kind (null when not food/ride), cat, merchant, night, day }.
    function normCharge(c) {
      const kind = c.kind || KIND_OF_CAT[c.cat] || null;
      const n = Object.assign({}, c, { kind, merchant: c.merchant || c.name || "", cat: c.cat || CAT[kind] || "Other" });
      n.night = isNight(n);
      n.day = c.cat && !c.kind ? c.day : dayIdx(n);
      return n;
    }
    const topCats = list => { const g = {}; list.forEach(c => { g[c.cat] = (g[c.cat] || 0) + c.amount; }); return Object.entries(g).map(([cat, total]) => ({ cat, total })).sort((a, b) => b.total - a.total); };
    const analysis = () => { const B = PID === "you" && window.SwapLive && window.SwapLive.bank; const A = B && B.analysis; return A && Array.isArray(A.cats) && A.cats.length ? A : null; };
    function weekView(scope) {
      const p = scope === "last" ? null : plan();
      if (p) {
        const all = p.scope === "all";
        const C = (p.charges || []).filter(c => c.amount > 0).map(normCharge);
        const cp = typeof api.capParts === "function" ? api.capParts() : { usual: U.total, save: T.saveTarget };
        return { cur: true, all, label: "This week", lw: "this week", cap: p.cap, spent: p.spent, left: p.left,
          usual: p.usual != null ? p.usual : cp.usual, save: p.save != null ? p.save : cp.save,
          food: sumOf(C.filter(c => FOODK.includes(c.kind))), move: sumOf(C.filter(c => MOVEK.includes(c.kind))),
          charges: C, plan: p, open: true };
      }
      const label = recapLabel();
      return { cur: false, all: false, label, lw: label.toLowerCase(), cap: T.cap, spent: T.total, left: T.cap - T.total,
        food: T.food, move: T.move, charges: charges(), plan: null, open: guessed() };
    }
    // This week, food + getting around only, against the food/ride cap (api.capOf).
    function foodView(v) {
      const cap = typeof api.capOf === "function" ? api.capOf() : T.cap, spent = v.food + v.move;
      return Object.assign({}, v, { all: false, foodCap: true, cap, spent, left: cap - spent, charges: v.charges.filter(c => c.kind) });
    }
    // Last 10 full weeks: food + getting around per category (D.weekly, newest row = the recap week)
    // and the whole bank in/out (private build). Weekly averages, rounded.
    function tenWeeks() {
      const W = (D.weekly || []).slice(-10);
      if (!W.length) return null;
      const avg = (rows, k) => Math.round(rows.reduce((s, w) => s + (w[k] || 0), 0) / rows.length);
      const cats = ["dining", "ride", "drinks", "quick", "delivery", "transit"].map(k => ({ k, avg: avg(W, k) }));
      const BK = PID === "you" && window.SwapLive && window.SwapLive.bank;
      const start = D.current && D.current.weekStart;
      const BW = BK && Array.isArray(BK.weekly) ? BK.weekly.filter(w => !start || w.wk < start).slice(-10) : [];
      return { n: W.length, cats, total: cats.reduce((s, x) => s + x.avg, 0), bank: BW.length ? { n: BW.length, out: avg(BW, "out"), in: avg(BW, "in") } : null };
    }
    // The ride app may be suggested only on the founder's build, and only when he doesn't already use it.
    const rideAppSuggestOK = () => rideAppOK() && !(D.rideAppShare >= 0.8);

    // ---------- Cards ----------
    const head = (title, extra = "") => `<div class="ag-card-h"><h3 class="t-headline">${title}</h3>${extra}</div>`;
    // A week vs its cap (v = weekView(...)). extra = tonight's amount (hatched), shown past the cap if it goes there.
    function capCard(v, extra = 0, extraWord = "Tonight") {
      v = v || weekView("this");
      const spent = v.spent, cap = v.cap, r = cap - spent, max = Math.max(cap, spent + extra), F = v.food, Mv = v.move;
      const capWord = v.all ? "Budget" : "Cap";
      const third = extra ? [extraWord, money(extra)] : ["Left", money(Math.max(0, r))];
      const label = `Spent ${money(spent)} of a ${money(cap)} ${capWord.toLowerCase()}` + (v.all ? ", all spending." : `: food ${money(F)}, getting around ${money(Mv)}.`) +
        (extra ? ` With ${extraWord.toLowerCase()}: ${money(spent + extra)}.` : ` Left: ${money(Math.max(0, r))}.`);
      const title = v.plan ? `${v.foodCap ? "Food + getting around" : "This week"} <span class="t-foot t-3">${esc(v.plan.days[0].short)} to ${esc(v.plan.days[v.plan.today].short)}</span>` : esc(v.label);
      const fills = v.all ? `<i class="ag-pspent" style="width:${pct(spent, max)}"></i>`
        : `<i class="fill-food" style="width:${pct(F, max)}"></i><i class="fill-move" style="width:${pct(Mv, max)}"></i>`;
      const legend = v.all ? `<span><i class="dot ag-dot-spent"></i>All spending ${money(spent)}</span>`
        : `<span><i class="dot food"></i>Food ${money(F)}</span><span><i class="dot move"></i>Getting around ${money(Mv)}</span>`;
      const fine = v.all ? `Budget: usual ${money(v.usual)} − ${money(v.save)} save` : `Cap: ${capLine()}`;
      return el(`<div class="card ag-card">
        ${head(title, v.plan ? "" : badge("thisWeek"))}
        <div class="ag-kv">
          <div><span class="t-foot t-2">Spent</span><b class="num">${money(spent)}</b></div>
          <div><span class="t-foot t-2">${capWord}</span><b class="num">${money(cap)}</b></div>
          <div><span class="t-foot t-2">${third[0]}</span><b class="num">${third[1]}</b></div>
        </div>
        <div class="ag-meter" role="img" aria-label="${esc(label)}">
          <span class="ag-meter-fill" data-grow>${fills}${extra ? `<i class="ag-extra" style="width:${pct(extra, max)}"></i>` : ""}</span>
          <span class="ag-cap" style="left:${pct(cap, max)}"></span>
        </div>
        <div class="ag-legend t-foot t-2">${legend}${extra ? `<span><i class="dot ag-dot-extra"></i>${extraWord}</span>` : ""}</div>
        <p class="ag-fine t-foot t-3">${esc(fine)}</p>
      </div>`);
    }
    // This week and the usual week on one scale, with the cap marked.
    function weekCard() {
      const max = Math.max(T.total, U.total, T.cap);
      const row = (label, f, m) => `<div class="ag-wrow">
          <div class="ag-wtop"><span class="t-sub t-2">${label}</span><b class="num">${money(f + m)}</b></div>
          <div class="ag-bar" role="img" aria-label="${label}: ${money(f + m)}. Food ${money(f)}, getting around ${money(m)}.">
            <span class="ag-meter-fill" data-grow><i class="fill-food" style="width:${pct(f, max)}"></i><i class="fill-move" style="width:${pct(m, max)}"></i></span>
            <span class="ag-cap" style="left:${pct(T.cap, max)}"></span></div></div>`;
      return el(`<div class="card ag-card" role="group" aria-label="${WN} and usual week">
        ${badge("thisWeek") ? `<div class="ag-card-h ag-card-h-end">${badge("thisWeek")}</div>` : ""}
        ${row(WN, T.food, T.move)}
        ${row("Usual week", U.food, U.move)}
        <div class="ag-legend t-foot t-2"><span><i class="dot food"></i>Food</span><span><i class="dot move"></i>Getting around</span><span><i class="ag-tick" aria-hidden="true"></i>Cap ${money(T.cap)}</span></div>
      </div>`);
    }
    // This week's daily plan: spent (fill) vs plan (tick) per day, today marked.
    function planCard(p) {
      const max = Math.max(1, ...p.days.map(d => Math.max(d.plan, d.spent))) * 1.08;
      const rows = p.days.map(d => {
        const done = d.past || d.isToday;
        const aria = `${d.dow} ${d.short}${d.isToday ? ", today" : ""}: plan ${money(d.plan)}${done ? `, spent ${money(d.spent)}` : ""}.`;
        return `<div class="ag-prow${d.isToday ? " on" : ""}${d.past ? " past" : ""}">
          <span class="ag-pday t-sub">${d.isToday ? "Today" : esc(d.dow)}</span>
          <span class="ag-bar thin" role="img" aria-label="${esc(aria)}">
            <span class="ag-meter-fill" data-grow>${done && d.spent > 0 ? `<i class="ag-pspent${d.spent > d.plan ? " over" : ""}" style="width:${pct(d.spent, max)}"></i>` : ""}</span>
            <span class="ag-cap" style="left:${pct(d.plan, max)}"></span></span>
          <span class="ag-pamt t-sub num" aria-hidden="true">${done ? `${money(d.spent)}<span class="t-3"> / ${money(d.plan)}</span>` : `<span class="t-2">${money(d.plan)}</span>`}</span></div>`;
      }).join("");
      return el(`<div class="card ag-card" role="group" aria-label="Daily plan this week">
        ${head("Daily plan", `<span class="t-foot t-2 num">${money(p.spent)} of ${money(p.cap)}</span>`)}
        ${rows}
        <div class="ag-legend t-foot t-2"><span><i class="dot ag-dot-spent"></i>Spent</span><span><i class="ag-tick" aria-hidden="true"></i>Plan</span></div>
      </div>`);
    }
    // Last 10 weeks: weekly average per category, biggest first.
    function avgCard(tw, rows) {
      const max = Math.max(1, ...rows.map(x => x.avg)) * 1.05;
      const html = rows.map(x => `<div class="ag-crow">
          <div class="ag-wtop"><span class="t-sub">${esc(x.label)}</span><b class="num t-sub">${money(x.avg)}</b></div>
          <div class="ag-bar thin" role="img" aria-label="${esc(x.label)}: ${money(x.avg)} a week, last ${tw.n} weeks.">
            <span class="ag-meter-fill" data-grow><i class="${MOVEK.includes(x.k) ? "fill-move" : FOODK.includes(x.k) ? "fill-food" : "ag-pspent"}" style="width:${pct(x.avg, max)}"></i></span></div></div>`).join("");
      return el(`<div class="card ag-card">
        ${head(`Last ${tw.n} weeks`, `<span class="t-foot t-2">a week</span>`)}
        ${html}
        <p class="ag-fine t-foot t-3">Night rides are always OK.</p>
      </div>`);
    }
    // A short list of this week's charges in one category.
    function listCard(title, list, cap = 6) {
      const shown = list.slice(-cap);
      const rows = shown.map(c => `<div class="row">
          ${api.brandMark(show(c.merchant), c.night ? "night" : c.kind, 32)}
          <span class="grow t-sub"><span class="ag-ell">${esc(show(c.merchant))}</span><span class="t-foot t-2">${DAYS[c.day]}${c.time ? " · " + fmtClock(c.time) : ""}${c.night ? " · Night" : ""}</span></span>
          <span class="amt num">${money(c.amount)}</span></div>`).join("");
      const more = list.length - shown.length;
      return el(`<div class="card ag-card">
        ${head(esc(title), badge("thisWeek"))}
        <div class="list">${rows}</div>
        ${more > 0 ? `<p class="ag-fine t-foot t-3">+${more} earlier</p>` : ""}
      </div>`);
    }
    // Weekly bars for one category with the move marked.
    function sparkCard(k, label, moveDate) {
      const W = D.weekly, max = Math.max(1, ...W.map(w => w[k]));
      const idx = Math.max(0, W.findIndex(w => w.wk >= moveDate));
      const col = MOVEK.includes(k) ? "move" : "food";
      const bars = W.map((w, i) => `<i class="${i >= idx ? "fill-" + col : ""}" style="height:${Math.max(2, 100 * w[k] / max).toFixed(1)}%"></i>`).join("");
      const mp = pct(idx, W.length);
      const first = new Date(W[0].wk + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
      return el(`<div class="card ag-card">
        ${head(`${esc(label)} per week`, badge("weekly"))}
        <div class="ag-spark" role="img" aria-label="${esc(label)} per week since ${first}. The bars rise after the move.">
          <div class="ag-bars">${bars}</div><span class="ag-mark" style="left:${mp}"></span></div>
        <div class="ag-axis t-cap t-3" aria-hidden="true"><span>${first}</span><span class="m" style="left:${mp}">Moved</span><span>Now</span></div>
      </div>`);
    }
    // This week vs usual for a few categories.
    function catCard(keys) {
      const rows = keys.map(k => {
        const now = weekOf(k), us = usualOf(k), max = Math.max(now, us, 1) * 1.1;
        const col = MOVEK.includes(k) ? "fill-move" : "fill-food";
        return `<div class="ag-crow">
          <div class="ag-wtop"><span class="t-sub">${CAT[k]}</span><span class="t-sub"><b class="num">${money(now)}</b> <span class="t-2">usual ${money(us)}</span></span></div>
          <div class="ag-bar thin" role="img" aria-label="${CAT[k]}: ${money(now)} ${wn}, usual ${money(us)}.">
            <span class="ag-meter-fill" data-grow><i class="${col}" style="width:${pct(now, max)}"></i></span>
            <span class="ag-cap" style="left:${pct(us, max)}"></span></div></div>`;
      }).join("");
      return el(`<div class="card ag-card">
        ${head(`${WN} vs usual`, badge("thisWeek"))}
        ${rows}
        <div class="ag-legend t-foot t-2"><span><i class="ag-tick" aria-hidden="true"></i>Usual</span></div>
      </div>`);
    }
    function tripCard(subMin, ride) {
      const arrive = 9 * 60 + 5, subLeave = arrive - subMin - 5, rideLeave = arrive - 20;
      const A0 = subLeave - 5, A1 = arrive + 5, x = m => pct(m - A0, A1 - A0);
      const row = (ic, name, leave, price) => `<div class="ag-trow">
          ${api.brandMark(ic === "train" ? "MTA" : name, ic === "train" ? "transit" : "ride", 32)}
          <span class="ag-tn"><b class="t-sub">${esc(name)}</b><span class="t-foot t-2">Leave ${clock(leave)}</span></span>
          <span class="ag-tl" aria-hidden="true"><i class="fill-move" style="left:${x(leave)};width:${pct(arrive - leave, A1 - A0)}"></i></span>
          <span class="amt num">${price}</span></div>`;
      return el(`<div class="card ag-card">
        ${head("9:15 class", `<span class="sample">Sample</span>`)}
        ${row("train", "Subway", subLeave, money(D.subway.fare))}
        ${row("car", ride.app, rideLeave, "~" + money(Math.round(ride.median)))}
        <p class="ag-fine t-foot t-3">Both get you there by 9:05</p>
      </div>`);
    }
    function swapCard(s) {
      return el(`<div class="card ag-card ag-swap">
        ${api.brandMark(brandOf(s), s.kind === "move" ? "move" : "food", 36)}
        <span class="grow"><h3 class="t-headline">${esc(s.title)}</h3><span class="t-sub t-2">${esc(s.detail)}</span><span class="t-foot t-3">${esc(String(s.basis).replace(/\s*→\s*/g, " vs "))}</span></span>
        <span class="ag-save"><b class="num">${money(s.save)}</b><span class="t-foot t-2">${unitOf(s)}</span></span>
      </div>`);
    }
    function evenCard(name, price, perMonth, unitWord, real, student) {
      const per = perMonth > 0 ? price / perMonth : null;
      return el(`<div class="card ag-card">
        <div class="ag-card-h"><span class="ag-brand">${api.brandMark(name, unitWord === "Ride" ? "ride" : "food", 28)}<h3 class="t-headline">${esc(name)}</h3></span>${real}</div>
        <div class="ag-kv">
          <div><span class="t-foot t-2">Price</span><b class="num">${money(price, 2)}</b><span class="t-foot t-3">a month</span></div>
          <div><span class="t-foot t-2">${unitWord}s</span><b class="num">~${perMonth.toFixed(1)}</b><span class="t-foot t-3">a month</span></div>
          <div><span class="t-foot t-2">Per ${unitWord.toLowerCase()}</span><b class="num">${per != null ? money(per, 2) : "n/a"}</b><span class="t-foot t-3">cost each</span></div>
        </div>
        ${student ? `<p class="ag-fine t-foot t-3">Student plan ${money(student, 2)} a month. Student ID needed.</p>` : ""}
      </div>`);
    }
    function swipesCard(mp) {
      const total = mp.swipesUsed + mp.swipesLeft;
      return el(`<div class="card ag-card">
        ${head(esc(mp.name), badge("mealPlan"))}
        <div class="ag-kv">
          <div><span class="t-foot t-2">Swipes left</span><b class="num">${mp.swipesLeft}</b></div>
          <div><span class="t-foot t-2">Used a week</span><b class="num">~${Math.round(swipePace(mp))}</b></div>
          <div><span class="t-foot t-2">Each</span><b class="num">~${money(mp.perSwipe)}</b></div>
        </div>
        <div class="ag-meter" role="img" aria-label="${mp.swipesUsed} of ${total} swipes used, ${mp.swipesLeft} left until ${esc(mp.expires)}.">
          <span class="ag-meter-fill" data-grow><i class="fill-food" style="width:${pct(mp.swipesUsed, total)}"></i></span></div>
        <div class="ag-legend t-foot t-2"><span><i class="dot food"></i>Used ${mp.swipesUsed}</span><span>Hall ${esc(mp.hallHours)}</span><span>Expires ${esc(mp.expires)}</span></div>
      </div>`);
    }
    function nightCard(entry) {
      const n = el(`<div class="card ag-card ag-night">
        ${api.brandMark(entry.app || "", "night", 32)}
        <span class="grow"><h3 class="t-headline">Night ride</h3><span class="t-sub t-2" data-meta></span></span>
        <span class="ag-protect t-foot">${icon("moon", 13, 2.3)}Always OK</span>
      </div>`);
      entry.node = n; paintNight(entry);
      return n;
    }
    function paintNight(e) {
      const meta = e.node.querySelector("[data-meta]");
      meta.textContent = e.undone ? "Removed" : [e.app, e.time, e.amount != null ? money(e.amount) : null].filter(Boolean).join(" · ") || "Late ride";
      e.node.classList.toggle("undone", !!e.undone);
    }
    // Venmo-style request. Opt in, friends only, nothing is sent from Swap.
    function requestCard(item, kindWord) {
      let people = 2;
      const name = show(item.merchant);
      const n = el(`<div class="card ag-card ag-req">
        ${head("Request from friends", badge("thisWeek"))}
        <div class="row">${api.logo(name) ? api.brandMark(name, item.kind || "dining", 28) : ""}<span class="grow t-sub">${esc(name)}${name === kindWord ? "" : ` · ${DAYS[item.day]}`}</span><span class="amt num">${money(item.amount, item.amount % 1 ? 2 : 0)}</span></div>
        <div class="row"><span class="grow t-sub" id="ag-split-${item.id}">Split between</span>
          <span class="ag-seg" role="radiogroup" aria-labelledby="ag-split-${item.id}">${[2, 3, 4].map(p => `<button type="button" class="chip" role="radio" aria-checked="${p === people}" tabindex="${p === people ? 0 : -1}" data-p="${p}">${p}</button>`).join("")}</span></div>
        <div class="row"><span class="grow t-headline">Each friend sends</span><b class="num ag-each" aria-live="polite"></b></div>
        <div class="ag-actions"><button type="button" class="btn small primary" data-copy>${icon("share", 16, 2.2)}<span>Copy request</span></button></div>
        <p class="ag-fine t-foot t-3">Nothing is sent from Swap.</p>
      </div>`);
      const each = () => Math.round(item.amount / people * 100) / 100;
      const fmtEach = () => money(each(), each() % 1 ? 2 : 0);
      const seg = n.querySelector(".ag-seg"), out = n.querySelector(".ag-each");
      const paint = () => {
        out.textContent = fmtEach();
        seg.querySelectorAll("[data-p]").forEach(b => { const on = +b.dataset.p === people; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; });
      };
      seg.addEventListener("click", e => { const b = e.target.closest("[data-p]"); if (!b) return; haptic(); people = +b.dataset.p; paint(); });
      seg.addEventListener("keydown", e => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return;
        e.preventDefault(); people = 2 + ((people - 2 + d + 3) % 3); paint(); seg.querySelector(`[data-p="${people}"]`).focus();
      });
      n.querySelector("[data-copy]").addEventListener("click", async () => {
        // "Tonight: your share is $40" (no "Tonight at Tonight"); "Ride at Uber (Fri): ..." otherwise.
        const what = name === kindWord ? kindWord : `${kindWord} at ${name} (${DAYS[item.day]})`;
        const text = `${what}: your share is ${fmtEach()}`;
        try { await navigator.clipboard.writeText(text); toast("Request copied", "check"); }
        catch (e) { toast(`Copy failed. ${fmtEach()} each`, "x"); }
      });
      paint();
      return n;
    }
    function suggestCard(list, label = "Questions to ask") {
      const n = el(`<div class="card flat ag-card ag-suggest" role="group" aria-label="${esc(label)}"><div class="list"></div></div>`);
      const l = n.firstElementChild;
      list.forEach(p => {
        const b = el(`<button type="button" class="row ag-sugg t-body"><span class="grow">${esc(p)}</span>${icon("chevron", 16, 2.2)}</button>`);
        b.addEventListener("click", () => send(p));
        l.appendChild(b);
      });
      return n;
    }

    // ---------- Parsing ----------
    function clock(min) { const h = Math.floor(min / 60), m = min % 60; return `${(h % 12) || 12}:${String(m).padStart(2, "0")}`; }
    function fmtClock(hhmm) { const h = +hhmm.slice(0, 2); return `${(h % 12) || 12}:${hhmm.slice(3)} ${h < 12 ? "AM" : "PM"}`; }
    function parseTime(t) {
      if (/\bmidnight\b/.test(t)) return { h: 0, label: "12:00 AM" };
      const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s?(a\.?m\.?|p\.?m\.?)(?![a-z])/);
      if (!m || +m[1] > 12) return null;
      const pm = m[3][0] === "p", h = (+m[1] % 12) + (pm ? 12 : 0);
      return { h, label: `${(+m[1] % 12) || 12}:${m[2] || "00"} ${pm ? "PM" : "AM"}` };
    }
    function parseAmount(t) {
      const m = t.match(/\$\s?(\d{1,4}(?:\.\d{1,2})?)/) || t.match(/\b(\d{1,4}(?:\.\d{1,2})?)\s?(?:dollars|bucks)\b/);
      return m ? Math.round(+m[1] * 100) / 100 : null;
    }
    const bareAmount = t => { const m = t.match(/^\s*(?:about|around|like|maybe|it's|its|it was|was)?\s*\$?\s?(\d{1,4}(?:\.\d{1,2})?)\s*(?:dollars|bucks)?\s*[.?]?\s*$/); return m ? +m[1] : null; };
    const inNight = h => h >= D.nightWindow.start || h < D.nightWindow.end;
    const RIDE = /\b(ride|rides|uber|ubers|lyft|lyfts|cab|cabs|taxi|rideshare|rideapp)\b/;
    const FOODS = ["sushi", "pizza", "ramen", "thai", "tacos", "taco", "burger", "burgers", "chipotle", "pho", "wings", "poke", "takeout", "delivery", "doordash", "food", "dinner", "lunch", "brunch", "drinks", "boba", "coffee"];
    const SOCIAL = /\b(friends?|girls|guys|roommates?|date|drinks|bar|bars|party|birthday|brunch with|out with|night out|going out|group|club)\b/;
    const hasFood = t => FOODS.some(f => new RegExp(`\\b${f}\\b`).test(t));
    function focusOf(t) {
      if (/\bdeliver(y|ies|ed)?\b|doordash|grubhub|seamless/.test(t)) return "delivery";
      if (/\bcoffee|snacks?|boba\b/.test(t)) return "quick";
      if (/alcohol|\bbooze|liquor|\bbeer|\bwine|bodega|\bdeli\b|\bbars?\b|\bdrinking\b/.test(t)) return "drinks";
      if (/eat(ing)? out|restaurants?|dining out/.test(t)) return "dining";
      if (RIDE.test(t)) return "ride";
      if (/\bsubway|metro|\bmta\b|\btrains?\b/.test(t)) return "transit";
      if (/\bfood|eat|eating|meals?\b/.test(t)) return "food";
      if (/getting around|transport/.test(t)) return "move";
      return null;
    }

    let pending = null;   // { type: "tonight" | "night", ... } waiting for a typed amount
    const norm = raw => String(raw).toLowerCase().replace(/[’']/g, "'").replace(/uber ?eats/g, "delivery");
    // "last" | "this" | null. Present tense with no week named is null, which the handlers read as THIS week.
    function scopeOf(t) {
      if (/\b(last|past|previous|prior) week\b|\bweek before\b|\blast weekend\b|\brecap\b/.test(t)) return "last";
      if (/\b(this|current) week\b|\bso far\b|\btoday\b|\btonight\b|\bright now\b|\bthis weekend\b/.test(t)) return "this";
      return null;
    }
    // A bare correction or follow-up: "no for this week", "I meant last week", "and today?".
    function followScope(t) {
      const s = t.replace(/[^a-z ]/g, " ")
        .replace(/\b(no|nope|nah|not|that|i|mean|meant|asked|asking|what|about|how|and|but|for|in|ok|okay|only|just|so|um|actually|wait|please|the|is|it|was|of|my|said|then|same|one)\b/g, " ")
        .replace(/\s+/g, " ").trim();
      if (/^(this|current) week$|^so far$|^now$|^right now$/.test(s)) return "this";
      if (/^(last|past|previous|prior) week$|^week before$/.test(s)) return "last";
      if (/^(today|tonight)$/.test(s)) return "today";
      return null;
    }
    function intentOf(raw) {
      const t = norm(raw), it = intentRaw(raw);
      if (!it.scope) it.scope = scopeOf(t);
      return it;
    }
    function intentRaw(raw) {
      const t = norm(raw);
      if (/^\s*(undo|undo that|undo it|revert|take that back)\b/.test(t) || /\bundo\b/.test(t)) return { id: "undo" };
      // Settings: reminders and the weekly savings amount.
      if (/\b(turn off|stop|disable|no more|mute|cancel|pause)\b.*\b(reminders?|notifications?|alerts?)\b|\bdon't remind\b|\b(reminders?|notifications?) off\b/.test(t)) return { id: "remind", on: false };
      if (/\bremind me\b|\b(turn on|enable|start)\b.*\b(reminders?|notifications?)\b|\b(reminders?|notifications?) on\b/.test(t))
        return { id: "remind", on: true, daily: /\b(daily|every day|each day|every morning|tag)\b/.test(t) };
      const saveAmt = t.match(/\b(?:save|saving|savings?)\b(?:\s+(?:target|goal|amount))?(?:\s+(?:to|at|of))?\s+\$?\s?(\d{1,4})\b(?!\s*(?:on|at|for|by)\b)/);
      if (saveAmt && !/\btonight|dinner|lunch|order|meal|split\b/.test(t)) return { id: "setsave", amount: +saveAmt[1] };
      if (/\b(change|set|update|lower|raise|adjust|edit)\b.*\b(savings?|save (target|goal|amount))\b|\bhow much (am i|do i) sav/.test(t)) return { id: "setsave", amount: null };
      const time = parseTime(t), amount = parseAmount(t);
      const ride = RIDE.test(t), home = /\bhome\b/.test(t);
      const nightish = /\b(night|tonight|midnight|late[\s-]?night|after the bar|after the party)\b/.test(t) || (time && inNight(time.h));
      const strongNight = /\b(last night|late[\s-]?night|midnight)\b/.test(t) || /\bnight\b/.test(t.replace(/tonight/g, "")) || (time && inNight(time.h));
      const asking = /\b(should|can i|could i|do i|would|is it|worth)\b|\?/.test(t);
      // 1. Night rides: any question about skipping, walking or the subway instead.
      if ((ride || home) && nightish && /\b(skip|skipping|walk|walking|subway|train|bus|not take|without)\b/.test(t)) return { id: "protect" };
      if ((ride || home) && nightish && /\b(save|saving|cut|cutting)\b/.test(t) && !/\bcheap|cheaper|cheapest|app\b/.test(t)) return { id: "protect" };
      // 2. Log a night ride only when they clearly took one.
      if (ride && strongNight && !asking && /\b(took|taken|had to take|got|caught|grabbed|rode|ubered|lyfted|called)\b/.test(t))
        return { id: "night", time: time ? time.label : null, amount, app: (t.match(/\b(uber|lyft|cab|taxi|rideapp)\b/) || [])[1] };
      if (/\b(dashpass|dash pass|uber one|uber\+|uber plus|membership|subscription)\b/.test(t) || (/worth it/.test(t) && /doordash|uber|delivery/.test(t)))
        return { id: "member", which: /dash/.test(t) || /delivery|doordash/.test(t) ? "DashPass" : /uber/.test(t) ? "Uber One" : null };
      if (/\b(split|splitting|venmo|go halves|share the (ride|bill|cab|check))\b/.test(t))
        return { id: "split", what: ride || /\b(cab|car)\b/.test(t) ? "ride" : /dinner|bill|check|food|meal|bar|drinks|brunch|lunch|tab/.test(t) ? "dinner" : null };
      // Cheaper ride app (Uber vs Lyft, or the founder's own ride app).
      if (ride && /\b(cheap|cheaper|cheapest|less|save|saving|which app|best app|instead)\b/.test(t) && !/\bclass(es)?\b|commute|campus/.test(t)) return { id: "rideapp" };
      // This-week questions: biggest spending, today, cap, daily plan, on track, charges list.
      if (/unnecessary|wasteful|\bwast(e|ing)\b|biggest (spend|expense|categor|thing|cost)|spend(ing)? (the )?most|most (money|spending|expensive)|where('s| is| does) (all )?my money|money go(ing|es)|what (can|should) i cut|what to cut|cut back on what/.test(t))
        return { id: "biggest", most: !/unnecessary|wast|\bcut\b|cuttable/.test(t) };
      const lastQ = /\b(last|past|previous|prior) week\b/.test(t);
      if (/\b(today|tonight)\b/.test(t) && /\bspend|\bleft\b|\bcap\b|budget|\bplan\b|can i|do i have|how much/.test(t) && !lastQ && !hasFood(t) && !SOCIAL.test(t))
        return { id: "today", amount, spentQ: /\b(did|have) i (spend|spent)|\bi spent\b|\bspent today\b/.test(t) };
      if (/how much (can|should|could) i spend|what can i spend/.test(t) && !lastQ)
        return /\b(this|current) week\b|\bweek\b/.test(t) ? { id: "cap" } : { id: "today", amount };
      if (/\bcap\b|\bbudget\b|\blimit\b|\ballowance\b|what('s| is) left|how much('s| is)? left|money left|have left|how much do i have/.test(t) && !/\b(help|stick|make)\b.*\bbudget\b/.test(t))
        return { id: "cap", focus: focusOf(t) };
      if (/daily plan|day[- ]by[- ]day|each day|per day|a day\b|\bmy plan\b|\bthe plan\b|plan for|week'?s plan|rest of the week|days? (left|ahead)/.test(t)) return { id: "plan" };
      if (/on track|on pace|\bpace\b|\bahead\b|\bbehind\b|how am i doing|how'?m i doing|how was i doing|how'?s (my|the) week|how (is|was) (my|the) week|how('s| is) it going|am i (ok|okay|good|fine|doing)|doing (ok|okay|good|well|alright)|how did i do/.test(t))
        return { id: "track" };
      if (/\b(charges|transactions|purchases|receipts)\b|what did i (buy|get)|what have i bought|show (me )?(my )?(spending|charges)|\blist\b/.test(t) && !/subscri|recurring|\bmonth/.test(t)) return { id: "charges", focus: focusOf(t) };
      if (/\bwhy\b|so (much|high)|number (is )?high|went up|\bjump|\bchanged?\b|since i moved|the move\b|where('s| is| does) my money/.test(t))
        return { id: "why", focus: focusOf(t), move: /\bmov(e|ed|ing)\b/.test(t), where: /\bwhere\b/.test(t) };
      if (/\bswipes?\b|meal plan|dining hall|\bthe hall\b/.test(t)) return { id: "swipes" };
      if (/\bclass(es)?\b|commute|campus|to school|lecture/.test(t) || (/\b(subway|train)\b/.test(t) && !nightish))
        return { id: "class", late: /\blate\b|running behind|right now|\bnow\b|rush|hurry|asap|overslept/.test(t) };
      if (/\b(save|saving|cut back|spend less|cheaper|budget)\b/.test(t)) return { id: "save" };
      if (pending && bareAmount(t) != null) return { id: "amount", amount: bareAmount(t) };
      if (/how much (have|did) i (spend|spent)|what did i spend|spent on|spending on|\bthis month\b/.test(t)) return { id: "week", focus: focusOf(t), month: /month/.test(t) };
      if (hasFood(t) || amount != null || SOCIAL.test(t) || /\btonight\b|\bafford\b|can i (do|get|have|order|go)|how much can i spend|\border\b/.test(t)) {
        const food = FOODS.find(f => new RegExp(`\\b${f}\\b`).test(t) && !["food", "dinner", "lunch", "brunch", "drinks", "delivery", "doordash", "takeout"].includes(f));
        return { id: "tonight", amount, social: SOCIAL.test(t), food: food || null, delivery: /deliver|doordash|order in|takeout|tired/.test(t) };
      }
      if (/\bweek\b|how am i|how'?s it going|so far|\bspent\b|\bspend\b|\btotal\b|\bdoing\b/.test(t)) return { id: "week", focus: focusOf(t) };
      if (/^\s*(hi|hey|hello|yo|sup)\b/.test(t)) return { id: "hello" };
      if (/\b(thanks|thank you|thx|ty)\b/.test(t)) return { id: "thanks" };
      return { id: "unknown" };
    }

    // ---------- On-device model (iPhone app, Apple Intelligence) ----------
    // Plain-text facts for the model, one per line, in labeled sections (THIS WEEK, TODAY, DAILY
    // PLAN, LAST WEEK, USUAL WEEK, LAST 10 WEEKS, WHOLE BANK, OTHER). Every line names its own week
    // ("this week", "last week", "today") so a small model can't mix them up, and so hint lines still
    // make sense on their own. Before the guess, last week's spending is left out.
    function context() {
      const f = api.facts(), p = plan(), open = guessed();
      const $ = n => money(Math.round(n)), sum = sumOf;
      const L = [], sec = h => L.push("", `## ${h}`);
      const CU = { dining: ["charge", "charges"], drinks: ["charge", "charges"], delivery: ["order", "orders"], quick: ["charge", "charges"], ride: ["ride", "rides"], transit: ["ride", "rides"] };
      const KINDS = ["dining", "drinks", "quick", "delivery", "ride", "transit"];
      const cp = typeof api.capParts === "function" ? api.capParts() : { usual: U.total, save: T.saveTarget, owed: (T.payback && T.payback.perWeek) || 0 };
      const capWhy = `${$(cp.usual)} usual minus the ${$(cp.save)} you chose to save${cp.owed ? `, minus ${$(cp.owed)} owed` : ""}`;
      const RL = recapLabel(), rl = RL.toLowerCase();
      const wDay = w => new Date(w.wk + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const shown = c => (rideAppOK() || !isRideApp(c.merchant)) ? show(c.merchant) : "Ride app";
      L.push(allReal ? "Source: your real bank data." : "Source: a sample student, not real card data.");
      const all = !!(p && p.scope === "all"), fcap = typeof api.capOf === "function" ? api.capOf() : T.cap;
      if (all) L.push(`Budget this week covers ALL spending out of the bank (except investing). The food + getting around cap (${$(fcap)}) covers only Eating out, Alcohol & bodega, Coffee & snacks, Delivery, Rides, Subway; use it only for food or ride questions, and for last week.`);
      else L.push("The cap covers food and getting around only: Eating out, Alcohol & bodega, Coffee & snacks, Delivery, Rides, Subway. Food = the first four. Getting around = Rides + Subway.");
      if (p) {
        const td = p.days[p.today], v = weekView("this"), C = v.charges, CW = all ? "Budget" : "Cap";
        L.push(`Today is ${td.dow} ${td.short}. "This week" = ${dLabel(p.days[0])} to ${dLabel(p.days[6])}. "Last week" = ${D.weekLabel ? D.weekLabel.replace(/\s*[–-]\s*/, " to ") : "the week before"}.`);
        sec(`THIS WEEK (${dLabel(p.days[0])} to ${dLabel(td)}, so far)`);
        L.push(all ? `Budget this week: ${$(p.cap)}, all spending (usual all-spending week ${$(v.usual)} minus the ${$(v.save)} you chose to save).` : `Cap this week: ${$(p.cap)} (${capWhy}).`);
        L.push(`Spent this week so far: ${$(p.spent)}.`);
        L.push(p.left >= 0 ? `Left this week: ${$(p.left)}.` : `Left this week: $0. Spent ${$(p.spent)} with a ${$(p.cap)} ${CW.toLowerCase()}.`);
        L.push(`Food this week: ${$(v.food)}. Getting around this week: ${$(v.move)}.`);
        if (all) {
          const fs = v.food + v.move;
          L.push(`Food + getting around cap this week: ${$(fcap)} (only for food or ride questions). Spent on food + getting around this week: ${$(fs)}. Left under it: ${$(Math.max(0, fcap - fs))}.`);
          L.push("By category this week: " + (topCats(C).map(x => `${x.cat} ${$(x.total)}`).join(", ") || "nothing yet") + ".");
        } else L.push("By category this week: " + KINDS.map(k => { const l = C.filter(c => c.kind === k); return `${CAT[k]} ${$(sum(l))} (${l.length} ${CU[k][l.length === 1 ? 0 : 1]})`; }).join(", ") + ".");
        const past = p.days.filter(d => d.past), pBefore = past.reduce((s, d) => s + d.plan, 0), sBefore = past.reduce((s, d) => s + d.spent, 0), a = p.aheadBy;
        L.push(p.today === 0 ? "Plan status this week: first day, nothing to compare yet."
          : `Plan status this week: ${Math.abs(a) <= 5 ? "on plan" : a > 0 ? `${$(a)} under plan so far` : `${$(-a)} over plan so far`} (plan before today ${$(pBefore)}, spent before today ${$(sBefore)}).`);
        const nights = C.filter(c => c.night);
        L.push(nights.length ? `Night rides this week (11 PM to 6 AM, always OK): ${nights.length}, ${$(sum(nights))}.` : "Night rides this week: none.");
        const list = C.slice().sort(byTime).slice(-14);
        L.push(list.length ? `Charges this week: ` + list.map(c => `${p.days[c.day] ? p.days[c.day].dow : DAYS[c.day]} ${shown(c)} ${money(c.amount, 2)} (${CAT[c.kind] || c.cat}${c.night ? ", night ride" : ""})`).join("; ") + "." : "Charges this week: none yet.");
        sec(`TODAY (${td.dow} ${td.short})`);
        L.push(`Plan today: ${$(td.plan)}.`);
        L.push(`Spent today: ${$(td.spent)}.`);
        L.push(p.todayLeft >= 0 ? `Left today: ${$(p.todayLeft)}.` : `Left today: $0. ${$(-p.todayLeft)} over today's plan.`);
        sec(`DAILY PLAN (this week: the ${all ? "all-spending budget" : "cap"} split by your usual weekday pattern; what's left is spread over today and the days ahead)`);
        p.days.forEach(d => L.push(`Daily plan ${dLabel(d)}: plan ${$(d.plan)}${d.past ? `, spent ${$(d.spent)} (done)` : d.isToday ? `, spent ${$(d.spent)} so far (today)` : " (ahead)"}.`));
      }
      // The recap week: LAST week on the live build, or the only week on sample profiles.
      sec(`${RL.toUpperCase()} (${D.weekLabel ? D.weekLabel.replace(/\s*[–-]\s*/, " to ") + ", " : ""}Monday to Sunday${p ? ", finished" : ""})`);
      const owed = T.payback && T.payback.perWeek;
      L.push(`Cap ${rl}: ${$(T.cap)} (${capWhy}).`);
      if (!open) {
        L.push(`Spent ${rl}: hidden until you guess your week on the Week tab.`);
      } else {
        const C = charges();
        L.push(`Spent ${rl}: ${$(T.total)}.`);
        const r = T.cap - T.total;
        L.push(r >= 0 ? `Left ${rl}: ${$(r)} under the cap.` : `Left ${rl}: $0. Spent ${$(T.total)} with a ${$(T.cap)} cap, ${$(-r)} above it.`);
        if (T.paidBack > 0) L.push(`Paid back by friends ${rl}: ${$(T.paidBack)} (not taken off).`);
        L.push(`Food ${rl}: ${$(T.food)}. Getting around ${rl}: ${$(T.move)}.`);
        L.push(`By category ${rl}: ` + KINDS.map(k => { const l = C.filter(c => c.kind === k); return `${CAT[k]} ${$(sum(l))} (${l.length} ${CU[k][l.length === 1 ? 0 : 1]})`; }).join(", ") + ".");
        const nights = C.filter(c => c.night);
        L.push(nights.length ? `Night rides ${rl} (11 PM to 6 AM, always OK): ${nights.length}, ${$(sum(nights))}.` : `Night rides ${rl}: none.`);
        L.push(`Spent by day ${rl}: ` + DAYS.map((d, i) => `${d} ${$(sum(C.filter(c => c.day === i)))}`).join(", ") + ".");
        const byM = {};
        C.forEach(c => { const nm = shown(c), m = byM[nm] || (byM[nm] = { name: nm, total: 0 }); m.total += c.amount; });
        const top = Object.values(byM).sort((a, b) => b.total - a.total).slice(0, 8);
        if (top.length) L.push(`Biggest places ${rl}: ` + top.map(m => `${m.name} ${$(m.total)}`).join("; ") + ".");
      }
      sec("USUAL WEEK (food and getting around only, average of the last 6 weeks)");
      L.push(`Usual week (food + getting around): ${$(U.total)}. Usual food: ${$(U.food)}. Usual getting around: ${$(U.move)}.`);
      L.push("Usual by category: " + KINDS.map(k => `${CAT[k]} ${$(usualOf(k))}`).join(", ") + ".");
      if (Array.isArray(D.dayWeights) && D.dayWeights.length === 7) L.push("Usual weekday pattern (share of a week): " + DAYS.map((d, i) => `${d} ${Math.round(D.dayWeights[i] * 100)}%`).join(", ") + ".");
      const A = analysis(), tw = tenWeeks();
      if (A) {
        sec(`WHERE YOUR MONEY GOES (LAST ${A.weeks} WEEKS, all money${A.from ? `, week of ${wDay({ wk: A.from })} to ${new Date(A.to + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""})`);
        L.push(`Out per week, last ${A.weeks} weeks: ${$(A.outPerWeek)}. In per week: ${$(A.inPerWeek)}.`);
        L.push(`Spending by category per week, last ${A.weeks} weeks: ` + A.cats.filter(x => x.perWeek >= 1).map(x => `${x.cat} ${$(x.perWeek)}`).join("; ") + ".");
        if (Array.isArray(A.ins) && A.ins.length) L.push(`Money in by source per week, last ${A.weeks} weeks: ` + A.ins.map(x => `${x.cat} ${$(x.perWeek)}`).join("; ") + ".");
        if (Array.isArray(A.places) && A.places.length) L.push(`Top places, last ${A.weeks} weeks (total): ` + A.places.slice(0, 10).map(x => `${(rideAppOK() || !isRideApp(x.name)) ? show(x.name) : "Ride app"} ${$(x.total)} (${x.count}x)`).join("; ") + ".");
        const cut = A.cats.filter(x => CUTTABLE.test(x.cat)).slice(0, 4);
        if (cut.length) L.push(`Most cuttable per week (for "unnecessary" questions): ` + cut.map(x => `${x.cat} ${$(x.perWeek)}`).join("; ") + ". Rides include night rides, which are always OK.");
      } else if (tw) {
        sec(`LAST ${tw.n} WEEKS (weekly averages, up to ${D.weekLabel ? "last week" : "the latest week"})`);
        L.push(`Food and getting around, last ${tw.n} weeks: ${$(tw.total)} a week. ` + tw.cats.slice().sort((a, b) => b.avg - a.avg).map(x => `${CAT[x.k]} ${$(x.avg)}`).join(", ") + ".");
        if (tw.bank) L.push(`Whole bank, last ${tw.bank.n} weeks: out ${$(tw.bank.out)} a week, in ${$(tw.bank.in)} a week.`);
        const hist = D.weekly.slice(-6, -1).reverse(), wTot = w => $(KINDS.reduce((x, k) => x + (w[k] || 0), 0));
        if (hist.length) L.push(`Earlier weeks, food and getting around, newest first: ` + hist.map(w => `week of ${wDay(w)} ${wTot(w)}`).join("; ") + ".");
      }
      // Whole bank (private build only): every dollar in and out, by category.
      const BK = api.profile() === "you" && window.SwapLive && window.SwapLive.bank;
      if (BK && Array.isArray(BK.items)) {
        sec("WHOLE BANK (every dollar in and out, not only food and getting around)");
        [["now", "Whole bank this week so far"], ["last", "Whole bank last week"]].forEach(([w, title]) => {
          const its = BK.items.filter(i => i.week === w), out = {}, inn = {};
          its.forEach(i => { const m = i.amount > 0 ? out : inn; m[i.cat] = (m[i.cat] || 0) + Math.abs(i.amount); });
          const list = m => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${$(v)}`).join("; ");
          const tot = m => Object.values(m).reduce((a, b) => a + b, 0);
          if (its.length) L.push(`${title}: out ${$(tot(out))} (${list(out) || "nothing"}). In ${$(tot(inn))} (${list(inn) || "nothing"}).`);
        });
        const chk = (BK.balances || []).find(b => b.type === "depository");
        if (chk && chk.current != null) L.push(`Checking balance: ${$(chk.current)}.`);
      }
      sec("OTHER");
      const apps = rideApps();
      apps.forEach(a => L.push(`Typical ${a.app} ride: ${$(a.median)}.`));
      if (rideAppOK() && D.rideAppShare >= 0.8 && apps.length) L.push(`You already take ${apps[0].app} for ${Math.round(D.rideAppShare * 100)}% of rides. Never suggest switching ride apps.`);
      if (rideAppSuggestOK() && apps.length > 1 && isRideApp(D.ridePrices.find(r => show(r.app) === apps[0].app)?.app)) {
        const dear = apps[apps.length - 1];
        L.push(`Cheaper ride app: ${apps[0].app}, about ${$(dear.median - apps[0].median)} less a ride than ${dear.app}. Suggesting ${apps[0].app} is fine, also at night.`);
      }
      if (D.subway) L.push(`Subway ride: ${$(D.subway.fare)}. Weekly fare cap: ${$(D.subway.weeklyCap)}. ${f.subwayMinutes != null ? `Subway to class: about ${f.subwayMinutes} min.` : "No subway on your route."}`);
      (D.priceGaps || []).forEach(g => L.push(`${g.place}: ${$(g.pickup)} pickup vs ${$(g.delivered)} delivered (same order).`));
      (D.memberships || []).forEach(m => {
        const isRide = m.ordersPerWeek == null, word = isRide ? "ride" : "delivery order";
        const perWeek = isRide ? charges().filter(c => c.kind === "ride").length || m.ridesPerWeek : m.ordersPerWeek;
        const perMonth = (perWeek || 0) * 4.33;
        L.push(`${m.name}: ${money(m.price, 2)} a month. Your ${word}s a month: about ${perMonth.toFixed(1)}.` +
          (perMonth > 0 ? ` ${m.name} cost per ${word}: ${money(m.price / perMonth, 2)}. Worth it only if it saves more than that per ${word}.` : "") +
          (m.student ? ` Student plan: ${money(m.student, 2)} a month, Student ID needed.` : ""));
      });
      const P = PID === "you" && api.privateData && api.privateData();
      const subs = P && (P.subscriptions || []).filter(x => x.active);
      if (subs && subs.length) {
        const g = {};
        subs.forEach(x => { const k = g[x.name] || (g[x.name] = { name: x.name, total: 0, n: 0 }); k.total += x.amount; k.n++; });
        L.push(`Subscriptions: ${money(sum(subs), 2)} a month in total. ` + Object.values(g).sort((a, b) => b.total - a.total).map(x => `${x.name} ${money(x.total, 2)}${x.n > 1 ? ` (${x.n} plans)` : ""}`).join("; ") + ".");
      }
      L.push(`Meal plan: ${f.hasMealPlan ? "yes" : "no"}. Kitchen: ${f.kitchen}.`);
      const mp = D.mealPlan;
      if (mp && f.hasMealPlan) L.push(`${mp.name}: ${mp.swipesLeft} swipes left until ${mp.expires}. Swipes used a week: about ${Math.round(swipePace(mp))}. Each swipe: about ${$(mp.perSwipe)}, already paid. Dining hall hours: ${mp.hallHours}.`);
      const mv = D.move;
      if (f.moved && mv && mv.date) {
        const when = new Date(mv.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        L.push(`You moved on ${when}. Rides before the move: ${$(mv.rideSpendBefore)} a week. Rides since the move: ${$(mv.rideSpendAfter)} a week.` +
          (mv.deliverySpendBefore != null ? ` Delivery before: ${$(mv.deliverySpendBefore)} a week. Delivery since: ${$(mv.deliverySpendAfter)} a week.` : ""));
      }
      const list = api.swaps(), pickId = store.get("deckPick");
      const pick = list.find(x => x.id === pickId) || (D.swaps || []).find(x => x.id === pickId);
      L.push(pick ? `Your swap: ${pick.title}, saves about ${$(pick.save)} ${unitOf(pick)}.` : `Your swap: none chosen yet.`);
      const next = list.find(x => x.id !== pickId && (rideAppSuggestOK() || !(x.rideApp || isRideApp(`${x.title} ${x.detail || ""}`))));
      if (next) L.push(`Swap idea (only when asked how to save): ${next.title}. ${next.detail} Saves about ${$(next.save)} ${unitOf(next)}.`);
      L.push("Night rides (11 PM to 6 AM) count as spending but are always OK: never suggest skipping one, walking, or the subway at night.");
      return L.join("\n");
    }

    // Cleans a model answer to the house style. Returns plain text.
    function clean(t) {
      let s = String(t || "")
        .replace(/\*\*|__|`/g, "").replace(/^\s*#+\s*/gm, "").replace(/^\s*[-•*]\s+/gm, "")
        .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
        .replace(/(\d)\s*[–—]\s*(\$?\d)/g, "$1 to $2")
        .replace(/\s*[—–]\s*/g, ", ")
        .replace(/!+/g, ".")
        .replace(/\bover (your |the )?budget\b/gi, "above the cap")
        .replace(/\bprotected\b/gi, "always OK")
        .replace(/\broom left\b/gi, "left")
        .replace(/\s+/g, " ").trim();
      s = s.replace(/^(sure|okay|ok|of course|great question|good question|absolutely|certainly|got it|alright)[,.]?\s+/i, "")
        .replace(/^(based on|according to) (the |your )?(data|numbers)( provided)?,\s*/i, "")
        .replace(/,\s*\./g, ".").replace(/\.{2,}/g, ".");
      return s.replace(/^[a-z]/, c => c.toUpperCase());
    }
    // Every dollar amount in the answer must be in the context or the question (rounding allowed).
    function numbersOK(s, src) {
      const pool = (src.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(x => +x.replace(/,/g, ""));
      const found = (s.match(/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?/g) || []).map(x => +x.replace(/[$,\s]/g, ""));
      return found.every(n => pool.some(p => Math.abs(p - n) <= 0.51));
    }
    // Final checks. Returns one bubble's HTML, or null to fall back to the scripted answer.
    // chk (from checksFor): must = dollar amounts the answer has to contain (the exact number asked
    // for); forbid = amounts that would mean the wrong week; single = a one-number question, so no
    // comparisons with the usual week.
    function finalize(raw, question, src, chk = {}) {
      const s = clean(raw);
      if (!s || s.length < 2 || /[<>{}\[\]]/.test(s)) return null;
      const q = question.toLowerCase();
      // The ride app is suggested only where rideAppSuggestOK(); he already uses it for almost every ride.
      if (!rideAppSuggestOK() && /lower[- ]fare|rideapp|ride app/i.test(s) && /\b(try|use|using|switch|take|book|go with|cheaper|instead|stick)\b/i.test(s)) return null;
      const nightQ = RIDE.test(q) && (/\b(night|late|midnight|after the (bar|party))\b/.test(q) || (parseTime(q) && inNight(parseTime(q).h)));
      if (nightQ && /\b(skip|walk|walking|subway|train)\b/i.test(s) && !/don't skip/i.test(s.replace(/[’]/g, "'"))) return null;
      if (/\bnight\b/i.test(s) && /\b(skip|walk|walking|subway|train)\b/i.test(s) && !/don't skip|always ok/i.test(s.replace(/[’]/g, "'"))) return null;
      if (!numbersOK(s, src)) return null;
      const found = (s.match(/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?/g) || []).map(x => +x.replace(/[$,\s]/g, ""));
      const has = n => found.some(x => Math.abs(x - n) <= 0.51);
      if ((chk.must || []).some(n => !has(n))) return null;
      if ((chk.forbid || []).some(n => has(n))) return null;
      if (chk.single && /\b(usual|average|last week|compared?|than)\b/i.test(s) && !/\b(usual|average|compare|last week|than)\b/.test(q)) return null;
      // Precise labels: the getting-around total is not "rides".
      const rides = Math.round(weekOf("ride")), move = Math.round(T.move);
      if (rides !== move && new RegExp(`\\brides?\\b[^.]*\\$${move}\\b`, "i").test(s)) return null;
      if (!guessed() && new RegExp(`\\$${Math.round(T.total)}\\b`).test(s)) return null;
      let sentences = s.split(/(?<=[.?])\s+(?=[A-Z$"'0-9])/).map(x => x.trim()).filter(Boolean);
      const wantsIdea = /\b(save|saving|cheaper|cheapest|cut|less|budget|afford|worth|instead|should i|unnecessary|waste|wasteful)\b/.test(q);
      const SUGGEST = /\b(you (can|could|should|might) (try|use|take|skip|switch|swap|order|pick)|try |instead|switch to|consider)\b/i;
      sentences = sentences.filter(x => !/\bskip/i.test(x) || /don't skip/i.test(x.replace(/[’]/g, "'")));
      if (!wantsIdea) sentences = sentences.filter(x => !SUGGEST.test(x));
      if (sentences.length > 1) sentences = sentences.filter(x => !/\b(can only see|can't see|cannot see)\b/i.test(x));
      sentences = sentences.slice(0, 2);
      if (!sentences.length) return null;
      const out = sentences.join(" ");
      if ((chk.must || []).some(n => !(out.match(/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?/g) || []).some(x => Math.abs(+x.replace(/[$,\s]/g, "") - n) <= 0.51))) return null;
      return esc(out).replace(/\$\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/g, m => `<b class="num">${m}</b>`);
    }
    // Which week a question is about, for the model: THIS WEEK unless "last week" was named.
    const isThis = it => it.scope !== "last" && !!plan();
    // The context lines most likely to answer (matched by line start).
    function hintsFor(it) {
      const ms = (D.memberships || []).map(m => m.name);
      const rl = recapLabel().toLowerCase();
      const W = isThis(it) ? "this week" : rl;
      switch (it.id) {
        case "cap": return !isThis(it) ? [`Cap ${rl}`, `Spent ${rl}`, `Left ${rl}`] : it.focus && plan().scope === "all" ? ["Food + getting around cap this week", "Food this week"] : ["Budget this week", "Cap this week", "Spent this week", "Left this week"];
        case "today": return plan() ? ["Plan today", "Spent today", "Left today", "Left this week"] : [`Cap ${rl}`, `Left ${rl}`];
        case "plan": return plan() ? ["Daily plan", "Budget this week", "Cap this week", "Left this week"] : [`Cap ${rl}`];
        case "track": return isThis(it) ? ["Plan status this week", "Spent this week", "Left this week", "Left today"] : [`Spent ${rl}`, `Cap ${rl}`, `Left ${rl}`];
        case "charges": return isThis(it) ? ["Charges this week", "Spent this week"] : [`Biggest places ${rl}`, `Spent ${rl}`];
        case "biggest": return it.scope ? [`By category ${W}`, isThis(it) ? "Charges this week" : `Biggest places ${rl}`] : analysis() ? (it.most ? ["Spending by category per week", "Top places"] : ["Most cuttable", "Spending by category per week"]) : ["Food and getting around, last", "Whole bank, last", "Whole bank last week", "Subscriptions"];
        case "week":
          if (it.month) return ["Food and getting around, last", "Earlier weeks", "Whole bank, last"];
          if (it.focus === "food" || it.focus === "move") return isThis(it) ? ["Food this week"] : [`Food ${rl}`];
          if (it.focus && CAT[it.focus]) return [`By category ${W}`];
          return isThis(it) ? ["Spent this week", "By category this week", "Budget this week", "Cap this week"] : [`Spent ${rl}`, `Food ${rl}`, `Cap ${rl}`];
        case "tonight": return (plan() ? ["Left today", "Left this week"] : [`Left ${rl}`, `Cap ${rl}`]).concat(it.delivery ? (D.priceGaps || []).slice(0, 1).map(g => `${g.place}:`) : []);
        case "why": return isThis(it) && !it.move ? ["Plan status this week", "By category this week", "Charges this week"] : [`Spent ${rl}`, `By category ${rl}`, "Usual by category"].concat(it.move ? ["You moved"] : []);
        case "member": return it.which ? [`${it.which}:`] : ms.map(n => `${n}:`);
        case "swipes": return D.mealPlan ? [`${D.mealPlan.name}:`, `By category ${W}`] : ["Meal plan:"];
        case "class": return ["Subway ride", "Typical", "Swap idea"];
        case "rideapp": return ["Typical", "Cheaper ride app", "You already take"];
        case "save": return ["Swap idea", "Most cuttable", "Food and getting around, last"];
        default: return [];
      }
    }
    // Numbers the model's answer must contain (the exact thing asked) or must not (the other week).
    function checksFor(it, q) {
      const p = plan(), r = n => Math.round(n), lastAsked = /\b(last|past|previous) week\b|\busual\b/.test(q.toLowerCase());
      const forbid = p && isThis(it) && !lastAsked && guessed() ? [r(T.total), r(T.total - U.total)].filter(n => n > 0 && n !== r(p.spent) && n !== r(p.cap) && n !== r(p.left)) : [];
      const single = ["cap", "today", "track", "plan", "week", "charges"].includes(it.id);
      let must = [];
      if (it.id === "cap") must = !isThis(it) ? [r(T.cap)] : it.focus && p.scope === "all" ? [r(typeof api.capOf === "function" ? api.capOf() : T.cap)] : [r(p.cap)];
      if (it.id === "today" && p && it.amount == null) must = [r(it.spentQ ? p.days[p.today].spent : Math.max(0, p.todayLeft))];
      if (it.id === "track" && p && isThis(it) && p.today > 0 && Math.abs(p.aheadBy) > 5) must = [Math.abs(p.aheadBy)];
      if (it.id === "plan" && p) must = [r(p.days[p.today].plan)];
      if (it.id === "week" && !it.focus && !it.month && isThis(it)) must = [r(p.spent)];
      return { must, forbid, single };
    }
    const hist = [];   // last two exchanges (scripted or model), for follow-ups like "and the week before?"
    const CARD_INTENTS = new Set(["week", "why", "member", "swipes", "class", "save", "tonight", "cap", "plan", "track", "biggest", "charges", "today"]);
    const MODEL_INTENTS = new Set([...CARD_INTENTS, "unknown"]);
    const NOT_CARD = /subscri|recurring|hulu|apple|anthropic|netflix|spotify|streaming|\bmonth/i;
    const GATED = new Set(["week", "why", "tonight", "charges", "track"]);
    function cardFits(it, q) {
      if (!CARD_INTENTS.has(it.id)) return false;
      if (NOT_CARD.test(q) && !(it.id === "member" && it.which)) return false;
      if (it.id === "week") return !it.month;
      return true;
    }
    // Asks the model, streaming into one live bubble (hidden from VoiceOver until final).
    // q is the question as the student meant it (a follow-up is rewritten to the full question).
    async function askModel(q, it, stack, stopTyping) {
      let live = null, halted = false;
      const halt = () => { if (!halted) { halted = true; stopTyping(); } };
      const ctx = context();
      // The scripted intent picks the DATA lines most likely to answer; the small model leans on them.
      const hints = hintsFor(it);
      const rel = hints.length ? ctx.split("\n").filter(l => hints.some(h => l.startsWith(h))) : [];
      const p = plan();
      const which = !p || (it.id === "unknown" && !it.scope) ? "" : it.id === "biggest" && !it.scope ? (analysis() ? `WHERE YOUR MONEY GOES (LAST ${analysis().weeks} WEEKS)` : "LAST 10 WEEKS") : it.id === "today" || (it.id === "tonight" && it.scope !== "last") ? `TODAY (${dLabel(p.days[p.today])})`
        : isThis(it) ? `THIS WEEK (${dLabel(p.days[0])} to ${dLabel(p.days[p.today])})` : `LAST WEEK (${D.weekLabel || ""})`;
      const asked = `${q}` + (which ? `\nWeek asked about: ${which}.` : "") + (rel.length ? `\nRelevant facts:\n${rel.join("\n")}` : "");
      const prompt = hist.length ? `Earlier in this chat:\n${hist.map(h => `Student: ${h.q}\nSwap: ${h.a}`).join("\n")}\n\nNew question: ${asked}` : asked;
      try {
        const raw = await window.SwapAI.ask(prompt, ctx, { rideApp: rideAppSuggestOK(), onPartial: t => {
          if (!alive) return;
          const c = clean(t); if (!c) return;
          halt();
          if (!live) { live = el(`<div class="ag-b bot t-body" aria-hidden="true"></div>`); stack.appendChild(live); fadeIn(live, "0 100%"); }
          live.textContent = c;
          toBottom(false);
        } });
        const html = alive ? finalize(raw, q, ctx + "\n" + prompt, checksFor(it, q)) : null;
        if (!html) throw new Error("rejected: " + raw);
        halt();
        return { html, live, card: cardFits(it, q) };
      } catch (e) {
        console.warn("[agent] on-device answer not used:", e && e.message);
        if (live) live.remove();
        halt();
        return null;
      }
    }
    // Puts the model's answer where the live bubble was: one bubble, no re-animation.
    function placeModel(stack, o) {
      const n = el(`<div class="ag-b bot t-body">${!stack.querySelector(".ag-b:not([aria-hidden])") ? '<span class="vh">Swap: </span>' : ""}${o.html}</div>`);
      if (o.live && o.live.isConnected) { stack.insertBefore(n, o.live); o.live.remove(); }
      else { stack.appendChild(n); fadeIn(n, "0 100%"); }
      toBottom();
    }

    // ---------- Answers ----------
    const undo = [];
    function pickSwap(b, s, doneLabel) {
      const prev = store.get("deckPick");
      store.set("deckPick", s.id);
      undo.push({ kind: "pick", prev, title: s.title });
      haptic("success"); markDone(b, doneLabel || "This week's swap");
      toast(`This week's swap: ${s.title}`);
    }
    async function gate(stack) {
      await say(stack, [`Cap: ${M(T.cap)}.`, "Guess your week first."]);
      guessButton(stack);
    }
    const lastSplitItem = what => {
      const C = charges().slice().sort(byTime);
      const rides = C.filter(c => c.kind === "ride" && !c.night && c.tag === "out");
      const dinners = C.filter(c => c.kind === "dining" && c.tag === "friends" && !c.split);
      if (what === "ride") return { item: rides.pop(), word: "Ride" };
      if (what === "dinner") return { item: dinners.pop(), word: "Dinner" };
      const r = rides.pop(); return r ? { item: r, word: "Ride" } : { item: dinners.pop(), word: "Dinner" };
    };
    const LEFT = weekPast() ? `Left ${wn}` : "Left this week";

    const handlers = {
      // "What did I spend (this week | last week | on X)". THIS week unless "last week" was named.
      async week(stack, it) {
        // A sample profile's only week is the current one: "last week" is the weekly row before it.
        if (it.scope === "last" && !weekPast() && !plan() && (D.weekly || []).length > 1 && !it.focus) {
          const w = D.weekly[D.weekly.length - 2], f = FOODK.reduce((x, k) => x + (w[k] || 0), 0), m = MOVEK.reduce((x, k) => x + (w[k] || 0), 0);
          await say(stack, [`Last week: ${M(f + m)}.`, `Food ${M(f)}, getting around ${M(m)}.`]);
          return;
        }
        const v = weekView(it.scope);
        if (!v.open) return gate(stack);
        const lw = v.lw, Lw = v.label;
        if (it.focus && it.focus !== "food" && it.focus !== "move") {
          const k = it.focus, list = v.charges.filter(c => c.kind === k).sort(byTime);
          const sum = sumOf(list), nightSum = sumOf(list.filter(c => c.night));
          await say(stack, [`${CAT[k]} ${lw}: ${M(sum)}${list.length ? `, ${list.length} ${list.length === 1 ? "charge" : "charges"}` : ""}.`, nightSum ? `Night rides: ${M(nightSum)}, always OK.` : ""]);
          if (list.length) await card(stack, listCard(`${CAT[k]} ${lw}`, list));
          return;
        }
        if (it.focus === "food" || it.focus === "move") {
          const keys = it.focus === "food" ? FOODK : MOVEK, now = it.focus === "food" ? v.food : v.move;
          const list = v.charges.filter(c => keys.includes(c.kind)).sort(byTime);
          await say(stack, [`${it.focus === "food" ? "Food" : "Getting around"} ${lw}: ${M(now)}.`]);
          if (v.cur) { if (list.length) await card(stack, listCard(`${it.focus === "food" ? "Food" : "Getting around"} this week`, list)); }
          else await card(stack, catCard(keys));
          return;
        }
        if (it.month) {
          const tw = tenWeeks();
          await say(stack, tw ? [`Last ${tw.n} weeks: ${M(tw.total)} a week on food and getting around.`] : [`${Lw}: ${M(v.spent)}.`]);
          return;
        }
        if (v.cur) {
          const top = topCats(v.charges).slice(0, 2);
          await say(stack, v.all
            ? [`This week so far: ${M(v.spent)}, all spending.`, top.length ? `Most: ${top.map(x => `${esc(x.cat.toLowerCase())} ${M(x.total)}`).join(", ")}.` : ""]
            : [`This week so far: ${M(v.spent)}.`, `Food ${M(v.food)}, getting around ${M(v.move)}.`]);
          if (v.charges.length) await card(stack, listCard("This week", v.charges.slice().sort(byTime), 8));
          return;
        }
        // With whole-bank data THIS week is all spending, so last week says both totals, labeled.
        const BK = PID === "you" && plan() && plan().scope === "all" && window.SwapLive && window.SwapLive.bank;
        const row = BK && (BK.weekly || []).find(w => w.wk === D.weekStart);
        const lines = row ? [`${Lw}: ${M(row.out)}, all spending.`, `Food + getting around: ${M(v.spent)}, cap ${M(v.cap)}.`]
          : [`${Lw}: ${M(v.spent)}.`, `Food ${M(v.food)}, getting around ${M(v.move)}.`];
        if (T.paidBack > 0 && !row) lines.push(`Friends paid back ${M(T.paidBack)}, not taken off.`);
        await say(stack, lines);
        await card(stack, capCard(v));
      },

      // "What's my cap (this week)": the cap, then spent and left for the week asked about.
      // THIS week on the founder's build = the all-spending budget. A food/ride question, or LAST
      // week, uses the food + getting around cap (api.capOf).
      async cap(stack, it) {
        const foodQ = !!it.focus;
        let v = weekView(it.scope);
        if (v.cur && v.all && foodQ) v = foodView(v);
        const cp = typeof api.capParts === "function" ? api.capParts() : { usual: U.total, save: T.saveTarget, owed: 0 };
        const usual = v.all ? v.usual : cp.usual, save = v.all ? v.save : cp.save;
        const why = `usual ${M(usual)} − ${M(save)} save${!v.all && cp.owed ? ` − ${M(cp.owed)} owed` : ""}`;
        const name = v.all ? "Budget this week" : v.foodCap ? "Food + getting around cap this week" : `Cap ${v.lw}`;
        if (!v.open) { await say(stack, [`${name}: ${M(v.cap)} (${why}).`, "Guess your week to see what you spent."]); guessButton(stack); return; }
        const tail = v.left >= 0 ? `Left: ${M(v.left)}.` : `${M(-v.left)} over.`;
        await say(stack, [`${name}: ${M(v.cap)} (${why}).`, `${v.cur ? "Spent so far" : "Spent"}: ${M(v.spent)}. ${tail}`, v.all ? "Covers all spending." : ""]);
        await card(stack, capCard(v));
      },

      // "How much can I spend today": today's plan, spent today, left today.
      async today(stack, it) {
        const p = plan();
        if (!p) return handlers.tonight(stack, it);
        if (it.amount != null) return handlers.tonight(stack, it);
        const d = p.days[p.today], left = p.todayLeft;
        const first = it.spentQ ? `Spent today: ${M(d.spent)}.`
          : left >= 0 ? `You can spend ${M(left)} today.` : `Today: ${M(-left)} over plan.`;
        const second = it.spentQ ? `Left today: ${M(Math.max(0, left))}. Plan: ${M(d.plan)}.`
          : `Plan ${M(d.plan)}, spent ${M(d.spent)}. Left this week: ${M(Math.max(0, p.left))}.`;
        await say(stack, [first, second]);
        const todays = weekView("this").charges.filter(c => c.day === p.today).sort(byTime);
        if (todays.length) await card(stack, listCard("Today", todays));
      },

      // "What's my daily plan": the 7 days, plan vs spent.
      async plan(stack, it) {
        const p = plan();
        if (!p || it.scope === "last") return handlers.week(stack, Object.assign({}, it, { scope: "last" }));
        const d = p.days[p.today];
        await say(stack, [`Today: ${M(d.plan)}.`, `Week: ${M(p.spent)} spent of ${M(p.cap)}.`]);
        await card(stack, planCard(p));
      },

      // "Am I on track": plan so far vs spent so far (api.dailyPlan().aheadBy).
      async track(stack, it) {
        const p = plan();
        if (!p || it.scope === "last") {
          const v = weekView("last");
          if (!v.open) return gate(stack);
          const d = v.spent - v.cap;
          await say(stack, [`${v.label}: ${M(v.spent)} of a ${M(v.cap)} cap.`, Math.abs(d) <= 5 ? "Right at the cap." : d > 0 ? `${M(d)} over the cap.` : `${M(-d)} under the cap.`]);
          await card(stack, capCard(v));
          return;
        }
        const a = p.aheadBy, d = p.days[p.today];
        const first = p.today === 0 ? `First day. Plan today: ${M(d.plan)}.`
          : Math.abs(a) <= 5 ? "Yes, right on plan." : a > 0 ? `Yes, ${M(a)} under plan so far.` : `Not quite: ${M(-a)} over plan so far.`;
        await say(stack, [first, `Left this week: ${M(Math.max(0, p.left))}. Today: ${M(Math.max(0, p.todayLeft))}.`]);
        await card(stack, planCard(p));
      },

      // "What did I buy this week": the week's food and ride charges.
      async charges(stack, it) {
        const v = weekView(it.scope);
        if (!v.open) return gate(stack);
        const list = v.charges.filter(c => !it.focus || c.kind === it.focus || (it.focus === "food" && FOODK.includes(c.kind)) || (it.focus === "move" && MOVEK.includes(c.kind))).sort(byTime);
        if (!list.length) { await say(stack, [`No charges ${v.lw} yet.`]); return; }
        await say(stack, [`${v.cur ? "This week so far" : v.label}: ${list.length} ${list.length === 1 ? "charge" : "charges"}, ${M(sumOf(list))}.`]);
        await card(stack, listCard(v.cur ? "This week" : v.label, list, 8));
      },

      // "Most unnecessary spending": the biggest cuttable categories. No week named = last 10 weeks.
      async biggest(stack, it) {
        const CUT = ["dining", "drinks", "quick", "delivery"];
        const A = it.scope ? null : analysis();
        if (A) {
          // All money, last 10 weeks (bank.analysis). "Most" = every category; "unnecessary" = cuttable ones.
          const rows = it.most ? A.cats : A.cats.filter(x => CUTTABLE.test(x.cat));
          const [a, b] = rows;
          await say(stack, [`${esc(a.cat)}: ${M(a.perWeek)} a week.${b ? ` Then ${esc(b.cat.toLowerCase())}: ${M(b.perWeek)}.` : ""}`, "Night rides are always OK."]);
          await card(stack, avgCard({ n: A.weeks }, (it.most ? A.cats : rows).slice(0, 6).map(x => ({ label: x.cat, avg: x.perWeek, k: KIND_OF_CAT[x.cat] }))));
          return;
        }
        const tw = it.scope ? null : tenWeeks();
        if (tw) {
          const cut = tw.cats.filter(x => it.most || CUT.includes(x.k)).sort((a, b) => b.avg - a.avg);
          const [a, b] = cut;
          await say(stack, [`${CAT[a.k]}: ${M(a.avg)} a week. Then ${CAT[b.k].toLowerCase()}: ${M(b.avg)}.`, "Night rides are always OK."]);
          await card(stack, avgCard(tw, tw.cats.slice().sort((x, y) => y.avg - x.avg).filter(x => x.avg > 0).map(x => ({ label: CAT[x.k], avg: x.avg, k: x.k }))));
          return;
        }
        const v = weekView(it.scope);
        if (!v.open) return gate(stack);
        const ranked = CUT.map(k => ({ k, now: sumOf(v.charges.filter(c => c.kind === k)) })).filter(x => x.now > 0).sort((a, b) => b.now - a.now);
        if (!ranked.length) { await say(stack, [`No food spending ${v.lw} yet.`, "Night rides are always OK."]); return; }
        await say(stack, [`${CAT[ranked[0].k]} ${v.lw}: ${M(ranked[0].now)}.${ranked[1] ? ` Then ${CAT[ranked[1].k].toLowerCase()}: ${M(ranked[1].now)}.` : ""}`, "Night rides are always OK."]);
        await card(stack, listCard(`Food ${v.lw}`, v.charges.filter(c => CUT.includes(c.kind)).sort(byTime), 8));
      },

      // "Can I get dinner tonight" / "Can I spend $40 today": today's room first, then the week's.
      async tonight(stack, it) {
        const p = it.scope === "last" ? null : plan();
        if (p) {
          const v = weekView("this"), a = it.amount, tl = p.todayLeft, wl = p.left;
          if (wl <= 0) {
            const meal = cheapestMeal();
            const option = it.social ? "Split it after?" : meal ? `Cheapest meal out last week: ${esc(show(meal.merchant))}, ${M(meal.amount)}.` : "";
            await say(stack, [`This week: ${M(p.spent)}, cap ${M(p.cap)}.`, option || nextWeekLine()].filter(Boolean));
            await card(stack, capCard(v, a || 0));
            if (it.social && a != null) splitAction(stack, a);
            return;
          }
          let lines;
          if (a != null) {
            lines = a <= tl ? [`Yes, ${M(a)} fits today.`, `Left today after: ${M(tl - a)}.`]
              : a <= wl ? [`${M(a)} is above today's ${M(Math.max(0, tl))} left.`, `It fits the week: ${M(wl)} left.`]
              : [`Left this week: ${M(wl)}.`, `With it: ${M(p.spent + a)}, cap ${M(p.cap)}.`];
          } else {
            const meal = typicalMeal();
            lines = [tl > 0 ? `Yes. Left today: ${M(tl)}.` : `Today's plan is used. Left this week: ${M(wl)}.`];
            if (tl > 0) lines.push(`Left this week: ${M(wl)}.`);
            if (it.social) { lines = [lines[0], "How much is the bill?"]; pending = { type: "tonight", it }; }
            else if (meal && tl > 0 && tl < meal) lines = [lines[0], `Your usual meal out: ${M(meal)}.`];
            else if (it.delivery) { const g = (D.priceGaps || [])[0]; if (g) lines = [lines[0], `${esc(g.place)}: ${M(g.pickup)} pickup, ${M(g.delivered)} delivered.`]; }
          }
          if (it.social && a != null) lines = [lines[0], "Split it after?"];
          await say(stack, lines);
          await card(stack, capCard(v, a || 0, it.id === "today" || /\btoday\b/.test(it.raw || "") ? "Today" : "Tonight"));
          if (it.social && a != null) splitAction(stack, a);
          return;
        }
        // No current-week data: the recap week (sample profiles).
        const v = weekView("last");
        if (!v.open) return gate(stack);
        const r = room(), a = it.amount;
        if (r <= 0) {
          // At or over the cap: the week in one line, then one option and when the week resets.
          const meal = cheapestMeal();
          const option = it.social ? "Split it after?" : meal ? `Cheapest meal out ${wn}: ${esc(show(meal.merchant))}, ${M(meal.amount)}.` : "";
          await say(stack, [`${WN}: ${M(T.total)}, cap ${M(T.cap)}.`, option || nextWeekLine(), option ? nextWeekLine() : ""].filter(Boolean).slice(0, 3));
          await card(stack, capCard(v, a || 0));
          if (it.social && a != null) splitAction(stack, a);
          return;
        }
        let lines;
        if (a != null) lines = a <= r ? [`Yes, ${M(a)} fits.`, `${LEFT}: ${M(r)}.`] : [`${LEFT}: ${M(r)}.`, `With it: ${M(T.total + a)}, cap ${M(T.cap)}.`];
        else {
          const meal = typicalMeal();
          lines = [`Yes. ${LEFT}: ${M(r)}.`];
          if (it.social) { lines.push("How much is the bill?"); pending = { type: "tonight", it }; }
          else if (meal && r < meal) lines.push(`Your usual meal out: ${M(meal)}.`);
          else if (it.delivery) { const g = (D.priceGaps || [])[0]; if (g) lines.push(`${esc(g.place)}: ${M(g.pickup)} pickup, ${M(g.delivered)} delivered.`); }
        }
        if (it.social && a != null) lines = [lines[0], "Split it after?"];
        await say(stack, lines);
        await card(stack, capCard(v, a || 0));
        if (it.social && a != null) splitAction(stack, a);
      },

      async amount(stack, it) {
        const p = pending; pending = null;
        if (p.type === "night") {
          p.entry.amount = Math.round(it.amount);
          paintNight(p.entry);
          await say(stack, [`${M(p.entry.amount)} logged as a night ride.`]);
          return;
        }
        await handlers.tonight(stack, Object.assign({}, p.it, { amount: it.amount }));
      },

      async class(stack, it) {
        const f = api.facts(), sub = f.subwayMinutes, viable = sub != null && sub <= 30;
        const apps = rideApps(), cheap0 = apps[0];
        // He already uses the ride app for nearly every ride: price it, but don't name it as a pick.
        const cheap = cheap0 && !rideAppSuggestOK() && isRideApp(cheap0.app) ? Object.assign({}, cheap0, { app: "Ride" }) : cheap0;
        const s = api.swaps().find(x => x.id === "subway-am");
        const days = s && /tue.*thu/i.test(s.title) ? "Tue + Thu" : null;
        if (it.late) {
          await say(stack, [`Take the ride today${cheap ? `${cheap.app === "Ride" ? "," : `: ${esc(cheap.app)},`} about ${M(Math.round(cheap.median))}` : ""}.`,
            viable && s ? `${days ? `Subway ${days}` : esc(s.title)}? ${M(D.subway.fare)} a trip.` : ""]);
          if (viable && s) actions(stack, [{ label: days ? `Add ${days}` : "Make it this week's swap", icon: "train", run: b => pickSwap(b, s, "Added") }]);
          return;
        }
        if (sub == null) { await say(stack, ["No subway on your route."]); return; }
        if (!viable) {
          await say(stack, [`Subway: about ${sub} min.`, apps.length ? `Ride on class days${cheap ? `${cheap.app === "Ride" ? "," : `: ${esc(cheap.app)},`} about ${M(Math.round(cheap.median))}` : ""}.` : ""]);
          return;
        }
        const diff = Math.round(cheap.median) - D.subway.fare;
        await say(stack, [`Subway: ${M(D.subway.fare)}, about ${sub} min.`, `Ride: about ${M(Math.round(cheap.median))}, ${M(diff)} more a trip.`]);
        await card(stack, tripCard(sub, cheap));
        if (s) actions(stack, [{ label: days ? `Add ${days}` : "Make it this week's swap", icon: "check", primary: true, run: b => pickSwap(b, s, "Added") }]);
      },

      // Cheaper ride app. On the founder's build his ride app is recommended over Uber/Lyft.
      async rideapp(stack) {
        const apps = rideApps();
        if (!apps.length) { await say(stack, ["No ride prices yet."]); return; }
        const cheap = apps[0], dear = apps[apps.length - 1];
        if (apps.length === 1) { await say(stack, [`${esc(cheap.app)}: about ${M(Math.round(cheap.median))} a ride.`]); return; }
        const gap = Math.round(dear.median - cheap.median);
        if (D.rideAppShare >= 0.8 && isRideApp(cheap.app)) {
          await say(stack, [`You already take ${esc(cheap.app)} for ${Math.round(D.rideAppShare * 100)}% of rides.`, `About ${M(Math.round(cheap.median))} a ride. Nothing cheaper to switch to.`]);
          return;
        }
        await say(stack, [`${esc(cheap.app)}: about ${M(Math.round(cheap.median))} a ride. ${esc(dear.app)}: about ${M(Math.round(dear.median))}.`,
          gap > 0 ? `${esc(cheap.app)} is about ${M(gap)} less a ride.` : ""]);
        const s = api.swaps().find(x => x.rideApp || (x.kind === "move" && isRideApp(x.title)));
        if (s && rideAppOK()) {
          await card(stack, swapCard(s));
          actions(stack, [{ label: "Make it this week's swap", icon: "check", primary: true, run: b => pickSwap(b, s) }]);
        }
      },

      async why(stack, it) {
        // "Why is it so high" with no week named: THIS week, from the live plan.
        if (plan() && it.scope !== "last" && !it.move) {
          const v = weekView("this"), p = v.plan, top = topCats(v.charges)[0];
          await say(stack, [`This week so far: ${M(v.spent)}${p.today > 0 && p.aheadBy < -5 ? `, ${M(-p.aheadBy)} over plan` : ""}.`, top ? `Most of it: ${esc(top.cat.toLowerCase())}, ${M(top.total)}.` : ""]);
          if (v.charges.length) await card(stack, listCard("This week", v.charges.slice().sort(byTime), 8));
          return;
        }
        if (!guessed()) return gate(stack);
        const f = api.facts(), mv = D.move;
        const d = T.total - U.total, high = d > Math.max(5, U.total * .05);
        const keys = it.focus === "food" || FOODK.includes(it.focus) ? FOODK : it.focus === "move" || MOVEK.includes(it.focus) ? MOVEK : FOODK.concat(MOVEK);
        const ranked = keys.map(k => ({ k, now: weekOf(k), us: usualOf(k) })).map(x => Object.assign(x, { d: x.now - x.us }));
        const ups = ranked.slice().sort((a, b) => b.d - a.d), moves = ranked.slice().sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
        // The move explains it only when asked about the move, or when the week is high and the step is real.
        let step = null;
        if (f.moved && mv && mv.date) {
          const steps = [{ k: "ride", b: mv.rideSpendBefore, a: mv.rideSpendAfter }];
          if (mv.deliverySpendBefore != null) steps.push({ k: "delivery", b: mv.deliverySpendBefore, a: mv.deliverySpendAfter });
          step = steps.filter(x => x.a != null && x.b != null && keys.includes(x.k)).sort((x, y) => (y.a - y.b) - (x.a - x.b))[0] || null;
          if (step && step.a - step.b <= 20) step = null;
        }
        if (step && (it.move || (high && ups[0] && ups[0].k === step.k))) {
          const when = new Date(mv.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
          await say(stack, [`${CAT[step.k]}: ${M(step.b)}/wk ${esc(mv.beforeLabel.toLowerCase())}.`, `${M(step.a)}/wk since the ${when} move.`]);
          await card(stack, sparkCard(step.k, CAT[step.k], mv.date));
          return;
        }
        if (it.where) {
          const most = ranked.slice().sort((a, b) => b.now - a.now)[0];
          await say(stack, [`Most of it: ${CAT[most.k].toLowerCase()}, ${M(most.now)}.`, `${WN}: ${M(T.total)}, ${vsUsual(T.total, U.total)}.`]);
          await card(stack, catCard(ranked.slice().sort((a, b) => b.now - a.now).slice(0, 3).map(x => x.k)));
          return;
        }
        if (!high) {
          const top = moves[0];
          const change = top && Math.abs(top.d) >= 5 ? `Biggest change: ${CAT[top.k].toLowerCase()}, ${M(Math.abs(top.d))} ${top.d < 0 ? "under" : "above"} usual.` : "";
          await say(stack, [`Not high: ${M(T.total)}, ${vsUsual(T.total, U.total)}.`, change]);
          await card(stack, catCard(moves.slice(0, 3).map(x => x.k)));
          return;
        }
        const top = ups[0];
        await say(stack, [`${WN}: ${M(T.total)}, ${M(d)} above your usual.`, `Most of it: ${CAT[top.k].toLowerCase()}, ${M(top.now)} (usual ${M(top.us)}).`]);
        await card(stack, catCard(ups.slice(0, 3).map(x => x.k)));
      },

      async save(stack) {
        const list = api.swaps(), pick = store.get("deckPick");
        const s = list.find(x => x.id !== pick) || list[0];
        if (!s) { await say(stack, ["No swap fits yet."]); return; }
        await say(stack, [`${esc(s.title)}.`, `About ${M(s.save)} ${unitOf(s)}.`]);
        await card(stack, swapCard(s));
        actions(stack, [{ label: "Make it this week's swap", icon: "check", primary: true, run: b => pickSwap(b, s) }]);
      },

      // "Save $50 a week" / "change my savings": sets the weekly save amount and the cap.
      async setsave(stack, it) {
        if (typeof api.setSave !== "function") { await say(stack, ["Change savings in Whose week."]); return; }
        const apply = n => {
          const cap = api.setSave(n);
          haptic("success");
          return [`Saving ${M(T.saveTarget)} a week.`, `New cap: ${M(typeof cap === "number" ? cap : T.cap)}.`];
        };
        if (it.amount != null) { await say(stack, apply(it.amount)); return; }
        await say(stack, [`Saving ${M(T.saveTarget)} a week.`, `Cap: ${M(T.cap)}.`]);
        const max = U.total - ((T.payback && T.payback.perWeek) || 0);
        const opts = [50, 100, 150].filter(n => n <= max && n !== T.saveTarget);
        if (opts.length) actions(stack, opts.map((n, i) => ({ label: `Save ${money(n)}`, primary: i === 0, run: async b => {
          const lines = apply(n);
          markDone(b, `Cap ${money(T.cap)}`);
          const st = turn("bot"); await say(st, lines);
        } })));
      },

      // "Turn off reminders" / "Remind me Sunday": the native reminder switches.
      async remind(stack, it) {
        const N = api.notify;
        if (!N) { await say(stack, ["Reminders are in Whose week."]); return; }
        if (!it.on) { N.disable(); haptic(); await say(stack, ["Reminders off."]); return; }
        const o = Object.assign({ sunday: false, daily: false }, (N.state && N.state()) || {}, it.daily ? { daily: true } : { sunday: true });
        N.enable(o);
        haptic("success");
        await say(stack, [it.daily ? "Daily reminder on, at noon." : "Sunday reminder on, at 6 PM.", N.available ? "" : "Reminders work in the iPhone app."]);
      },

      async swipes(stack) {
        const mp = D.mealPlan, f = api.facts();
        if (!mp || !f.hasMealPlan) { await say(stack, [f.hasMealPlan ? "Swipe count not connected yet." : "No meal plan on file."]); return; }
        const del = charges().filter(c => c.kind === "delivery");
        await say(stack, [`Swipes left: ${mp.swipesLeft}, about ${Math.round(swipePace(mp))} used a week.`,
          del.length ? `${del.length} ${del.length === 1 ? "delivery" : "deliveries"} ${wn}; a hall dinner before 8 replaces one.` : `About ${M(mp.perSwipe)} each, already paid.`]);
        await card(stack, swipesCard(mp));
      },

      async member(stack, it) {
        const ms = D.memberships || [];
        const m = it.which ? ms.find(x => x.name === it.which) : ms[0];
        if (m) {
          const isRide = m.ordersPerWeek == null;
          // Uber One counts every ride, not only Uber-branded ones.
          const rideCount = charges().filter(c => c.kind === "ride").length;
          const perWeek = isRide ? (rideCount || m.ridesPerWeek || 0) : m.ordersPerWeek;
          const unitWord = isRide ? "Ride" : "Order", perMonth = perWeek * 4.33, per = perMonth > 0 ? m.price / perMonth : null;
          await say(stack, [`${esc(m.name)}: ${M(m.price, 2)}/mo.`,
            per != null ? `${perMonth.toFixed(1)} ${unitWord.toLowerCase()}s/mo = ${M(per, 2)} ${isRide ? "a ride" : "an order"}.` : `No ${unitWord.toLowerCase()}s ${wn}.`]);
          await card(stack, evenCard(m.name, m.price, perMonth, unitWord, badge("memberships"), m.student));
          return;
        }
        // Not a member: break-even from this week's own count (Uber One: every ride counts).
        const name = it.which || "DashPass", isRide = name === "Uber One";
        const uses = charges().filter(c => isRide ? c.kind === "ride" : c.kind === "delivery").length;
        const perMonth = uses * 4.33, price = 9.99;
        await say(stack, [`Not on ${esc(name)}. ${isRide ? "Rides" : "Deliveries"} ${wn}: ${uses}.`,
          uses ? `At that pace, ${M(price, 2)}/mo = ${M(price / perMonth, 2)} each.` : "It wouldn't pay off."]);
        if (uses) await card(stack, evenCard(name, price, perMonth, isRide ? "Ride" : "Order", badge("memberships")));
      },

      async split(stack, it) {
        const { item, word } = lastSplitItem(it.what);
        if (!item) { await say(stack, [it.what === "ride" ? `No ride out with friends ${wn}.` : "No shared dinner left to split."]); return; }
        const each = Math.round(item.amount / 2 * 100) / 100;
        await say(stack, [`${esc(show(item.merchant))}, ${DAYS[item.day]}: ${M(item.amount)}.`, `Two ways: ${M(each, each % 1 ? 2 : 0)} each.`]);
        actions(stack, [{ label: "Draft a request", icon: "people", primary: true, run: async b => {
          markDone(b, "Request below"); haptic();
          await card(stack, requestCard(item, word));
        } }]);
      },

      async protect(stack) {
        await say(stack, ["Don't skip it.", "Night rides are always OK."]);
      },

      async night(stack, it) {
        const entry = { time: it.time, amount: it.amount != null ? Math.round(it.amount) : null, app: it.app ? show(it.app.charAt(0).toUpperCase() + it.app.slice(1)) : null };
        const lines = ["Logged as a night ride, always OK."];
        if (entry.amount == null) { lines.push("How much was it?"); pending = { type: "night", entry }; }
        await say(stack, lines);
        await card(stack, nightCard(entry));
        undo.push({ kind: "night", entry });
        haptic("success");
        actions(stack, [{ label: "Undo", icon: "reset", run: b => { markDone(b, "Undone"); send("Undo"); } }]);
      },

      async undo(stack) {
        const last = undo.pop();
        if (!last) { await say(stack, ["Nothing to undo."]); return; }
        if (last.kind === "night") {
          last.entry.undone = true; paintNight(last.entry);
          if (pending && pending.entry === last.entry) pending = null;
          await say(stack, ["Removed."]);
        } else if (last.kind === "pick") {
          store.set("deckPick", last.prev || null);
          await say(stack, [`Removed: ${esc(last.title)}.`]);
        }
        haptic();
      },

      async hello(stack) { await say(stack, ["Ask about tonight, rides or your week."]); },
      async thanks(stack) { const p = plan(); await say(stack, [p ? `Left today: ${M(Math.max(0, p.todayLeft))}.` : guessed() ? `${LEFT}: ${M(Math.max(0, room()))}.` : `Cap: ${M(T.cap)}.`]); },
      async unknown(stack) {
        await say(stack, ["Try one of these."]);
        await card(stack, suggestCard(PROMPTS.concat(MORE).filter(p => !log.textContent.includes(p)).slice(0, 4)));
      }
    };
    // "Split it after?" as an opt-in button, for a bill they typed.
    function splitAction(stack, a) {
      actions(stack, [{ label: "Split it", icon: "people", primary: true, run: async b => {
        markDone(b, "Split below"); haptic();
        await card(stack, requestCard({ id: "tonight", merchant: "Tonight", day: 6, amount: a }, "Tonight"));
      } }]);
    }

    // ---------- Send / reply (queued so exchanges never interleave) ----------
    let chain = Promise.resolve();
    function send(text) {
      text = String(text).trim(); if (!text || !alive) return;
      haptic();
      chain = chain.then(() => { if (!alive) return; addUser(text); return reply(text); }).catch(e => console.error("[agent]", e));
    }
    // The last answered question, so "no, for this week" / "and last week?" can re-ask it.
    let lastIt = null, lastQ = "";
    const SCOPED = new Set(["cap", "week", "charges", "track", "plan", "today", "tonight", "why", "biggest"]);
    function followUp(fs) {
      if (fs === "today") return { it: { id: "today", scope: "this" }, q: "How much can I spend today?" };
      if (!lastIt) return { it: { id: "week", scope: fs }, q: `What did I spend ${fs} week?` };
      let id = SCOPED.has(lastIt.id) ? lastIt.id : "week";
      if (fs === "last" && ["today", "plan", "tonight"].includes(id)) id = "week";
      if (fs === "this" && id === "today") id = "cap";
      const base = lastQ.replace(/[?.!\s]+$/, "");
      const q = /\b(this|last|past|previous) week\b/i.test(base) ? base.replace(/\b(this|last|past|previous) week\b/i, `${fs} week`) + "?"
        : /\b(today|tonight)\b/i.test(base) ? base.replace(/\b(today|tonight)\b/i, `${fs} week`) + "?" : `${base} ${fs} week?`;
      return { it: Object.assign({}, lastIt, { id, scope: fs, month: false, amount: null }), q };
    }
    // Remembers the exchange for the model's next prompt (scripted answers too).
    function remember(q, stack) {
      const b = stack.querySelector(".ag-b.bot:not(.ag-typing):not([aria-hidden])");
      const a = b ? b.textContent.replace(/^Swap:\s*/, "").trim() : "";
      if (a) { hist.push({ q, a }); if (hist.length > 2) hist.shift(); }
    }
    async function reply(text) {
      let it = intentOf(text), asked = text;
      const fs = followScope(norm(text));
      if (fs) { const f = followUp(fs); it = f.it; asked = f.q; }
      if (it.id !== "amount" && it.id !== "undo") pending = null;
      if (SCOPED.has(it.id)) { lastIt = it; lastQ = asked; }
      await wait(160);
      if (!alive) return;
      const stack = turn("bot");
      let stop = typing(stack);
      // Only the recap week (last week) is hidden behind the guess. THIS week never is.
      const gatedOut = GATED.has(it.id) && !weekView(it.id === "why" && !plan() ? "last" : it.scope).open;
      if (AI() && MODEL_INTENTS.has(it.id) && !gatedOut) {
        const res = await askModel(asked, it, stack, stop);
        if (!alive) return;
        if (res) {
          if (res.card) { override = res; await handlers[it.id](stack, it); }
          if (override || !res.card) { override = null; placeModel(stack, res); }
          remember(asked, stack);
          return;
        }
        stop = typing(stack);   // fall back to the scripted answer
      }
      await wait(420 + Math.min(320, text.length * 5));
      stop();
      if (!alive) return;
      await handlers[it.id](stack, it);
      remember(asked, stack);
    }

    // ---------- Opening: one line, then four questions ----------
    const first = turn("bot"), p0 = plan();
    if (p0) {
      // THIS week, from the live plan. Never last week's total (that's the recap, behind the guess).
      first.appendChild(el(`<div class="ag-b bot t-body"><span class="vh">Swap: </span>This week so far: ${M(p0.spent)} of ${M(p0.cap)}. Left today: ${M(Math.max(0, p0.todayLeft))}.</div>`));
    } else if (guessed()) {
      first.appendChild(el(`<div class="ag-b bot t-body"><span class="vh">Swap: </span>${WN}: ${M(T.total)} of a ${M(T.cap)} cap.</div>`));
    } else {
      first.appendChild(el(`<div class="ag-b bot t-body"><span class="vh">Swap: </span>Cap: ${M(T.cap)}. Guess your week first.</div>`));
      guessButton(first);
    }
    first.appendChild(suggestCard(PROMPTS));

    // Debugging: Swap.debug.agentContext() prints the model's context (Safari Web Inspector on the phone).
    try { (window.Swap.debug = window.Swap.debug || {}).agentContext = () => context(); } catch (e) {}
    if (AI()) setTimeout(() => { if (alive && api.current && api.current() === "chat") window.SwapAI.prewarm(context(), { rideApp: rideAppSuggestOK() }); }, 600);

    function dispose() {
      alive = false;
      document.removeEventListener("swap:tab", onTab);
      document.removeEventListener("swap:profile", onProfile);
      if (typeof offGuess === "function") offGuess();
    }
    return dispose;
  },

  // Deep link (?open=agent) and the desktop panel: land on the latest message, focus the composer.
  open() {
    const v = this._view, i = this._input;
    if (v) v.scrollTo({ top: v.scrollHeight });
    if (i && matchMedia("(hover: hover)").matches) i.focus({ preventScroll: true });
  }
});
