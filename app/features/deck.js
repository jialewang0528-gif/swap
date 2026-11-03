/* Swap deck (Swaps tab).
   A stack of solid cards, one swap each, from api.swaps() for the active profile and its facts.
   Fling right (or the check button, or Right arrow) to add it to this week's swaps; fling left
   (or the x, or Left arrow) for "Not now". Picks live in window.SwapPicks (swapmath.js): store
   "deckPicks" keyed by the current week, so a new week starts empty with a one-tap "Keep last
   week's swaps". Each pick shows how it counts ("6 × $12 = $72 a week", window.SwapMath), so the
   rows add up to the total, and a "Did it" tally for the week.
   Signature motion: the physical fling (release velocity carries into the throw). Nothing else
   moves expressively. Reduced motion: cards cross-fade instead. */
Swap.feature({
  id: "deck",
  title: "Swap deck",
  pitch: "Swipe right to add a swap to this week.",
  tab: "swaps",
  order: 1,

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
    const { el, esc, money, haptic, store, toast, animate } = api;
    const SM = window.SwapMath, SP = window.SwapPicks;
    const offs = [];
    let alive = true;
    // The lower-fare ride app is never a swap unless core allows it (api.rideAppAllowed).
    const rideOK = () => typeof api.rideAppAllowed === "function" && !!api.rideAppAllowed();
    const per = s => SM.per(s);
    // One badge for the screen, and none on the live "You" build (estimates from real data).
    const badge = () => typeof api.badge === "function" ? api.badge("swaps") : "";
    SP.sync(api);

    // ---------- which swaps fit this student ----------
    // api.swaps() already drops the lower-fare app, night rides and swaps whose `needs` fail
    // (guest swipe needs no meal plan, hall coffee needs a plan). On top of that: no subway
    // swap when the trip is over 30 min (core's "subway" need uses the same line), there is no
    // subway, or they ran late to class this week.
    function eligible() {
      const f = api.facts();
      const ranLate = api.charges().some(c => c.kind === "ride" && !c.night && c.tag === "late");
      const noSubway = f.subwayMinutes == null || f.subwayMinutes > 30 || ranLate;
      // Cancelling a subscription isn't a weekly swap: those live in "All swaps" only.
      return api.swaps().filter(s => !s.sub && !s.night && (rideOK() || !api.isRideApp(`${s.title} ${s.detail} ${s.basis}`)) && !(noSubway && /subway|train/i.test(`${s.id} ${s.title}`))).map(s => SM.adapt(api, s));
    }
    let SWAPS = eligible();
    const byId = id => SWAPS.find(s => s.id === id);
    const mark = (s, size) => SM.mark(api, s, size);
    const pickIds = () => SP.state(api).ids;

    // ---------- state (per profile, via api.store; the deck position restarts each week) ----------
    const WEEK = SP.week(api);
    const fresh = () => {
      const ids = SWAPS.map(s => s.id), mine = pickIds();
      // Swaps already picked go last.
      return { order: ids.filter(id => !mine.includes(id)).concat(ids.filter(id => mine.includes(id))), i: 0, week: WEEK };
    };
    let st = store.get("deckState");
    const valid = o => o && Array.isArray(o.order) && o.order.length === SWAPS.length && o.order.every(id => byId(id)) && Number.isInteger(o.i) && (o.week || null) === (WEEK || null);
    if (!valid(st)) st = fresh();
    st = { order: st.order, i: Math.min(st.i, st.order.length), week: WEEK };
    const save = () => store.set("deckState", st);

    // ---------- markup ----------
    const root = el(`<div class="dk">
      <div class="dk-area"></div>
      <p class="vh" aria-live="polite" data-sr></p>
      <h2 class="section-title" id="dk-pick-h" tabindex="-1">This week's swaps ${badge()}</h2>
      <section class="card dk-pick" aria-labelledby="dk-pick-h"></section>
    </div>`);
    slot.appendChild(root);
    const area = root.querySelector(".dk-area"), sr = root.querySelector("[data-sr]"), pickBox = root.querySelector(".dk-pick");
    const pickH = root.querySelector("#dk-pick-h");
    let stack = null, cards = [];

    const say = t => { sr.textContent = ""; setTimeout(() => { if (alive) sr.textContent = t; }, 40); };
    const count = () => api.setSub("swaps", SWAPS.length ? (st.i < st.order.length ? `${st.i + 1} of ${st.order.length}` : `All ${st.order.length} seen`) : "");
    const wk = n => `<span class="num">${money(n)}</span><span aria-hidden="true" class="t-foot t-3">/wk</span><span class="vh"> a week</span>`;

    // ---------- this week's swaps (below the deck) ----------
    // Every "yes" adds a swap (SwapPicks.add). The total is the sum of the rows' weekly amounts.
    let drawn = "";
    function renderPick(force) {
      if (!alive) return;
      const list = SP.list(api), last = list.length ? [] : SP.lastList(api);
      // Same picks as on screen (a store echo of our own write): keep the DOM, and focus, as is.
      const sig = JSON.stringify([list.map(p => [p.id, p.done, p.weekly]), last.map(p => p.id), api.data.thisWeek.saveTarget]);
      if (sig === drawn && !force) return;
      drawn = sig;
      const total = list.reduce((t, p) => t + p.weekly, 0), goal = api.data.thisWeek.saveTarget || 0;
      const row = p => {
        const s = p.swap;
        return `<li class="row dk-pick-row" data-id="${esc(s.id)}">${mark(s, 36)}
          <div class="grow"><p class="t-sub dk-pick-t">${esc(s.title)}</p>
            <p class="t-foot t-3 dk-pick-a">${esc(p.formula)}</p>
            ${s.when ? `<p class="t-foot t-3 dk-pick-a">${esc(s.when)}</p>` : ""}
            <div class="dk-pick-acts">
              <button class="btn tint small dk-did" data-id="${esc(s.id)}" aria-label="Did it: ${esc(s.title)}. ${p.done} of ${p.target} this week">Did it</button>
              <span class="t-foot t-2 dk-tally" aria-hidden="true"><span class="num">${p.done}</span> of <span class="num">${p.target}</span></span>
              <button class="btn plain small dk-unpick" data-id="${esc(s.id)}" aria-label="Remove ${esc(s.title)}">Remove</button>
            </div></div>
          <span class="amt">${wk(p.weekly)}</span></li>`;
      };
      pickBox.innerHTML = list.length
        ? `<div class="dk-picks-sum"><span class="t-foot t-3">About</span> <b class="num">${money(total)}</b> <span class="t-foot t-3">a week${goal ? ` of your ${money(goal)} goal` : ""}</span></div>
           <ul class="list dk-picks" role="list">${list.map(row).join("")}</ul>`
        : last.length
          ? `<p class="t-sub t-2 dk-empty" tabindex="-1">New week. No swaps picked yet.</p>
             <p class="t-foot t-3 dk-last">Last week: ${last.map(p => esc(p.swap.title)).join(", ")}. About <span class="num">${money(last.reduce((t, p) => t + p.weekly, 0))}</span> a week.</p>
             <button class="btn tint block dk-keep">Keep last week's swaps</button>`
          : `<p class="t-sub t-2 dk-empty" tabindex="-1">No swaps picked. Swipe right to add one.</p>`;
      const ids = list.map(p => p.id);
      cards.forEach(c => c.classList.toggle("is-pick", ids.includes(c.dataset.id)));
    }
    const focusIn = sel => { const n = sel && pickBox.querySelector(sel); (n || pickH).focus({ preventScroll: true }); };
    pickBox.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b || !pickBox.contains(b)) return;
      const id = b.dataset.id;
      if (b.classList.contains("dk-unpick")) {
        haptic();
        const all = [...pickBox.querySelectorAll(".dk-unpick")], idx = all.indexOf(b), s = SP.list(api).find(p => p.id === id);
        SP.remove(api, id); renderPick();
        const left = pickBox.querySelectorAll(".dk-unpick");
        left.length ? left[Math.min(idx, left.length - 1)].focus({ preventScroll: true }) : focusIn(".dk-keep, .dk-empty");
        toast(`Removed: ${s ? s.swap.title : "swap"}`, "check", { action: { label: "Undo", onClick: () => { SP.add(api, id); renderPick(); focusIn(`.dk-unpick[data-id="${CSS.escape(id)}"]`); } } });
      } else if (b.classList.contains("dk-did")) {
        haptic("success");
        const n = SP.done(api, id), p = SP.list(api).find(x => x.id === id);
        renderPick(); focusIn(`.dk-did[data-id="${CSS.escape(id)}"]`);
        if (p) toast(`${p.swap.title}: ${n} of ${p.target} this week`, "check", { action: { label: "Undo", onClick: () => { SP.done(api, id, n - 1); renderPick(); } } });
      } else if (b.classList.contains("dk-keep")) {
        haptic("success");
        const n = SP.lastList(api).length;
        SP.keepLast(api); renderPick(); focusIn(".dk-did");
        toast(`Kept ${n} ${n === 1 ? "swap" : "swaps"} for this week`);
      }
    });
    function choose(s) {
      if (SP.has(api, s.id)) { toast(`Already picked: ${s.title}`); return; }
      SP.add(api, s.id);
      toast(`Added: ${s.title}`);
      renderPick();
      if (!api.reduced) animate(pickBox, [{ opacity: .4 }, { opacity: 1 }], { preset: "snappy" });
    }
    // Your goal, Move-in or Chat changed the picks: show them, don't reset the deck.
    let queued = false;
    const later = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; renderPick(); }); };
    offs.push(store.on("deckPicks", later), store.on("deckPick", later));

    // ---------- the stack ----------
    // Depth poses: the top card, then two cards peeking below it.
    const POSE = [
      "translate3d(0,0,0) rotate(0deg) scale(1)",
      "translate3d(0,12px,0) rotate(0deg) scale(.95)",
      "translate3d(0,24px,0) rotate(0deg) scale(.9)"
    ];
    function cardFor(s) {
      const c = el(`<article class="dk-card" data-id="${s.id}" aria-roledescription="swap card" aria-labelledby="dk-t-${s.id}" aria-describedby="dk-hint">
        <span class="dk-stamp yes" aria-hidden="true">This week's swap</span><span class="dk-stamp no" aria-hidden="true">Not now</span>
        <div class="dk-top">${mark(s, 44)}
          <span class="dk-now t-foot">This week's swap</span></div>
        <h2 class="t-title2 dk-t" id="dk-t-${s.id}">${esc(s.title)}</h2>
        <p class="t-sub t-2 dk-detail">${esc(s.detail)}</p>
        <p class="dk-amt"><span class="t-sub t-2">About</span> <span class="n-l">${money(s.save)}</span> <span class="t-sub t-2">${per(s)}</span></p>
        <p class="t-foot t-2 dk-wk">${SM.timesPerWeek(s) === 1 && !SM.isMonthly(s) ? `Counts once a week: ${money(SM.weeklySave(s))}` : esc(SM.formula(s))}</p>
        <p class="t-foot t-3 dk-basis">${esc(String(s.basis || "").replace(/\s*→\s*/g, " vs "))}${s.when ? `<br>${esc(s.when)}` : ""}</p>
      </article>`);
      c.classList.toggle("is-pick", pickIds().includes(s.id));
      bind(c);
      return c;
    }
    function layout(moved) {
      cards.forEach((c, d) => {
        const top = d === 0;
        c.style.zIndex = String(10 - d);
        c.classList.toggle("top", top);
        c.tabIndex = top ? 0 : -1;
        c.inert = !top;
        if (top) c.removeAttribute("aria-hidden"); else c.setAttribute("aria-hidden", "true");
        const to = POSE[d];
        if (!moved || api.reduced) { c.getAnimations().forEach(a => a.cancel()); c.style.transform = to; return; }
        const from = getComputedStyle(c).transform;
        c.getAnimations().forEach(a => a.cancel());
        c.style.transform = to;
        animate(c, [{ transform: from === "none" ? to : from }, { transform: to }], { preset: "standard" });
      });
    }
    function fill(moved) {
      const want = st.order.slice(st.i, st.i + 3);
      while (cards.length < want.length) {
        const c = cardFor(byId(want[cards.length]));
        // Visible by default; the fade only animates. (An inline opacity of 0 waiting for the fade
        // left cards invisible on iPhone whenever the fade was cancelled, and the deck went blank.)
        c.style.transform = POSE[2]; c.style.opacity = "1";
        stack.appendChild(c); cards.push(c);
        if (moved && !api.reduced) animate(c, [{ opacity: 0 }, { opacity: 1 }], { preset: "gentle" });
      }
      layout(moved);
    }

    // The fling: keep the release velocity. A cubic-bezier whose first handle has slope
    // v * duration / distance starts the throw at exactly the finger's speed, then eases out.
    function throwCard(c, dir, g) {
      const w = stack.clientWidth || 360;
      const x0 = g.x, y0 = g.y, r0 = g.r;
      const x1 = dir * (w + 180);
      const dist = Math.max(40, Math.abs(x1 - x0));
      const speed = Math.max(Math.abs(g.vx), 1.1);                  // px/ms, at least a firm toss
      const dur = Math.round(Math.min(560, Math.max(240, dist / speed * 1.8)));
      const slope = Math.min(5, speed * dur / dist);
      const easing = `cubic-bezier(.18, ${Math.min(1.4, .18 * slope).toFixed(3)}, .55, 1)`;
      const y1 = y0 + Math.max(-120, Math.min(120, g.vy * dur * .45));
      const r1 = r0 + dir * Math.min(24, 10 + speed * 6) * (g.flip || 1);
      c.classList.remove("top"); c.classList.add("gone"); c.inert = true; c.setAttribute("aria-hidden", "true");
      c.style.zIndex = "20";
      c.getAnimations().forEach(a => a.cancel());
      const done = () => c.remove();
      if (api.reduced) { c.style.transform = POSE[0]; animate(c, [{ opacity: 1 }, { opacity: 0 }]).then(done); return; }
      const from = `translate3d(${x0}px,${y0}px,0) rotate(${r0}deg) scale(1)`, to = `translate3d(${x1}px,${y1}px,0) rotate(${r1}deg) scale(1)`;
      c.style.transform = to;
      animate(c, [{ transform: from }, { transform: to }], { easing, duration: dur }).then(done);
    }

    // No busy lock: the state advances the moment a card is decided, so rapid flicks all count.
    function decide(choice, g) {
      const c = cards[0];
      if (!c) return;
      const s = byId(c.dataset.id), dir = choice === "yes" ? 1 : -1;
      const hadFocus = root.contains(document.activeElement);
      cards.shift();
      st.i++; save(); count();
      if (choice === "yes") { choose(s); haptic("success"); }
      else { haptic(); say(`Not now: ${s.title}.${st.i < st.order.length ? ` ${st.i + 1} of ${st.order.length}.` : ""}`); }
      if (!g) {   // button or key: same throw as a firm flick, stamp shown
        c.querySelector(dir > 0 ? ".yes" : ".no").style.opacity = "1";
        g = { x: 0, y: 0, r: 0, vx: dir * 1.4, vy: -.05 };
      }
      throwCard(c, dir, g);
      if (st.i >= st.order.length) { ended(true); return; }
      fill(true);
      if (hadFocus && cards[0]) cards[0].focus({ preventScroll: true });
    }

    function bind(c) {
      const yes = c.querySelector(".dk-stamp.yes"), no = c.querySelector(".dk-stamp.no");
      let g = null;   // gesture
      const stamp = dx => {
        yes.style.opacity = String(Math.max(0, Math.min(1, (dx - 12) / 80)));
        no.style.opacity = String(Math.max(0, Math.min(1, (-dx - 12) / 80)));
      };
      const pose = () => { c.style.transform = `translate3d(${g.x}px,${g.y}px,0) rotate(${g.r}deg) scale(1)`; };
      c.addEventListener("pointerdown", e => {
        if (c !== cards[0] || e.button > 0) return;
        const m = new DOMMatrixReadOnly(getComputedStyle(c).transform);
        c.getAnimations().forEach(a => a.cancel());
        const rect = c.getBoundingClientRect();
        g = { id: e.pointerId, sx: e.clientX - m.m41, sy: e.clientY, x: m.m41, y: 0, r: 0, vx: 0, vy: 0,
          flip: e.clientY < rect.top + rect.height / 2 ? 1 : -1, pts: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }], crossed: false };
        try { c.setPointerCapture(e.pointerId); } catch (err) {}
        c.classList.add("dragging");
      });
      c.addEventListener("pointermove", e => {
        if (!g || e.pointerId !== g.id) return;
        g.x = e.clientX - g.sx; g.y = (e.clientY - g.sy) * .3; g.r = g.x / 20 * g.flip;
        g.pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
        while (g.pts.length > 2 && e.timeStamp - g.pts[0].t > 100) g.pts.shift();
        pose(); stamp(g.x);
        const over = Math.abs(g.x) > threshold();
        if (over !== g.crossed) { g.crossed = over; haptic(); }
      });
      const end = e => {
        if (!g || e.pointerId !== g.id) return;
        const gg = g; g = null;
        c.classList.remove("dragging");
        // Velocity over the last ~100ms, including the release point.
        gg.pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
        while (gg.pts.length > 2 && e.timeStamp - gg.pts[0].t > 100) gg.pts.shift();
        const a = gg.pts[0], b = gg.pts[gg.pts.length - 1], dt = Math.max(8, b.t - a.t);
        gg.vx = (b.x - a.x) / dt; gg.vy = (b.y - a.y) / dt;
        const dx = e.clientX - gg.sx, dyRaw = e.clientY - gg.sy;
        gg.x = dx; gg.y = dyRaw * .3; gg.r = dx / 20 * gg.flip;
        const far = Math.abs(dx) > threshold() && Math.abs(dx) > Math.abs(dyRaw) * .7;
        const flick = Math.abs(gg.vx) > .35 && Math.abs(gg.vx) > Math.abs(gg.vy) && Math.abs(dx) > 10 && Math.sign(gg.vx) === Math.sign(dx);
        if (e.type !== "pointercancel" && (far || flick)) { decide(dx > 0 ? "yes" : "no", gg); return; }
        // Not far enough: spring home.
        const from = `translate3d(${gg.x}px,${gg.y}px,0) rotate(${gg.r}deg) scale(1)`;
        c.style.transform = POSE[0];
        animate(c, [{ transform: from }, { transform: POSE[0] }], { preset: "standard" });
        [yes, no].forEach(s => { s.style.opacity = "0"; });
      };
      c.addEventListener("pointerup", end);
      c.addEventListener("pointercancel", end);
      c.addEventListener("lostpointercapture", e => { if (g && e.pointerId === g.id) end(e); });
      c.addEventListener("keydown", e => {
        if (c !== cards[0]) return;
        if (e.key === "ArrowRight") { e.preventDefault(); decide("yes"); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); decide("no"); }
      });
    }
    const threshold = () => Math.min(110, (stack ? stack.clientWidth : 360) * .28);

    function deck(focus) {
      area.replaceChildren();
      if (!SWAPS.length) {
        area.appendChild(el(`<div class="card dk-end"><h2 class="t-title3">No swaps fit</h2><p class="t-sub t-2">Change your answers.</p></div>`));
        count(); return;
      }
      const node = el(`<div class="dk-deck">
        <div class="dk-stack"></div>
        <div class="dk-actions">
          <button class="dk-act no" aria-label="Not now"><span class="dk-btn glass strong pressable" aria-hidden="true">${api.icon("x", 26, 2.2)}</span><span class="t-foot dk-lbl" aria-hidden="true">Not now</span></button>
          <p class="vh" id="dk-hint">Right arrow: this week's swap. Left arrow: not now.</p>
          <button class="dk-act yes" aria-label="Make it this week's swap"><span class="dk-btn glass strong pressable" aria-hidden="true">${api.icon("check", 28, 2.2)}</span><span class="t-foot dk-lbl" aria-hidden="true">This week's swap</span></button>
        </div></div>`);
      area.appendChild(node);
      stack = node.querySelector(".dk-stack"); cards = [];
      node.querySelector(".dk-act.no").addEventListener("click", () => decide("no"));
      node.querySelector(".dk-act.yes").addEventListener("click", () => decide("yes"));
      fill(false);
      count();
      if (focus && cards[0]) cards[0].focus({ preventScroll: true });
    }

    // The deck ran out: say so, offer another look, and move focus to the heading.
    function ended(byUser) {
      const n = st.order.length, np = pickIds().length;
      const node = el(`<div class="card dk-end">
        <h2 class="t-title3" data-title>All ${n} seen</h2>
        <p class="t-sub t-2">${np ? `${np} ${np === 1 ? "swap" : "swaps"} picked this week` : "No swaps picked"}</p>
        <button class="btn secondary block dk-again">Look again</button></div>`);
      // If the deck is on screen, the end card lands in the stack under the last card as it
      // flies off, and focus moves to its heading right away.
      if (stack && stack.isConnected) {
        const acts = area.querySelector(".dk-actions"); if (acts) acts.hidden = true;
        node.classList.add("in-stack");
        stack.appendChild(node);
      } else area.replaceChildren(node);
      if (byUser && !api.reduced) animate(node, [{ opacity: 0 }, { opacity: 1 }], { preset: "gentle" });
      if (byUser) { const h = api.focusTitle(node); if (h) h.focus({ preventScroll: true }); }
      if (byUser) say(`All ${n} swaps seen.`);
      node.querySelector(".dk-again").addEventListener("click", () => {
        haptic();
        st = fresh(); save();
        deck(true);
        say(`${st.order.length} swaps. 1 of ${st.order.length}.`);
      });
      count();
    }

    // Move-in answers changed the facts: rebuild with the swaps that fit now.
    const onFacts = () => {
      if (!alive) return;
      SWAPS = eligible();
      if (!valid(st)) { st = fresh(); save(); }
      renderPick(true);
      st.i >= st.order.length ? ended(false) : deck(false);
    };
    document.addEventListener("swap:facts", onFacts);
    offs.push(() => document.removeEventListener("swap:facts", onFacts));

    renderPick();
    if (SWAPS.length && st.i >= st.order.length) ended(false); else deck(false);

    return () => { alive = false; offs.forEach(f => { try { f(); } catch (e) {} }); };
  }
});
