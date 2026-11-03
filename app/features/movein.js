/* Move-in mode.
   Week tab row -> sheet: 4 questions (kitchen, subway time, meal plan, late nights), one per step with
   an explicit Next, saved to store "moveProfile" (for "you" these answers override api.facts()).
   Then "What changed": the ACTIVE profile's weekly data with the move marked and before/after
   averages, or "No big change found" plus the week trend when the profile has no move date.
   Two swaps come from api.swaps(), filtered and ranked by the answers. Night rides are never a target. */
(function () {
  // The lower-fare ride app (shown as Lower-fare app on the private build) is never a swap or a logo pick.
  const rideApp = (api, name) => typeof api.isRideApp === "function" ? api.isRideApp(name) : /lower-fare|rideapp/i.test(String(name || ""));
  // The founder's live build recommends Lower-fare app for Uber/Lyft rides (core decides; default off).
  const rideOK = api => typeof api.rideAppAllowed === "function" && !!api.rideAppAllowed();
  const Q = [
    { key: "kitchen", q: "What kitchen do you have?", hint: "", opts: [["none", "No kitchen"], ["micro", "Microwave only"], ["shared", "Shared kitchen"], ["own", "My own kitchen"]] },
    { key: "meal", q: "Do you have a meal plan?", hint: "", opts: [["yes", "Yes"], ["no", "No"]] },
    { key: "subway", q: "Subway time to campus?", hint: "One way, door to class.", opts: [["u15", "Under 15 min"], ["15-30", "15–30 min"], ["30+", "30+ min"], ["none", "No subway, I walk"]] },
    { key: "nights", q: "Late nights out per week?", hint: "Out past 11 PM.", opts: [["0", "None"], ["1-2", "1–2"], ["3+", "3 or more"]] }
  ];
  const SHORT = {
    kitchen: { none: "No kitchen", micro: "Microwave", shared: "Shared kitchen", own: "Own kitchen" },
    subway: { u15: "Subway under 15 min", "15-30": "Subway 15–30 min", "30+": "Subway 30+ min", none: "No subway" },
    meal: { yes: "Meal plan", no: "No meal plan" },
    nights: { "0": "No late nights", "1-2": "1–2 late nights", "3+": "3+ late nights" }
  };
  const UNIT = { week: "a week", order: "an order", meal: "a meal", ride: "a ride", month: "a month" };
  const KIND_NAME = { ride: "Rides", delivery: "Delivery", dining: "Eating out", drinks: "Clubs, bars & bodega", quick: "Coffee & snacks", transit: "Subway" };
  const complete = p => !!p && Q.every(q => p[q.key] != null);
  const plain = s => String(s).replace(/\s*→\s*/g, " to ");
  // Pickup swap whose place isn't in the student's own price gaps: show the gaps it really has.
  function adaptSwap(api, s) {
    if (!s || !/^pick ?up\s/i.test(s.title)) return s;
    const gaps = api.data.priceGaps || [], place = s.title.replace(/^pick ?up\s+/i, "").toLowerCase();
    if (!gaps.length || gaps.some(g => g.place.toLowerCase() === place)) return s;
    const avg = Math.round(gaps.reduce((t, g) => t + g.delivered - g.pickup, 0) / gaps.length);
    return Object.assign({}, s, { title: "Pick up instead of delivery", detail: "Same food. No delivery markup.", save: avg, unit: "order",
      basis: "Average of your past orders", adapted: true });
  }
  // A brand for a swap's logo (Chipotle, DashPass, MTA for the subway, the ride app for a split ride).
  function brandOf(api, s) {
    const text = `${s.title} ${s.detail || ""}`;
    if (rideApp(api, text)) return null;   // the ride app gets the generic ride glyph, never a logo
    if (api.logo(s.title)) return s.title;
    if (/subway|train/i.test(text)) return "MTA";
    if (api.logo(text)) return text;
    if (/\bride\b/i.test(text)) { const c = api.charges().find(x => x.kind === "ride" && !x.night && x.tag === "out" && !rideApp(api, x.merchant) && api.logo(x.merchant)); return c ? c.merchant : null; }
    return null;
  }

  // Same mapping core uses for "you"; applied here too so sample profiles follow their answers.
  const SUB = { u15: 12, "15-30": 25, "30+": 35, none: null }, NIGHTS = { "0": 0, "1-2": 2, "3+": 3 };
  const NEEDS = {
    mealPlan: f => f.hasMealPlan, noMealPlan: f => !f.hasMealPlan,
    kitchen: f => f.kitchen === "shared" || f.kitchen === "own", noKitchen: f => f.kitchen === "none" || f.kitchen === "micro",
    subway: f => f.subwayMinutes != null && f.subwayMinutes <= 30
  };
  function factsFrom(api, a) {
    const f = Object.assign({}, api.facts());
    if (!a) return f;
    if (a.kitchen) f.kitchen = a.kitchen;
    if (a.subway in SUB) f.subwayMinutes = SUB[a.subway];
    if (a.meal) f.hasMealPlan = a.meal === "yes";
    if (a.nights in NIGHTS) f.lateNights = NIGHTS[a.nights];
    return f;
  }

  // Two swaps that fit. Meal plan first goes to swipes; 30+ min subway or "late" class rides never
  // put the subway first. Never the lower-fare app, never a night ride (api.swaps() already drops them).
  function suggest(api, a) {
    const f = factsFrom(api, a), money = api.money;
    const list = api.swaps().filter(s => !s.night && (rideOK(api) || !rideApp(api, `${s.title} ${s.detail} ${s.basis}`)) && (s.needs || []).every(n => !NEEDS[n] || NEEDS[n](f)));
    const late = api.charges().some(c => c.kind === "ride" && !c.night && c.tag === "late");
    const subwayOK = f.subwayMinutes != null && f.subwayMinutes <= 30 && a.subway !== "30+";
    const is = {
      swipe: s => (s.needs || []).includes("mealPlan") || /swipe|hall/i.test(s.title),
      subway: s => (s.needs || []).includes("subway") || /subway/i.test(s.title),
      pickup: s => /pick ?up/i.test(s.title),
      split: s => /split/i.test(s.title)
    };
    const weekly = s => s.save * ({ week: 1, order: 1, meal: 2, ride: 2, month: .25 }[s.unit] || 1);
    const score = s => {
      if (is.subway(s)) return subwayOK && !late ? 70 : subwayOK ? 1 : -1;
      if (f.hasMealPlan && is.swipe(s)) return 100;
      if ((f.kitchen === "none" || f.kitchen === "micro") && is.pickup(s)) return 80;
      if (f.lateNights > 0 && is.split(s)) return 60;
      return 10 + weekly(s) / 10;
    };
    let out = list.filter(s => score(s) >= 0).sort((x, y) => score(y) - score(x));
    // Meal plan, but this profile has no swipe swap: build one from this week's delivery charges.
    if (f.hasMealPlan && !out.some(is.swipe)) {
      const del = api.charges().filter(c => c.kind === "delivery");
      if (del.length) {
        const avg = Math.round(del.reduce((s, c) => s + c.amount, 0) / del.length);
        out.unshift({ id: "swipe-delivery", title: "Swipe instead of one delivery", detail: "Hall dinner on a night you'd order.", save: avg, unit: "order", kind: "food",
          basis: `Delivery this week ~${money(avg)} vs a swipe you already paid for`, built: true });
      }
    }
    if (out[0] && is.subway(out[0]) && out.length > 1) out.push(out.shift());
    return out.slice(0, 2).map(x => adaptSwap(api, x));
  }

  // What changed around the move, from the active profile's own rows.
  function analysis(api) {
    const D = api.data, m = D.move;
    if (!m || !m.date) return { moved: false };
    if (D.id === "you") return { moved: true, kind: "ride", before: m.rideSpendBefore, after: m.rideSpendAfter, perBefore: m.ridesPerWeekBefore, perAfter: m.ridesPerWeekAfter };
    const before = D.weekly.filter(r => r.wk < m.date), after = D.weekly.filter(r => r.wk >= m.date);
    const avg = (rows, k) => Math.round(rows.reduce((s, r) => s + (r[k] || 0), 0) / Math.max(1, rows.length));
    let best = null;
    Object.keys(KIND_NAME).forEach(k => { const d = avg(after, k) - avg(before, k); if (!best || Math.abs(d) > Math.abs(best.d)) best = { k, d }; });
    return { moved: true, kind: best.k, before: avg(before, best.k), after: avg(after, best.k) };
  }

  // Weekly bars (single series, or food + getting around stacked), with optional move marker,
  // before/after averages and a usual line. Sized to its container so text stays 11px.
  function drawChart(svg, wrap, api, o) {
    const { money } = api, rows = api.data.weekly;
    const W = Math.max(260, Math.round(wrap.clientWidth)), H = 196, L = 40, R = 8, T = 26, B = 22;
    const WK = 7 * 864e5, f = n => n.toFixed(2);
    const wk = rows.map(r => Object.assign({ t: Date.parse(r.wk + "T00:00:00Z") }, r));
    const t0 = wk[0].t, t1 = wk[wk.length - 1].t + WK;
    const X = t => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const val = r => o.series.reduce((s, sr) => s + sr.get(r), 0);
    const top = Math.max(1, ...wk.map(val), o.avgs ? Math.max(...o.avgs.map(a => a.v)) : 0, o.usual || 0);
    const raw = top / 3, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw);
    const max = Math.ceil(top / step) * step;
    const Y = v => T + (1 - v / max) * (H - T - B), base = Y(0);

    let grid = "";
    for (let v = 0; v <= max + 1e-6; v += step) grid += `<line class="gl${v ? "" : " zero"}" x1="${L}" x2="${W - R}" y1="${f(Y(v))}" y2="${f(Y(v))}"/><text class="t-cap yl" x="${L - 6}" y="${f(Y(v) + 3.5)}" text-anchor="end">$${v}</text>`;
    // month ticks, at most 5
    const months = [], d0 = new Date(t0), dEnd = new Date(t1);
    for (let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); d < dEnd; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push(d);
    const every = Math.ceil(months.length / 5), shown = months.filter((_, i) => i % every === 0);
    const multiYear = d0.getUTCFullYear() !== dEnd.getUTCFullYear();
    const xl = shown.map((d, i) => {
      const x = X(d.getTime()), m = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
      const label = multiYear && (i === 0 || d.getUTCMonth() === 0) ? `${m} ’${String(d.getUTCFullYear()).slice(2)}` : m;
      return `<line class="tk" x1="${f(x)}" x2="${f(x)}" y1="${f(base)}" y2="${f(base + 4)}"/><text class="t-cap xl" x="${f(x)}" y="${H - 5}" text-anchor="middle">${label}</text>`;
    }).join("");

    let bars = "";
    wk.forEach(w => {
      const x = X(w.t) + 0.6, bw = Math.max(1.4, X(w.t + WK) - X(w.t) - 1.2);
      let acc = 0;
      o.series.forEach(sr => {
        const v = sr.get(w); if (v <= 0) return;
        bars += `<rect class="b ${sr.cls}" x="${f(x)}" y="${f(Y(acc + v))}" width="${f(bw)}" height="${f(Y(acc) - Y(acc + v))}" rx="1"/>`;
        acc += v;
      });
    });

    let extra = "";
    if (o.marker) {
      const mx = X(Date.parse(o.marker.date + "T12:00:00Z"));
      const anchor = mx > W * .55 ? "end" : "start", tx = anchor === "end" ? mx - 6 : mx + 6;
      extra += `<g class="mk"><line x1="${f(mx)}" x2="${f(mx)}" y1="8" y2="${f(base)}"/><text class="t-cap" x="${f(tx)}" y="16" text-anchor="${anchor}">${o.marker.label}</text></g>`;
      o.avgs.forEach(a => {
        const x0 = a.side === "before" ? L : mx, x1 = a.side === "before" ? mx : W - R, y = Y(a.v);
        extra += `<g class="avg"><path d="M${f(x0)} ${f(y)}H${f(x1)}"/></g>`;   // numbers live in the legend, never on the bars
      });
    }
    if (o.usual) {
      const y = Y(o.usual);
      extra += `<g class="avg"><path d="M${L} ${f(y)}H${W - R}"/></g>`;
    }
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("aria-label", o.label);
    svg.innerHTML = `<g class="grid">${grid}${xl}</g><g class="bars" style="transform-origin:0 ${f(base)}px">${bars}</g><g class="over">${extra}</g>`;
    api.animate(svg.querySelector(".bars"), [{ transform: "scaleY(0)", opacity: 0 }, { transform: "scaleY(1)", opacity: 1 }], { preset: "standard" });
    api.animate(svg.querySelector(".over"), [{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 260 });
  }

  const fmtDay = (iso, year) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", Object.assign({ month: "short", day: "numeric", timeZone: "UTC" }, year ? { year: "numeric" } : {}));

  Swap.feature({
    id: "movein",
    title: "Move-in",
    pitch: "4 questions. What changed. 2 swaps.",
    tab: "week",
    order: 3,

    render(slot, api) {
      const { el, icon, store, haptic, esc } = api;
      const self = this;
      const draw = () => {
        const a = store.get("moveProfile"), done = complete(a);
        const sub = done ? ["kitchen", "subway"].map(k => SHORT[k][a[k]]).join(" · ") : "4 questions";
        const b = el(`<button class="card mi-banner pressable">
          <span class="mi-ico" aria-hidden="true">${icon("home", 20)}</span>
          <span class="mi-text"><b class="t-headline">${done ? "Where you live" : "Moved this semester?"}</b><span class="t-sub t-2">${esc(sub)}</span></span>
          <span class="mi-go" aria-hidden="true">${icon("chevron", 18, 2.2)}</span></button>`);
        b.addEventListener("click", () => { haptic(); self.open(api); });
        slot.replaceChildren(b);
      };
      draw();
      const off = store.on("moveProfile", draw);
      return () => off();
    },

    open(api) {
      const { el, icon, money, animate, haptic, store, sheet, sheetActions, focusTitle, toast, esc } = api;
      const D = api.data;
      const answers = Object.assign({}, store.get("moveProfile") || {});
      delete answers.at;
      // Sample students start with their own facts selected; "you" starts blank.
      if (D.source === "sample" && !complete(answers)) {
        const f = api.facts();
        answers.kitchen = answers.kitchen || f.kitchen;
        answers.subway = answers.subway || (f.subwayMinutes == null ? "none" : f.subwayMinutes < 15 ? "u15" : f.subwayMinutes <= 30 ? "15-30" : "30+");
        answers.meal = answers.meal || (f.hasMealPlan ? "yes" : "no");
        answers.nights = answers.nights || (f.lateNights >= 3 ? "3+" : f.lateNights > 0 ? "1-2" : "0");
      }

      sheet((body, close) => {
        const stage = el(`<div class="mi-stage"></div>`);
        body.appendChild(stage);
        const swapIn = (node, dir = 1) => {
          stage.replaceChildren(node); body.scrollTop = 0;
          animate(node, [{ opacity: 0, translate: `${dir * 24}px 0` }, { opacity: 1, translate: "0 0" }], { preset: "standard" });
          focusTitle(node);
        };

        // ---- Questions: select, then Next ----
        function question(k, dir = 1) {
          const q = Q[k];
          const node = el(`<div class="mi-step">
            <p class="t-foot t-2 mi-count">${k + 1} of ${Q.length}</p>
            <h2 class="t-title" id="mi-q">${q.q}</h2>
            ${q.hint ? `<p class="t-sub t-2 mi-hint">${q.hint}</p>` : `<div class="mi-gap-s"></div>`}
            <div class="choices mi-opts" role="radiogroup" aria-labelledby="mi-q">${q.opts.map(([v, label]) => `<button class="choice" role="radio" aria-checked="${answers[q.key] === v}" data-v="${v}">
              <span class="grow"><b>${label}</b></span><span class="tick" aria-hidden="true">${icon("check", 14, 3)}</span></button>`).join("")}</div>
          </div>`);
          swapIn(node, dir);
          const opts = [...node.querySelectorAll(".choice")];
          const sync = () => {
            const i = Math.max(0, opts.findIndex(o => o.getAttribute("aria-checked") === "true"));
            opts.forEach((o, j) => (o.tabIndex = j === i ? 0 : -1));
            next.disabled = answers[q.key] == null;
          };
          const choose = (o, focus) => {
            opts.forEach(x => x.setAttribute("aria-checked", String(x === o)));
            answers[q.key] = o.dataset.v;
            haptic();
            animate(o.querySelector(".tick"), [{ scale: .6 }, { scale: 1 }], { preset: "snappy" });
            sync();
            if (focus) o.focus();
          };
          opts.forEach(o => o.addEventListener("click", () => choose(o)));
          node.querySelector(".mi-opts").addEventListener("keydown", e => {
            const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
            if (!d) return;
            e.preventDefault();
            const i = (opts.indexOf(document.activeElement) + d + opts.length) % opts.length;
            choose(opts[i], true);
          });
          const last = k === Q.length - 1;
          const buttons = [];
          if (k > 0) buttons.push({ label: "Back", kind: "secondary", icon: "back", onClick: () => { haptic(); question(k - 1, -1); } });
          buttons.push({ label: last ? "See changes" : "Next", onClick: () => {
            if (answers[q.key] == null) return;
            haptic();
            if (!last) return question(k + 1, 1);
            store.set("moveProfile", Object.assign({}, answers, { at: Date.now() }));
            haptic("success");
            results();
          } });
          const bar = sheetActions(body, buttons);
          const next = bar.lastElementChild;
          sync();
        }

        // ---- What changed ----
        function results() {
          const A = analysis(api), sugs = suggest(api, answers), isYou = D.id === "you";
          const rows = D.weekly, first = rows[0].wk, lastWk = rows[rows.length - 1].wk;
          const badge = typeof api.badge === "function" ? api.badge("weekly") : isYou ? `<span class="real">Real</span>` : `<span class="sample">Sample</span>`;
          const metric = A.moved ? KIND_NAME[A.kind] : null;
          const md = A.moved ? fmtDay(D.move.date) : "";
          const hint = !A.moved ? "Same place as last year" : `Moved ${md}`;
          const head = A.moved ? `${metric} a week` : "Food and getting around a week";
          const cls = A.moved ? (A.kind === "ride" || A.kind === "transit" ? "move" : "food") : null;
          const nightsOut = answers.nights === "1-2" || answers.nights === "3+";
          const gapsReal = api.isReal("priceGaps");
          // Price gaps that match the card: the one place it names, or all of them for the adapted card.
          const gapsFor = s => {
            if (!/pick ?up/i.test(s.title) || !D.priceGaps || !D.priceGaps.length) return [];
            if (s.adapted) return D.priceGaps;
            const place = s.title.replace(/^pick ?up\s+/i, "").toLowerCase();
            return D.priceGaps.filter(g => g.place.toLowerCase() === place);
          };
          const sugHTML = sugs.map((s, i) => `<div class="card mi-sug" data-id="${esc(s.id)}">
              <div class="mi-sug-top">${api.brandMark(brandOf(api, s), s.kind === "move" ? "move" : "food", 36)}
                <div><b class="t-headline" id="mi-sug-${i}">${esc(plain(s.title))}</b><p class="t-sub t-2">${esc(s.detail)}</p></div></div>
              ${gapsFor(s).length ? `<div class="tile mi-gaps"><div class="mi-gaps-head t-foot"><span>${gapsReal ? "Your past orders" : "Past orders"}</span></div><div class="mi-gap mi-gap-cols t-cap t-3" aria-hidden="true"><span></span><span></span><span>Pickup</span><span>Delivered</span></div>${gapsFor(s).map(g => `<div class="mi-gap t-foot">${api.brandMark(g.place, "dining", 20)}<span>${esc(g.place)}</span><span class="num"><b>${money(g.pickup)}</b><span class="vh"> pickup</span></span><span class="num">${money(g.delivered)}<span class="vh"> delivered</span></span></div>`).join("")}</div>` : ""}
              <div class="mi-save"><b class="num t-headline">About ${money(s.save)} ${UNIT[s.unit] || "a " + s.unit}</b><span class="t-foot t-3">${esc(String(s.basis).replace(/\s*→\s*/g, " vs "))}</span></div>
              <button class="btn ${i === 0 ? "primary" : "plain"} block mi-add" aria-pressed="false" aria-describedby="mi-sug-${i}">${icon("check", 18, 2.4)}<span>Make it this week's swap</span></button>
            </div>`).join("");
          const node = el(`<div class="mi-step mi-res">
            <h2 class="t-title">${A.moved ? "What changed" : "No big change found"}</h2>
            <p class="t-sub t-2 mi-hint">${hint}</p>
            <div class="card mi-chartcard">
              <div class="mi-chart-head"><b class="t-headline">${head}</b>${badge}</div>
              <div class="mi-chartwrap"><svg class="mi-chart" role="img" preserveAspectRatio="xMidYMid meet"></svg></div>
              <div class="mi-legend t-foot t-2" aria-hidden="true">${A.moved
                ? `<span><i class="dot ${cls}"></i>${metric}</span><span><i class="mi-dash"></i>Average</span><span><i class="mi-mk"></i>Move</span>`
                : `<span><i class="dot food"></i>Food</span><span><i class="dot move"></i>Getting around</span><span><i class="mi-dash"></i>Usual week <b class="num">${money(D.usual.total)}</b></span>`}</div>
              <p class="t-foot t-3 mi-cap">${fmtDay(first, true)} – ${fmtDay(lastWk, true)}${isYou ? " · No airport rides" : ""}</p>
              <details class="mi-data"><summary class="t-foot">Show data</summary>
                <table class="t-foot"><thead><tr><th scope="col">Week of</th>${A.moved ? `<th scope="col">${metric}</th>` : `<th scope="col">Food</th><th scope="col">Getting around</th>`}</tr></thead>
                <tbody>${rows.map(r => A.moved ? `<tr><td>${fmtDay(r.wk, true)}</td><td class="num">${money(r[A.kind] || 0)}</td></tr>`
                  : `<tr><td>${fmtDay(r.wk, true)}</td><td class="num">${money(r.dining + (r.drinks || 0) + r.quick + r.delivery)}</td><td class="num">${money(r.ride + r.transit)}</td></tr>`).join("")}</tbody></table>
              </details>
            </div>
            ${A.moved ? `<div class="card mi-avgs">
              <div><div class="t-foot t-2">${esc(D.move.beforeLabel)}</div><div class="n-m">${money(A.before)}</div><div class="t-foot t-3">a week</div>${A.perBefore != null ? `<div class="t-foot t-3">${A.perBefore} rides a week</div>` : ""}</div>
              <div><div class="t-foot t-2">${esc(D.move.afterLabel)}</div><div class="n-m">${money(A.after)}</div><div class="t-foot t-3">a week</div>${A.perAfter != null ? `<div class="t-foot t-3">${A.perAfter} rides a week</div>` : ""}</div>
            </div>` : ""}
            <h3 class="section-title">Swaps that fit</h3>
            ${sugs.length ? `<div class="mi-sugs">${sugHTML}</div>` : `<p class="t-sub t-2 mi-hint">No swaps fit these answers.</p>`}
            ${nightsOut ? `<p class="mi-protect t-foot t-2">${icon("moon", 16, 2)}<span>Night rides, 11 PM–6 AM: always OK</span></p>` : ""}
          </div>`);
          swapIn(node, 1);

          const svg = node.querySelector(".mi-chart"), wrap = node.querySelector(".mi-chartwrap");
          if (A.moved) {
            drawChart(svg, wrap, api, {
              series: [{ get: r => r[A.kind] || 0, cls }],
              marker: { date: D.move.date, label: `Moved ${md}` },
              avgs: [{ side: "before", v: A.before }, { side: "after", v: A.after }],
              label: `${metric} a week, ${fmtDay(first, true)} to ${fmtDay(lastWk, true)}. Moved ${md}. ${D.move.beforeLabel}: ${money(A.before)} a week. ${D.move.afterLabel}: ${money(A.after)} a week.`
            });
          } else {
            drawChart(svg, wrap, api, {
              series: [{ get: r => r.dining + (r.drinks || 0) + r.quick + r.delivery, cls: "food" }, { get: r => r.ride + r.transit, cls: "move" }],
              usual: D.usual.total,
              label: `Food and getting around per week, ${fmtDay(first, true)} to ${fmtDay(lastWk, true)}. Usual week ${money(D.usual.total)}. No step change.`
            });
          }

          // "This week's swap": one shared pick (store "deckPick"), same wording as the deck and receipt.
          const paint = () => node.querySelectorAll(".mi-sug").forEach(c => {
            c.querySelector(".mi-add").setAttribute("aria-pressed", String(store.get("deckPick") === c.dataset.id));
          });
          paint();
          node.querySelectorAll(".mi-sug").forEach(c => c.querySelector(".mi-add").addEventListener("click", e => {
            const s = sugs.find(x => x.id === c.dataset.id);
            if (store.get("deckPick") === s.id) return;
            if (s.built || s.adapted) store.set("deckPickInfo", { id: s.id, title: s.title, save: s.save, unit: s.unit, kind: s.kind });
            store.set("deckPick", s.id);
            paint();
            haptic("success");
            animate(e.currentTarget, [{ scale: .96 }, { scale: 1 }], { preset: "snappy" });
            toast(`This week's swap: ${plain(s.title)}`);
          }));

          sheetActions(body, [
            { label: "Edit answers", kind: "secondary", onClick: () => { haptic(); question(0, -1); } },
            { label: "Done", onClick: () => close() }
          ]);
        }

        if (complete(store.get("moveProfile"))) results(); else question(0);
      }, { label: "Move-in" });
    }
  });
})();
