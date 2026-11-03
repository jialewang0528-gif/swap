/* Guess your week.
   Week tab hero: the cap (with its one-line formula), the usual week and a status line. The week
   total stays hidden until the student guesses it. Flow (one sheet): guess on a dial, reveal with
   a digit roll (the Week tab's one signature motion), print a receipt, share a story-size image
   that shows a percent, never dollars. Works for every profile through api.data / api.charges(). */
(function () {
  // The lower-fare ride app (shown as Lower-fare app on the private build) is never a swap or a logo pick.
  const rideApp = (api, name) => typeof api.isRideApp === "function" ? api.isRideApp(name) : /lower-fare|rideapp/i.test(String(name || ""));
  const UNIT = { week: "a week", order: "an order", meal: "a meal", ride: "a ride", month: "a month" };

  // This week's charges by line. Night rides get their own protected line.
  function summarize(charges) {
    const s = { dining: 0, drinks: 0, quick: 0, delivery: 0, ride: 0, transit: 0, night: 0, rideCount: 0, nightCount: 0 };
    charges.forEach(c => {
      if (c.kind === "ride" && c.night) { s.night += c.amount; s.nightCount++; }
      else { s[c.kind] += c.amount; if (c.kind === "ride") s.rideCount++; }
    });
    s.food = s.dining + s.drinks + s.quick + s.delivery;
    s.move = s.ride + s.transit;   // getting around, not counting night rides
    return s;
  }

  // "This week's swap": the shared pick (store "deckPick"), resolved against this profile's swaps.
  // Move-in can pick a swap it built from the charges; it stores the details in "deckPickInfo".
  function currentPick(api) {
    const id = api.store.get("deckPick"), list = api.swaps();
    const info = api.store.get("deckPickInfo");
    return list.find(s => s.id === id) || (info && info.id === id ? info : null) || list[0] || null;
  }

  // "$600 usual − $100 save − $10 owed". Owed only when there is one.
  const capLine = (api, D) => {
    if (typeof api.capLine === "function") return api.capLine();
    const t = D.thisWeek, m = api.money, owed = t.payback && t.payback.perWeek;
    return `${m(D.usual.total)} usual − ${m(t.saveTarget)} save${owed ? ` − ${m(owed)} owed` : ""}`;
  };
  const weekName = api => typeof api.weekName === "function" ? api.weekName() : "This week";
  // One small badge per screen. Uses core's api.badge(field) when it exists.
  function badge(api, field) {
    if (typeof api.badge === "function") { const b = api.badge(field); if (typeof b === "string") return b; }
    const real = api.isReal(field);
    return real ? `<span class="real">Real</span>` : `<span class="sample">Sample</span>`;
  }
  // The guess belongs to one week. A guess saved for another week does not count.
  function guessOf(api) {
    const g = api.store.get("guess"), wk = typeof api.weekKey === "function" ? api.weekKey() : api.data.weekStart;
    return g && (!g.week || g.week === wk) ? g : null;
  }
  // Pickup swap whose place isn't in the student's own price gaps: show the gaps it really has.
  function adaptSwap(api, s) {
    if (!s || !/^pick ?up\s/i.test(s.title)) return s;
    const gaps = api.data.priceGaps || [], place = s.title.replace(/^pick ?up\s+/i, "").toLowerCase();
    if (!gaps.length || gaps.some(g => g.place.toLowerCase() === place)) return s;
    const avg = Math.round(gaps.reduce((t, g) => t + g.delivered - g.pickup, 0) / gaps.length);
    return Object.assign({}, s, { title: "Pick up instead of delivery", save: avg, unit: "order" });
  }
  // Change the weekly save: core's "You" settings when present, else a small local sheet.
  function openSave(api) {
    for (const k of ["openSettings", "settings", "openYou", "youSheet"]) {
      if (typeof api[k] === "function") { api[k]("save"); return; }
    }
    const { el, money, sheet, sheetActions, haptic, toast } = api;
    const PRESETS = [0, 25, 50, 100, 150];
    sheet((body, close) => {
      const D = api.data;
      const node = el(`<div class="gw-save">
        <p class="t-sub t-2 gw-save-sub">Cap is your usual minus this.</p>
        <div class="gw-save-opts" role="radiogroup" aria-label="Weekly save">${PRESETS.map(v =>
          `<button class="chip" role="radio" aria-checked="${v === D.thisWeek.saveTarget}" data-v="${v}">${money(v)}</button>`).join("")}</div>
        <div class="list"><div class="row"><span class="grow t-sub">Cap</span><span class="amt gw-save-cap" aria-live="polite">${money(D.thisWeek.cap)}</span></div></div>
      </div>`);
      body.appendChild(node);
      const opts = [...node.querySelectorAll("[data-v]")];
      const sync = () => {
        const t = api.data.thisWeek;
        opts.forEach(o => { const on = +o.dataset.v === t.saveTarget; o.setAttribute("aria-checked", String(on)); o.tabIndex = on ? 0 : -1; });
        if (!opts.some(o => o.tabIndex === 0)) opts[0].tabIndex = 0;
        node.querySelector(".gw-save-cap").textContent = money(t.cap);
      };
      const pick = o => { haptic(); const cap = api.setSave(+o.dataset.v); sync(); o.focus(); toast(`Cap ${money(cap)} a week`); };
      opts.forEach(o => o.addEventListener("click", () => pick(o)));
      node.querySelector(".gw-save-opts").addEventListener("keydown", e => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const i = opts.indexOf(document.activeElement);
        pick(opts[(i + d + opts.length) % opts.length]);
      });
      sync();
      sheetActions(body, [{ label: "Done", onClick: () => close() }]);
    }, { label: "Weekly save", title: "Weekly save", detent: "medium", onClose: () => {
      const b = document.querySelector("#slot-guess .gw-cap");
      if (b && (!document.activeElement || document.activeElement === document.body)) b.focus({ preventScroll: true });
    } });
  }
  // A brand name for a swap, so its card can show a logo (Chipotle, DashPass, MTA...). null = category glyph.
  function brandOf(api, s) {
    if (!s) return null;
    const text = `${s.title} ${s.detail || ""}`;
    if (rideApp(api, text)) return null;   // the ride app gets the generic ride glyph, never a logo
    if (api.logo(s.title)) return s.title;
    if (/subway|train/i.test(text)) return "MTA";
    if (api.logo(text)) return text;
    if (/\bride\b/i.test(text)) { const c = api.charges().find(x => x.kind === "ride" && !x.night && x.tag === "out" && !rideApp(api, x.merchant) && api.logo(x.merchant)); return c ? c.merchant : null; }
    return null;
  }

  // Stacked food / getting around / night meter with cap and usual ticks. Hidden segments before the guess.
  function meter(api, revealed) {
    const D = api.data, t = D.thisWeek, s = summarize(api.charges()), money = api.money;
    const scale = Math.max(t.total, t.cap, D.usual.total) * 1.04;
    const pct = v => (100 * v / scale).toFixed(2) + "%";
    const segs = revealed
      ? `<i class="fill-food" style="width:${pct(s.food)}"></i><i class="fill-move" style="width:${pct(s.move)}"></i>${s.night ? `<i class="fill-night" style="width:${pct(s.night)}"></i>` : ""}`
      : "";
    const label = revealed
      ? `This week ${money(t.total)}: food ${money(s.food)}, getting around ${money(s.move)}${s.night ? `, night rides ${money(s.night)}` : ""}. Cap ${money(t.cap)}, usual ${money(D.usual.total)}.`
      : `Cap ${money(t.cap)}, usual ${money(D.usual.total)}. This week is hidden until you guess.`;
    // Both tick labels sit below the bar. If they would collide, the left one aligns right.
    // Labels near an edge turn inward; two close labels near the right edge stack.
    const capL = 100 * t.cap / scale, usualL = 100 * D.usual.total / scale, close = Math.abs(capL - usualL) < 16;
    const side = (me, other) => {
      if (close && me >= other && me > 70) return " l low";
      if (close) return me < other ? " l" : " r";
      return me > 85 ? " l" : me < 15 ? " r" : "";
    };
    return `<div class="gw-meter" role="img" aria-label="${label}">
      <div class="gw-track${revealed ? "" : " hidden"}">${segs}</div>
      <span class="gw-tick${side(capL, usualL)}" style="left:${pct(t.cap)}"><b class="t-cap">Cap</b></span>
      <span class="gw-tick usual${side(usualL, capL)}" style="left:${pct(D.usual.total)}"><b class="t-cap">Usual</b></span>
    </div>`;
  }

  // Story image, 1080 x 1920. Colors come from the design tokens, so this file holds no hex.
  async function storyImage(api, info) {
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const round = css("--round") || "system-ui, sans-serif", sys = css("--sys") || "system-ui, sans-serif";
    const cv = document.createElement("canvas"); cv.width = 1080; cv.height = 1920;
    const c = cv.getContext("2d");
    const rr = (x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
    c.fillStyle = css("--canvas"); c.fillRect(0, 0, 1080, 1920);
    c.textBaseline = "alphabetic";
    // header
    c.fillStyle = css("--ink"); c.font = `700 64px ${sys}`; c.fillText("Swap", 96, 200);
    c.fillStyle = css("--ink-2"); c.font = `500 40px ${sys}`; c.textAlign = "right"; c.fillText(info.weekLabel, 984, 196); c.textAlign = "left";
    // card
    c.save(); c.shadowColor = css("--fill-2"); c.shadowBlur = 60; c.shadowOffsetY = 20;
    c.fillStyle = css("--surface"); rr(72, 300, 936, 1300, 72); c.fill(); c.restore();
    // headline number
    c.fillStyle = css("--ink"); c.font = `700 300px ${round}`; c.fillText(info.big, 140, 700);
    c.font = `700 76px ${sys}`; c.fillText(info.line1, 144, 820);
    c.fillStyle = css("--ink-2"); c.font = `400 52px ${sys}`; c.fillText(info.line2, 144, 896);
    // bars: this week vs usual, proportional, no dollars
    const W = 792, x0 = 144, scale = Math.max(info.week, info.usual);
    const bar = (y, label, parts) => {
      c.fillStyle = css("--ink-2"); c.font = `600 40px ${sys}`; c.fillText(label, x0, y);
      let x = x0;
      c.save(); rr(x0, y + 28, W, 64, 32); c.clip();
      c.fillStyle = css("--fill"); c.fillRect(x0, y + 28, W, 64);
      parts.forEach(([v, fill]) => { const w = W * v / scale; if (w <= 0) return; c.fillStyle = fill; c.fillRect(x, y + 28, Math.max(0, w - 6), 64); x += w; });
      c.restore();
    };
    const hatch = (() => { const p = document.createElement("canvas"); p.width = p.height = 24; const q = p.getContext("2d");
      q.fillStyle = css("--night"); q.fillRect(0, 0, 24, 24); q.strokeStyle = css("--night-soft"); q.lineWidth = 6;
      q.beginPath(); q.moveTo(-6, 30); q.lineTo(30, -6); q.moveTo(-18, 18); q.lineTo(18, -18); q.moveTo(6, 42); q.lineTo(42, 6); q.stroke();
      return c.createPattern(p, "repeat"); })();
    bar(1090, info.label || "This week", [[info.food, css("--food")], [info.move, css("--move")], [info.night, hatch]]);
    bar(1250, "My usual week", [[info.usual, css("--ink-4")]]);
    // legend
    c.font = `500 36px ${sys}`; let lx = x0;
    [["Food", css("--food")], ["Getting around", css("--move")], ["Night rides", hatch]].forEach(([t, f]) => {
      c.fillStyle = f; rr(lx, 1406, 28, 28, 8); c.fill(); c.fillStyle = css("--ink-2"); c.fillText(t, lx + 42, 1432); lx += 70 + c.measureText(t).width;
    });
    c.fillStyle = css("--ink-3"); c.font = `400 34px ${sys}`; c.fillText(info.foot, x0, 1530);
    c.fillStyle = css("--ink-3"); c.font = `500 36px ${sys}`; c.textAlign = "center"; c.fillText("No dollar amounts shared", 540, 1720);
    return new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error("Could not draw the image"))), "image/png"));
  }

  // NumberFlow-style roll: every digit is a reel of 0-9 (twice), springing to its value right to left.
  function roll(host, text, api) {
    host.textContent = "";
    const reels = [];
    for (const ch of text) {
      if (/\d/.test(ch)) {
        const w = document.createElement("span"); w.className = "gw-dg";
        const reel = document.createElement("span"); reel.className = "gw-reel";
        reel.innerHTML = Array.from({ length: 20 }, (_, i) => `<span>${i % 10}</span>`).join("");
        w.appendChild(reel); host.appendChild(w); reels.push([reel, +ch]);
      } else { const s = document.createElement("span"); s.textContent = ch; host.appendChild(s); }
    }
    // Each digit row is exactly 1em tall, so move in em: pixel measurements are wrong when the phone frame is scaled.
    const y = n => `translateY(${-n}em)`;
    const n = reels.length;
    api.animate(host, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    if (api.reduced) { reels.forEach(([reel, d]) => (reel.style.transform = y(10 + d))); return Promise.resolve(); }   // cross-fade only
    return Promise.all(reels.map(([reel, d], k) => {
      reel.style.transform = y(10 + d);
      return api.animate(reel, [{ transform: y(0) }, { transform: y(10 + d) }], { preset: "gentle", delay: 120 + (n - 1 - k) * 40 });
    }));
  }

  Swap.feature({
    id: "guess",
    title: "Guess your week",
    pitch: "Guess the week, then see it.",
    tab: "week",
    order: 1,

    render(slot, api) {
      const { el, icon, money, store } = api;
      // The founder's live build checks in every day, so nothing waits behind the guess: open the
      // week without asking. The guess game stays for sample profiles.
      if (api.data.live && !guessOf(api)) {
        const wk = typeof api.weekKey === "function" ? api.weekKey() : api.data.weekStart;
        store.set("guess", { week: wk, value: Math.round(api.data.thisWeek.total), auto: true });
      }
      const self = this;
      const draw = () => {
        const D = api.data, t = D.thisWeek, g = guessOf(api);
        const s = summarize(api.charges());
        const capDiff = t.total - t.cap, usualDiff = t.total - D.usual.total;
        // Under the cap: say by how much. Over it: no gap word, the cap row shows both numbers.
        const status = g && capDiff <= 0 ? `${money(-capDiff)} under cap` : "";
        const vsUsual = g ? (usualDiff === 0 ? "Right at your usual week" : `${money(Math.abs(usualDiff))} ${usualDiff < 0 ? "below" : "above"} usual week`) : "";
        const owed = t.payback && t.payback.owed > 0 ? `<p class="t-foot t-3 gw-note">You owe ${money(t.payback.perWeek)}/wk · ${t.payback.weeksLeft} wks left</p>` : "";
        const node = el(`<section class="card hero gw-hero" aria-labelledby="gw-h">
          <div class="gw-hero-top"><h2 class="t-headline" id="gw-h">${typeof api.dailyPlan === "function" && api.dailyPlan() ? `Last week · ${api.esc(D.weekLabel)}` : "Food and getting around"}</h2>${badge(api, "thisWeek")}</div>
          <div class="gw-total">${g
            ? `<span class="n-xl">${money(t.total)}</span>`
            : `<span class="n-xl gw-mask" aria-hidden="true">$•••</span><span class="vh">Hidden until you guess</span>`}</div>
          ${status ? `<p class="gw-status t-title3">${status}</p>` : ""}
          ${vsUsual ? `<p class="t-foot t-2 gw-vs">${vsUsual}</p>` : ""}
          ${meter(api, !!g)}
          ${g ? `<div class="gw-legend t-foot t-2"><span><i class="dot food"></i>Food <b class="num">${money(s.food)}</b></span><span><i class="dot move"></i>Getting around <b class="num">${money(s.move)}</b></span>${s.night ? `<span><i class="dot night"></i>Night <b class="num">${money(s.night)}</b></span>` : ""}</div>` : ""}
          <div class="list gw-rows">
            <button class="row gw-cap" aria-label="Cap ${money(t.cap)}. ${capLine(api, D)}. Change weekly save">
              <span class="grow"><span class="t-body">Cap</span><span class="t-foot t-2 num gw-formula">${capLine(api, D)}</span></span>
              <span class="amt t-body">${money(t.cap)}</span>${icon("chevron", 18, 2.2)}</button>
          </div>
          ${owed}
          ${g
            ? `<div class="list gw-links">
                <button class="row gw-link" data-go="receipt"><span class="grow t-body">Receipt${g.auto ? "" : ` <span class="t-3 t-sub">· you guessed ${money(g.value)}</span>`}</span>${icon("chevron", 18, 2.2)}</button></div>`
            : `<button class="btn primary block gw-cta" data-go="guess">Guess your week</button>`}
        </section>`);
        node.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => { api.haptic(); self.open(api, b.dataset.go); }));
        node.querySelector(".gw-cap").addEventListener("click", () => { api.haptic(); openSave(api); });
        slot.replaceChildren(node);
      };
      draw();
      const off = store.on("guess", draw);
      return () => off();
    },

    open(api, startAt) {
      const { el, icon, money, animate, haptic, store, sheet, sheetActions, focusTitle, toast, esc } = api;
      const D = api.data, t = D.thisWeek;
      const items = summarize(api.charges());
      let storyURL = null;

      sheet((body, close) => {
        const stage = el(`<div class="gw-stage"></div>`);
        body.appendChild(stage);
        const swapIn = node => {
          stage.replaceChildren(node); body.scrollTop = 0;
          animate(node, [{ opacity: 0, translate: "0 16px" }, { opacity: 1, translate: "0 0" }], { preset: "standard" });
          focusTitle(node);
        };

        // ---- Step 1: guess on a dial ----
        function guessStep() {
          const STEP = 10;
          const MAX = Math.max(400, Math.ceil(Math.max(D.usual.total, t.total, t.cap) * 1.6 / 100) * 100);
          let value = Math.min(MAX, (guessOf(api) || {}).value ?? Math.round(MAX / 2 / STEP) * STEP);
          const node = el(`<div class="gw-step center">
            <h2 class="t-title">What did ${weekName(api).toLowerCase()} cost?</h2>
            <p class="t-sub t-2 gw-hint">Food and getting around, Mon–Sun${D.mealPlan ? "<br>Swipes not counted" : ""}</p>
            <div class="gw-dial" role="slider" tabindex="0" aria-label="Your guess" aria-describedby="gw-keys" aria-valuemin="0" aria-valuemax="${MAX}">
              <svg viewBox="0 0 290 290" aria-hidden="true"></svg>
              <div class="val" aria-hidden="true"><b class="n-xl"></b><span class="t-sub t-2">your guess</span></div>
            </div>
            <div class="gw-nudge"><button class="btn tint" aria-label="Minus 10 dollars">−10</button><button class="btn tint" aria-label="Plus 10 dollars">+10</button></div>
            <p class="vh" id="gw-keys">Arrow keys move $10. Page Up and Page Down move $100.</p>
          </div>`);
          const dial = node.querySelector(".gw-dial"), svg = dial.querySelector("svg"), out = dial.querySelector("b");
          const C = 145, R = 118, A0 = 225, SPAN = 270;   // arc from 7:30 through 12 to 4:30, gap at the bottom
          const pt = deg => { const r = (deg - 90) * Math.PI / 180; return [C + R * Math.cos(r), C + R * Math.sin(r)]; };
          const arc = (a, b) => { const [x0, y0] = pt(a), [x1, y1] = pt(b); return `M${x0} ${y0} A${R} ${R} 0 ${b - a > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
          let ticks = "";
          for (let v = 0; v <= MAX; v += 100) {
            const r = (A0 + SPAN * v / MAX - 90) * Math.PI / 180;
            ticks += `<line class="gw-tickmark" x1="${C + (R - 24) * Math.cos(r)}" y1="${C + (R - 24) * Math.sin(r)}" x2="${C + (R - 18) * Math.cos(r)}" y2="${C + (R - 18) * Math.sin(r)}"/>`;
          }
          svg.innerHTML = `<path class="gw-arc-track" d="${arc(A0, A0 + SPAN)}"/><path class="gw-arc-fill"/>${ticks}<circle class="gw-thumb" r="16"/>`;
          const fill = svg.querySelector(".gw-arc-fill"), thumb = svg.querySelector(".gw-thumb");
          let lastTick = Math.floor(value / 50);
          const set = v => {
            value = Math.max(0, Math.min(MAX, Math.round(v / STEP) * STEP));
            const a = A0 + SPAN * value / MAX;
            fill.setAttribute("d", value > 0 ? arc(A0, Math.max(A0 + 0.5, a)) : "");
            const [x, y] = pt(a); thumb.setAttribute("cx", x); thumb.setAttribute("cy", y);
            out.textContent = money(value); out.className = value >= 1000 ? "n-l" : "n-xl"; dial.setAttribute("aria-valuenow", value); dial.setAttribute("aria-valuetext", money(value));
            const k = Math.floor(value / 50); if (k !== lastTick) { lastTick = k; haptic(); }
          };
          const fromPointer = e => {
            const r = dial.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
            let deg = Math.atan2(y, x) * 180 / Math.PI + 90; if (deg < 0) deg += 360;
            let rel = deg - A0; if (rel < 0) rel += 360;
            if (rel > SPAN) rel = rel - SPAN < (360 - SPAN) / 2 ? SPAN : 0;   // snap inside the gap
            let next = MAX * rel / SPAN;
            if (Math.abs(next - value) > MAX / 2) next = value > MAX / 2 ? MAX : 0;   // past an end clamps, never wraps
            set(next);
          };
          dial.addEventListener("pointerdown", e => { try { dial.setPointerCapture(e.pointerId); } catch (err) {} fromPointer(e); });
          dial.addEventListener("pointermove", e => { if (dial.hasPointerCapture && dial.hasPointerCapture(e.pointerId)) fromPointer(e); });
          dial.addEventListener("keydown", e => {
            const to = { ArrowUp: value + STEP, ArrowRight: value + STEP, ArrowDown: value - STEP, ArrowLeft: value - STEP,
              PageUp: value + 100, PageDown: value - 100, Home: 0, End: MAX }[e.key];
            if (to == null) return;
            e.preventDefault(); set(to);
          });
          const [minus, plus] = node.querySelectorAll(".gw-nudge button");
          minus.addEventListener("click", () => set(value - STEP)); plus.addEventListener("click", () => set(value + STEP));
          set(value);
          swapIn(node);
          sheetActions(body, [{ label: "Reveal", onClick: () => { haptic("heavy"); store.set("guess", { value, at: Date.now(), week: typeof api.weekKey === "function" ? api.weekKey() : D.weekStart }); revealStep(value); } }]);
        }

        // ---- Step 2: reveal (the digit roll) ----
        function revealStep(guess) {
          const real = t.total, usual = D.usual.total, off = Math.abs(real - guess);
          const diff = real - usual, pct = Math.round(100 * Math.abs(diff) / usual);
          const scale = Math.max(real, usual, t.cap) * 1.04, w = v => (100 * v / scale).toFixed(2) + "%";
          const delta = diff === 0 ? "Right at your usual week" : `${money(Math.abs(diff))} ${diff < 0 ? "below" : "above"} usual week (${pct}%)`;
          const underCap = real <= t.cap ? `${money(t.cap - real)} under cap` : "";
          const said = `This week: ${money(real)}. You guessed ${money(guess)}${off ? `, off by ${money(off)}` : ", exactly right"}. ${underCap ? underCap + ". " : ""}${delta}.`;
          const node = el(`<div class="gw-step center gw-reveal">
            <h2 class="t-title">${weekName(api)} ${badge(api, "thisWeek")}</h2>
            <div class="gw-roll n-xl" aria-hidden="true"></div>
            <p class="vh" role="status"></p>
            <p class="t-body t-2 gw-guessline">You guessed <b class="num">${money(guess)}</b>${off ? ` · off by <b class="num">${money(off)}</b>` : " · exactly right"}</p>
            <div class="gw-bars" role="img" aria-label="This week ${money(real)}: food ${money(items.food)}, getting around ${money(items.move)}${items.night ? `, night rides ${money(items.night)}` : ""}. Usual ${money(usual)}. Cap ${money(t.cap)}.">
              <div class="gw-bar"><div class="top t-sub"><span>${weekName(api)}</span><b class="num">${money(real)}</b></div>
                <div class="track"><i class="fill-food" style="width:${w(items.food)}"></i><i class="fill-move" style="width:${w(items.move)}"></i>${items.night ? `<i class="fill-night" style="width:${w(items.night)}"></i>` : ""}<span class="cap" style="left:${w(t.cap)}"></span></div></div>
              <div class="gw-bar"><div class="top t-sub"><span>Usual week</span><b class="num">${money(usual)}</b></div>
                <div class="track"><i class="usual" style="width:${w(usual)}"></i><span class="cap" style="left:${w(t.cap)}"></span></div></div>
            </div>
            <div class="gw-legend t-foot t-2"><span><i class="dot food"></i>Food <b class="num">${money(items.food)}</b></span><span><i class="dot move"></i>Getting around <b class="num">${money(items.move)}</b></span>${items.night ? `<span><i class="dot night"></i>Night <b class="num">${money(items.night)}</b></span>` : ""}<span><i class="gw-capkey"></i>Cap <b class="num">${money(t.cap)}</b></span></div>
            <div class="gw-delta">${underCap ? `<p class="t-headline">${underCap}</p>` : ""}<p class="t-sub t-2">${delta}</p></div>
          </div>`);
          swapIn(node);
          const after = node.querySelectorAll(".gw-guessline, .gw-bars, .gw-legend, .gw-delta");
          after.forEach(n => n.classList.add("gw-hold"));   // hidden by a class, revealed by a CSS transition (reliable in WKWebView)
          let landed = false;
          const rolled = roll(node.querySelector(".gw-roll"), money(real), api);
          Promise.race([rolled, new Promise(r => setTimeout(r, 1800))]).then(() => {   // never wait forever on a throttled tab
            if (landed || !node.isConnected) return; landed = true;
            haptic("success");
            node.querySelector('[role="status"]').textContent = said;   // announced once, after the roll lands
            after.forEach((n, k) => setTimeout(() => n.classList.remove("gw-hold"), api.reduced ? 0 : k * 50));
          });
          sheetActions(body, [{ label: "See receipt", icon: "receipt", onClick: receiptStep }]);
        }

        // ---- Step 3: receipt ----
        function receiptStep() {
          const pick = adaptSwap(api, currentPick(api));
          const real = api.isReal("thisWeek");
          const line = (label, v, cls = "sub") => `<div class="ln ${cls}"><span>${label}</span><span>${money(v)}</span></div>`;
          const opt = (label, v) => (v ? line(label, v) : "");
          const node = el(`<div class="gw-step">
            <h2 class="t-title">Receipt</h2>
            <div class="gw-printer"><div class="gw-slot" aria-hidden="true"></div>
              <div class="gw-paper">
                <div class="head"><b>SWAP · WEEKLY</b><span>${esc(D.weekLabel)}${real ? "" : D.source === "real" ? " · sample week" : " · sample student"}</span></div>
                ${line("Food", items.food, "group")}
                ${opt("Eating out", items.dining)}${opt("Clubs, bars &amp; bodega", items.drinks)}${opt("Coffee &amp; snacks", items.quick)}${opt("Delivery", items.delivery)}
                ${line("Getting around", items.move, "group")}
                ${items.rideCount ? line(`Rides (${items.rideCount})`, items.ride) : ""}
                ${opt("Subway", items.transit)}
                ${items.nightCount ? line(`Night rides (${items.nightCount})*`, items.night, "group") : ""}
                <div class="rule"></div>
                ${line("Total", t.total, "total")}
                ${t.paidBack ? `<div class="ln sub flush"><span>Paid back</span><span>${money(t.paidBack)}</span></div><p class="fine">Not taken off.</p>` : ""}
                <div class="ln sub flush"><span>Cap</span><span>${money(t.cap)}</span></div>
                <p class="fine">${capLine(api, D)}</p>
                ${pick ? `<div class="swapbox">${brandOf(api, pick) ? api.brandMark(brandOf(api, pick), pick.kind, 28) : ""}<div><span>${api.store.get("deckPick") === pick.id ? "This week's swap" : "A swap to try"}</span><b>${esc(pick.title)}</b>${pick.why ? `<span>${esc(pick.why)}</span>` : ""}<span>About ${money(pick.save)} ${UNIT[pick.unit] || "a " + pick.unit}</span></div></div>` : ""}
                ${items.nightCount ? `<p class="fine">*Night rides, 11 PM–6 AM: always OK.</p>` : ""}
                <div class="barcode" aria-hidden="true"></div>
              </div></div>
          </div>`);
          swapIn(node);
          const paper = node.querySelector(".gw-paper");
          animate(paper, [{ clipPath: "inset(0 0 100% 0)", translate: "0 -24px", opacity: 0 }, { opacity: 1, offset: .08 }, { clipPath: "inset(0 0 0% 0)", translate: "0 0", opacity: 1 }], { preset: "gentle", duration: 1300 });
          sheetActions(body, [
            { label: "Share", kind: "secondary", icon: "share", onClick: shareStep },
            { label: "Done", onClick: () => close() }
          ]);
        }

        // ---- Step 4: share a story image (percent only, never dollars) ----
        function shareStep() {
          const real = t.total, usual = D.usual.total, diff = real - usual, pct = Math.round(100 * Math.abs(diff) / usual);
          const info = {
            big: `${pct}%`,
            line1: diff < 0 ? "below my usual week" : diff > 0 ? "above my usual week" : "right at my usual week",
            line2: "on food and getting around",
            label: weekName(api), weekLabel: D.weekLabel, week: real, usual, food: items.food, move: items.move, night: items.night,
            foot: api.isReal("thisWeek") ? "From my card data" : D.source === "real" ? "Sample week" : "Sample student"
          };
          if (diff === 0) info.big = "0%";
          const caption = `${info.big} ${info.line1} ${info.line2}.`;
          const node = el(`<div class="gw-step center">
            <h2 class="t-title">Share</h2>
            <p class="t-sub t-2 gw-hint">Percent only, no dollars</p>
            <div class="gw-story-wrap"><span class="vh">Loading image</span></div>
            <p class="gw-share-status t-sub" role="status"></p>
          </div>`);
          swapIn(node);
          const wrap = node.querySelector(".gw-story-wrap"), status = node.querySelector(".gw-share-status");
          let file = null, blob = null;
          const say = (text, bad) => { status.textContent = text; status.classList.toggle("bad", !!bad); };
          storyImage(api, info).then(b => {
            blob = b;
            file = new File([b], "swap-week.png", { type: "image/png" });
            if (storyURL) URL.revokeObjectURL(storyURL);
            storyURL = URL.createObjectURL(b);
            const img = el(`<img class="gw-story" width="1080" height="1920" alt="Story image: ${esc(caption)} ${esc(D.weekLabel)}.">`);
            img.src = storyURL;
            wrap.replaceChildren(img);
            api.animate(img, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
          }).catch(e => { console.error("[swap] story image", e); wrap.replaceChildren(); say("Image failed. Try again.", true); });

          const download = () => {
            const a = document.createElement("a"); a.href = storyURL; a.download = "swap-week.png";
            document.body.appendChild(a); a.click(); a.remove();
          };
          async function go() {
            if (!file) { say("Image not ready yet.", true); return; }
            haptic();
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              try { await navigator.share({ files: [file], title: "My week" }); say("Shared."); return; }
              catch (e) { if (e && e.name === "AbortError") return; say("Saving the image instead.", true); }
            }
            try { download(); } catch (e) { say("Couldn't save the image. Press and hold it to save.", true); return; }
            let copied = false;
            try { await navigator.clipboard.writeText(caption); copied = true; } catch (e) {}
            if (!status.classList.contains("bad")) say(copied ? "Image saved. Caption copied." : "Image saved. Couldn't copy the caption.", !copied);
            toast("Image saved", "share");
          }
          sheetActions(body, [
            { label: "Back", kind: "secondary", icon: "back", onClick: receiptStep },
            { label: "Share", icon: "share", onClick: go }
          ]);
        }

        if (startAt === "receipt" && guessOf(api)) receiptStep(); else guessStep();
      }, { label: "Guess your week", onClose: () => {
        if (storyURL) URL.revokeObjectURL(storyURL);
        // The hero re-renders after the guess, so the opener may be gone: land on its first action.
        if (!document.activeElement || document.activeElement === document.body) {
          const b = document.querySelector("#slot-guess [data-go]");
          b && b.focus({ preventScroll: true });
        }
      } });
    }
  });
})();
