/* By day (Scrub the week).
   Week tab, under the hero. Before the guess: bar shapes only, no amounts ("Guess first").
   After the guess: a 7-day strip that opens on Sunday with the Mon–Sun total; drag or use arrow keys
   to scrub back. The selected day's charges list below with a one-tap tag (saved per charge id).
   A 24-hour lane places charges that have a time; charges the bank sent without a time get their
   own lane, because Swap never guesses. Night rides are counted and protected. */
(function () {
  const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const GROUP_LABEL = { food: "Food", move: "Getting around", night: "Night ride", other: "Everything else" };
  const GROUPS = ["food", "move", "night", "other"];
  const fmtDate = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  // Day labels from the same week start the header uses. core's api.weekDays() wins when present.
  function weekDates(api) {
    const D = api.data;
    if (typeof api.weekDays === "function") {
      try {
        const w = api.weekDays();
        if (Array.isArray(w) && w.length === 7) {
          const out = w.map(x => x instanceof Date ? fmtDate(x)
            : typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x) ? fmtDate(new Date(x.slice(0, 10) + "T12:00:00"))
            : x && x.date ? fmtDate(x.date instanceof Date ? x.date : new Date(String(x.date).slice(0, 10) + "T12:00:00"))
            : x && (x.short || x.label) ? String(x.short || x.label) : null);
          if (out.every(Boolean)) return out;
        }
      } catch (e) {}
    }
    const start = new Date((D.weekStart || D.today) + "T12:00:00");
    return DAY.map((_, k) => { const d = new Date(start); d.setDate(start.getDate() + k); return fmtDate(d); });
  }
  // Bank names, cleaned for reading. core's api.displayMerchant() names the ride app (Lower-fare app on the
  // private build); it is shown, never suggested, and gets the generic ride glyph, not a logo.
  const rideApp = (api, name) => typeof api.isRideApp === "function" ? api.isRideApp(name) : /lower-fare|rideapp/i.test(String(name || ""));
  function displayName(api, name) {
    let n = String(typeof api.displayMerchant === "function" ? api.displayMerchant(name) : name || "").trim();
    if (n && n === n.toLowerCase()) n = n.replace(/(^|[\s.'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
    return n.replace(/\bNyu\b/g, "NYU").replace(/\bMta\b/g, "MTA");
  }

  Swap.feature({
    id: "scrub",
    title: "By day",
    pitch: "Each day's charges and times.",
    tab: "week",
    order: 2,

    render(slot, api) {
      const { el, icon, money, store, haptic, animate, esc } = api;
      const D = api.data, NW = D.nightWindow;
      const offs = [];
      let disposed = false;

      const dates = weekDates(api);
      const guessOf = () => { const g = store.get("guess"); return g && (!g.week || g.week === D.weekStart) ? g : null; };
      const hourOf = tm => (tm ? +tm.slice(0, 2) + +tm.slice(3, 5) / 60 : null);
      const nightHour = h => h != null && (h >= NW.start || h < NW.end);
      const clock = tm => { const [h, m] = tm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
      const rawTag = id => (D.charges.find(c => c.id === id) || {}).tag;
      let charges = [];
      // Founder's build: every bank transaction that week, not just food and rides. Food and ride
      // charges keep their tags; everything else (Zelle, shopping, pay) is "other". Money in shows
      // in the day's list with a +, but never adds to the day's total.
      const load = () => {
        charges = api.charges();
        const B = api.profile() === "you" && window.SwapLive && window.SwapLive.bank;
        if (B && Array.isArray(B.items)) {
          B.items.filter(i => i.week === "last" && !i.swap).forEach(i => charges.push({ id: "bk-" + i.id, day: i.day, time: i.time,
            merchant: i.name, amount: i.amount, kind: "other", cat: i.cat, pending: i.pending }));
        }
      };
      const groupOf = c => c.kind === "other" ? "other" : api.kindOf(c);   // food | move | night | other
      // A ride or charge between midnight and 6 AM belongs to the evening before. core's api.dayOf() wins.
      const dayOf = c => {
        if (typeof api.dayOf === "function") { const d = api.dayOf(c); if (Number.isInteger(d)) return d; }
        return c.time && +c.time.slice(0, 2) < NW.end && c.day > 0 ? c.day - 1 : c.day;
      };
      const ofDay = d => charges.filter(c => dayOf(c) === d).sort((a, b) => (a.time == null) - (b.time == null) || (a.time && b.time ? late(a.time).localeCompare(late(b.time)) : 0));
      const late = tm => (+tm.slice(0, 2) < NW.end ? "2" : "1") + tm;   // after midnight sorts after the evening
      const dayTotals = () => DAY.map((_, d) => {
        const t = { food: 0, move: 0, night: 0, other: 0, all: 0, n: 0 };
        ofDay(d).forEach(c => { if (c.amount < 0) return; t[groupOf(c)] += c.amount; t.all += c.amount; t.n++; });
        return t;
      });

      function build() {
        load();
        const guessed = !!guessOf();
        slot.replaceChildren();
        return guessed ? unlocked() : locked();
      }

      // Bars only: shape of the week without a single amount.
      function barsHTML(totals, maxDay, neutral) {
        return DAY.map((d, k) => {
          const t = totals[k];
          const segs = neutral ? `<i class="sc-ghost" style="flex:1 1 0"></i>` : GROUPS.filter(g => t[g] > 0).map(g => `<i class="fill-${g}" style="flex:${t[g]} 1 0"></i>`).join("");
          return `<div class="sc-col" aria-hidden="true"><div class="sc-barwrap"><div class="sc-bar" style="height:${(100 * t.all / maxDay).toFixed(1)}%">${segs}</div></div><b class="t-foot">${d}</b>${neutral ? "" : `<span class="num t-foot">${money(t.all)}</span>`}</div>`;
        }).join("");
      }

      // ---------- Before the guess ----------
      function locked() {
        const totals = dayTotals(), maxDay = Math.max(1, ...totals.map(t => t.all));
        const root = el(`<div class="sc">
          <h2 class="section-title">By day</h2>
          <div class="card sc-card sc-locked">
            <div class="sc-strip static">${barsHTML(totals, maxDay, true)}</div>
            <p class="sc-lockmsg t-sub t-2">Amounts show after you guess.</p>
          </div>
        </div>`);
        slot.appendChild(root);
        return () => {};
      }

      // ---------- After the guess ----------
      function unlocked() {
        let totals = dayTotals();
        const maxDay = Math.max(1, ...totals.map(t => t.all));
        const timedCount = charges.filter(c => c.time).length;
        const runTo = k => totals.slice(0, k + 1).reduce((s, t) => s + t.all, 0);
        const rangeOf = k => (k === 0 ? "Mon" : `Mon–${DAY[k]}`);

        const hasTimes = timedCount > 0;
        const root = el(`<div class="sc">
          <h2 class="section-title">By day</h2>
          <div class="card sc-card">
            <div class="sc-head">
              <div><div class="t-foot t-2 sc-range">Mon–Sun</div><div class="n-l sc-total">$0</div></div>
              <div class="sc-day t-foot"></div>
            </div>
            <div class="sc-strip" role="slider" tabindex="0" aria-label="Day of the week" aria-valuemin="0" aria-valuemax="6">
              <span class="sc-lens" aria-hidden="true"></span>
              ${barsHTML(totals, maxDay, false)}
            </div>
            <div class="sc-legend t-foot t-2" aria-hidden="true">${GROUPS.filter(g => totals.some(t => t[g] > 0)).map(g => `<span><i class="dot ${g}"></i>${GROUP_LABEL[g]}</span>`).join("")}</div>
            <ul class="sc-list" aria-label="Charges"></ul>
            <p class="sc-protect t-foot t-2" hidden>${icon("moon", 14, 2)}<span>Night rides, 11 PM–6 AM: always OK</span></p>
            ${hasTimes ? "" : `<p class="sc-notimes t-foot t-2">Bank sent no times.</p>`}
          </div>
          ${hasTimes ? `<h2 class="section-title">Time of day</h2>
          <div class="card sc-time">
            <div class="sc-time-head"><span class="t-sub t-2 sc-lane-day"></span></div>
            <div class="sc-lane" role="img">
              <span class="sc-band a"></span><span class="sc-band b"></span>
              <span class="sc-moon">${icon("moon", 14, 2)}</span>
              <span class="sc-grid" style="left:25%"></span><span class="sc-grid" style="left:50%"></span><span class="sc-grid" style="left:75%"></span>
              <span class="sc-base"></span>
              <div class="sc-marks"></div>
            </div>
            <div class="sc-axis t-cap t-3" aria-hidden="true"><span style="left:0">12 AM</span><span style="left:25%">6 AM</span><span style="left:50%">Noon</span><span style="left:75%">6 PM</span><span style="left:100%">12 AM</span></div>
            <div class="sc-key t-foot t-2"><i></i>Night, 11 PM–6 AM</div>
            <p class="sc-none t-foot t-2"></p>
          </div>` : ""}
        </div>`);
        slot.appendChild(root);

        const $ = s => root.querySelector(s);
        const strip = $(".sc-strip"), lens = $(".sc-lens"), list = $(".sc-list"), protect = $(".sc-protect");
        const cols = [...root.querySelectorAll(".sc-col")], bars = cols.map(c => c.querySelector(".sc-bar"));
        const rangeEl = $(".sc-range"), totalEl = $(".sc-total"), dayEl = $(".sc-day");
        const marks = $(".sc-marks"), noneEl = $(".sc-none"), lane = $(".sc-lane");

        const paintBars = () => {
          totals = dayTotals();
          bars.forEach((b, k) => {
            const t = totals[k];
            b.innerHTML = GROUPS.filter(g => t[g] > 0).map(g => `<i class="fill-${g}" style="flex:${t[g]} 1 0"></i>`).join("");
          });
        };

        // Lens: one spring, interruptible from wherever it is.
        const moveLens = (k, instant) => {
          const to = `${k * 100}% 0`;
          const from = getComputedStyle(lens).translate;
          lens.getAnimations().forEach(a => a.cancel());
          lens.style.translate = to;
          if (instant || api.reduced) return;
          animate(lens, [{ translate: !from || from === "none" ? "0px 0px" : from }, { translate: to }], { preset: "standard" });
        };

        // Running total: quiet, under 250ms.
        let shown = 0, tw = 0;
        const setTotal = to => {
          const id = ++tw, from = shown, t0 = performance.now(), dur = 220;
          if (api.reduced) { shown = to; totalEl.textContent = money(to); return; }
          const step = now => {
            if (id !== tw || disposed) return;
            const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
            shown = from + (to - from) * e; totalEl.textContent = money(Math.round(shown));
            if (p < 1) requestAnimationFrame(step); else shown = to;
          };
          requestAnimationFrame(step);
          setTimeout(() => { if (id === tw && !disposed) { shown = to; totalEl.textContent = money(to); } }, dur + 60);   // lands even if rAF is throttled
        };

        // Day list
        function rowFor(c) {
          if (c.kind === "other") return otherRow(c);
          const g = groupOf(c), tg = c.tag, editable = g !== "night" && (rawTag(c.id) == null || (store.get("tags") || {})[c.id] != null);
          const name = displayName(api, c.merchant);
          const label = g === "night" ? `${icon("moon", 12, 2.2)}Night` : tg ? esc(tg) : `${icon("plus", 12, 2.6)}Tag`;
          const cls = g === "night" ? "prot" : !tg ? "add" : editable ? "set" : "";
          const aria = tg ? `Tag: ${tg}. Change tag for ${name}` : `Add a tag to ${name}`;
          const chip = editable
            ? `<button class="sc-chip ${cls} t-foot" aria-expanded="false" aria-label="${esc(aria)}">${label}</button>`
            : `<span class="sc-chip ${cls} t-foot">${label}</span>`;
          const row = el(`<li class="sc-row" data-id="${esc(c.id)}">
            ${api.brandMark(rideApp(api, c.merchant) ? null : c.merchant, c.kind === "ride" && c.night ? "night" : c.kind, 32)}
            <div class="sc-main"><b class="t-sub"><span class="vh">${GROUP_LABEL[g]}: </span>${esc(name)}</b>
              <div class="sc-meta t-foot">${c.time ? `<span class="num">${clock(c.time)}</span>` : hasTimes ? `<span class="t-3">No time</span>` : ""}${chip}</div></div>
            <span class="amt t-body">${money(c.amount)}</span></li>`);
          if (editable) row.querySelector("button.sc-chip").addEventListener("click", () => togglePick(row, c));
          return row;
        }
        function otherRow(c) {
          const name = displayName(api, c.merchant), inn = c.amount < 0;
          const ch = String(name).replace(/^zelle (to|from) /i, "").trim().charAt(0).toUpperCase() || "$";
          const mark = !/^zelle|^venmo/i.test(name) && api.logo(name) ? api.brandMark(name, "food", 32) : `<span class="sc-mono${inn ? " in" : ""}" aria-hidden="true">${esc(ch)}</span>`;
          return el(`<li class="sc-row" data-id="${esc(c.id)}">${mark}
            <div class="sc-main"><b class="t-sub"><span class="vh">${inn ? "Money in" : GROUP_LABEL.other}: </span>${esc(name)}</b>
              <div class="sc-meta t-foot"><span class="t-3">${esc(c.cat || "")}${c.time ? ` · ${clock(c.time)}` : ""}${c.pending ? " · Pending" : ""}</span></div></div>
            <span class="amt t-body${inn ? " sc-in" : ""}">${inn ? "+" + money(-c.amount, 2) : money(c.amount)}</span></li>`);
        }
        function renderList() {
          const day = ofDay(sel);
          list.replaceChildren(...(day.length ? day.map(rowFor) : [el(`<li class="sc-row sc-nocharges t-sub t-2">No charges</li>`)]));
          protect.hidden = !day.some(c => groupOf(c) === "night");
        }
        function closePicks() {
          list.querySelectorAll(".sc-pick").forEach(p => p.remove());
          list.querySelectorAll('[aria-expanded="true"]').forEach(b => b.setAttribute("aria-expanded", "false"));
        }
        function togglePick(row, c) {
          const wasOpen = !!row.querySelector(".sc-pick");
          closePicks();
          if (wasOpen) return;
          haptic();
          const chip = row.querySelector("button.sc-chip"), cur = c.tag;
          const opts = D.tags[groupOf(c) === "food" ? "food" : "move"];
          const pick = el(`<div class="sc-pick" role="group" aria-label="Tag ${esc(displayName(api, c.merchant))}">${opts.map(o => `<button class="chip" aria-pressed="${o === cur}">${esc(o)}</button>`).join("")}</div>`);
          row.appendChild(pick);
          chip.setAttribute("aria-expanded", "true");
          pick.querySelectorAll("button").forEach(b => b.addEventListener("click", () => save(c, b.textContent)));
          pick.addEventListener("keydown", e => { if (e.key === "Escape") { closePicks(); chip.focus(); } });
          animate(pick, [{ opacity: 0, translate: "0 -4px" }, { opacity: 1, translate: "0 0" }], { duration: 180, easing: "ease-out" });
          pick.querySelector("button").focus({ preventScroll: true });
        }
        let selfWrite = false;
        function save(c, tag) {
          const t = Object.assign({}, store.get("tags") || {}); t[c.id] = tag;
          selfWrite = true; store.set("tags", t); selfWrite = false;
          haptic("success");
          refresh();
          const chip = list.querySelector(`.sc-row[data-id="${c.id}"] .sc-chip`);
          if (chip) { chip.focus({ preventScroll: true }); animate(chip, [{ scale: .9 }, { scale: 1 }], { preset: "snappy" }); }
          api.toast(tag === "night" ? `${displayName(api, c.merchant)}: night ride` : `Tagged ${tag}`, tag === "night" ? "moon" : "check");
        }
        const refresh = () => { load(); paintBars(); renderList(); renderLane(); syncValue(); };
        const offTags = store.on("tags", () => { if (!selfWrite) refresh(); });

        // 24-hour lane + no-time lane
        function renderLane() {
          if (!hasTimes) return;
          const day = ofDay(sel), timed = day.filter(c => c.time), none = day.filter(c => !c.time);
          $(".sc-lane-day").textContent = `${DAY_LONG[sel]}, ${dates[sel]}`;
          marks.replaceChildren();
          let prevX = -99, up = false;
          timed.forEach(c => {
            const x = (100 * hourOf(c.time)) / 24, g = groupOf(c);
            up = x - prevX < 12 ? !up : false; prevX = x;
            marks.appendChild(el(`<span class="sc-mk g-${g}${x < 8 ? " l" : x > 92 ? " r" : ""}${up ? " up" : ""}" style="left:${x.toFixed(2)}%"><b class="num t-cap">${money(c.amount)}</b><i class="fill-${g}"></i></span>`));
          });
          if (!timed.length) marks.innerHTML = `<span class="sc-empty t-foot t-3">No times this day</span>`;
          lane.setAttribute("aria-label", timed.length
            ? `${DAY_LONG[sel]}: ` + timed.map(c => `${GROUP_LABEL[groupOf(c)].toLowerCase()}, ${displayName(api, c.merchant)} ${money(c.amount)} at ${clock(c.time)}${nightHour(hourOf(c.time)) ? ", night window" : ""}`).join("; ")
            : `${DAY_LONG[sel]}: no charges with a time`);
          noneEl.textContent = none.length ? `${none.length} ${none.length === 1 ? "charge" : "charges"} with no time` : "";
          noneEl.hidden = !none.length;
        }

        // Selection
        let sel = -1;
        function syncValue() {
          const t = totals[sel], run = runTo(sel);
          const split = GROUPS.filter(g => t[g] > 0).map(g => `${GROUP_LABEL[g].toLowerCase()} ${money(t[g])}`).join(", ");
          strip.setAttribute("aria-valuenow", sel);
          strip.setAttribute("aria-valuetext", `${DAY_LONG[sel]}, ${dates[sel]}: ${money(t.all)}${split ? ` (${split})` : ""}. ${rangeOf(sel)} total ${money(run)}.`);
          dayEl.innerHTML = `<div class="t-2">${DAY[sel]}, ${dates[sel]}</div><div class="num sc-daysum">${money(t.all)} · ${t.n} charge${t.n === 1 ? "" : "s"}</div>`;
          rangeEl.textContent = rangeOf(sel);
          cols.forEach((c, j) => { c.classList.toggle("on", j === sel); c.classList.toggle("after", j > sel); });
        }
        function select(k, first) {
          k = Math.max(0, Math.min(6, k));
          if (k === sel) return;
          sel = k;
          moveLens(k, first);
          syncValue();
          if (first) { shown = runTo(k); totalEl.textContent = money(shown); }
          else { haptic(); setTotal(runTo(k)); }
          renderList();
          renderLane();
        }

        const kFromX = x => { const r = strip.getBoundingClientRect(); return Math.floor(((x - r.left) / r.width) * 7); };
        const lift = on => strip.classList.toggle("lift", on);
        strip.addEventListener("pointerdown", e => {
          if (e.button > 0) return;
          try { strip.setPointerCapture(e.pointerId); } catch (err) {}
          lift(true); closePicks(); select(kFromX(e.clientX));
        });
        strip.addEventListener("pointermove", e => { if (strip.hasPointerCapture && strip.hasPointerCapture(e.pointerId)) select(kFromX(e.clientX)); });
        ["pointerup", "pointercancel", "lostpointercapture"].forEach(tp => strip.addEventListener(tp, () => lift(false)));
        strip.addEventListener("keydown", e => {
          const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
          if (step) select(sel + step);
          else if (e.key === "Home") select(0);
          else if (e.key === "End") select(6);
          else return;
          e.preventDefault();
        });

        select(6, true);   // opens on Sunday: Mon–Sun total, every bar full strength
        return () => offTags();
      }

      let inner = build();
      offs.push(store.on("guess", () => { inner && inner(); inner = build(); }));
      return () => { disposed = true; inner && inner(); offs.forEach(f => f()); };
    }
  });
})();
