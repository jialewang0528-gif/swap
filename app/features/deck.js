/* Swap deck (Swaps tab).
   A stack of solid cards, one swap each, from api.swaps() for the active profile and its facts.
   Fling right (or the check button, or Right arrow) to make it "This week's swap"; fling left
   (or the x, or Left arrow) for "Not now". There is one swap per week: picking another replaces
   it and says so. The pick lives in store "deckPick" (the Week receipt, Move-in and Chat read it).
   Signature motion: the physical fling (release velocity carries into the throw). Nothing else
   moves expressively. Reduced motion: cards cross-fade instead. */
Swap.feature({
  id: "deck",
  title: "Swap deck",
  pitch: "Swipe right to pick this week's swap.",
  tab: "swaps",
  order: 1,

  render(slot, api) {
    const { el, esc, money, haptic, store, toast, animate } = api;
    const offs = [];
    let alive = true;
    // The lower-fare ride app (shown as Lower-fare app on the private build) is never a swap or a logo pick.
    const rideApp = (api, name) => typeof api.isRideApp === "function" ? api.isRideApp(name) : /lower-fare|rideapp/i.test(String(name || ""));
    // The founder's live build recommends Lower-fare app for Uber/Lyft rides (core decides; default off).
    const rideOK = api => typeof api.rideAppAllowed === "function" && !!api.rideAppAllowed();
    const UNIT = { week: "a week", order: "an order", meal: "a meal", ride: "a ride", month: "a month" };
    // Pickup swap whose place isn't in the student's own price gaps: show the gaps it really has.
    const adaptSwap = s => {
      if (!/^pick ?up\s/i.test(s.title)) return s;
      const gaps = api.data.priceGaps || [], place = s.title.replace(/^pick ?up\s+/i, "").toLowerCase();
      if (!gaps.length || gaps.some(g => g.place.toLowerCase() === place)) return s;
      const avg = Math.round(gaps.reduce((t, g) => t + g.delivered - g.pickup, 0) / gaps.length);
      const top = gaps.slice().sort((a, b) => (b.delivered - b.pickup) - (a.delivered - a.pickup))[0];
      return Object.assign({}, s, { title: "Pick up instead of delivery", detail: "Same food. No delivery markup.", save: avg, unit: "order",
        basis: `${top.place}: delivered ${money(top.delivered)} vs pickup ${money(top.pickup)}` });
    };
    // One badge for the screen, and none on the live "You" build (estimates from real data).
    const badge = () => {
      if (typeof api.badge === "function") { const b = api.badge("swaps"); if (typeof b === "string") return b; }
      return api.data.live ? "" : `<span class="sample">Sample</span>`;
    };

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
      return api.swaps().filter(s => !s.sub && !s.night && (rideOK(api) || !rideApp(api, `${s.title} ${s.detail} ${s.basis}`)) && !(noSubway && /subway|train/i.test(`${s.id} ${s.title}`))).map(adaptSwap);
    }
    let SWAPS = eligible();
    const byId = id => SWAPS.find(s => s.id === id);

    // ---------- copy ----------
    // Lead with the action, then the saving in the swap's own unit: "$16 an order", "$24 a week".
    const per = s => UNIT[s.unit] || "a " + s.unit;
    const iconKind = s => /coffee/i.test(s.title) ? "quick" : /subway|train/i.test(s.title) ? "transit"
      : /ride|uber/i.test(s.title) ? "ride" : /pick ?up|dashpass|order|deliver/i.test(s.title) ? "delivery" : s.kind;
    // A brand for the swap's logo (Chipotle, DashPass, MTA for the subway, the ride app for a split ride).
    const brandOf = s => {
      const text = `${s.title} ${s.detail || ""}`;
      if (rideApp(api, text)) return null;   // the ride app gets the generic ride glyph, never a logo
      if (api.logo(s.title)) return s.title;
      if (/subway|train/i.test(text)) return "MTA";
      if (api.logo(text)) return text;
      if (/\bride\b/i.test(text)) { const c = api.charges().find(x => x.kind === "ride" && !x.night && x.tag === "out" && !rideApp(api, x.merchant) && api.logo(x.merchant)); return c ? c.merchant : null; }
      return null;
    };
    const mark = (s, size) => api.brandMark(brandOf(s), iconKind(s), size);
    const pickId = () => store.get("deckPick");
    const pickSwap = () => byId(pickId()) || null;

    // ---------- state (per profile, via api.store) ----------
    const fresh = () => {
      const ids = SWAPS.map(s => s.id), p = pickId();
      if (p && ids.includes(p)) { ids.splice(ids.indexOf(p), 1); ids.push(p); }   // current pick goes last
      return { order: ids, i: 0 };
    };
    let st = store.get("deckState");
    const valid = o => o && Array.isArray(o.order) && o.order.length === SWAPS.length && o.order.every(id => byId(id)) && Number.isInteger(o.i);
    if (!valid(st)) st = fresh();
    st = { order: st.order, i: Math.min(st.i, st.order.length) };
    const save = () => store.set("deckState", st);

    // ---------- markup ----------
    const root = el(`<div class="dk">
      <div class="dk-area"></div>
      <p class="vh" aria-live="polite" data-sr></p>
      <h2 class="section-title" id="dk-pick-h">This week's swaps ${badge()}</h2>
      <section class="card dk-pick" aria-labelledby="dk-pick-h"></section>
    </div>`);
    slot.appendChild(root);
    const area = root.querySelector(".dk-area"), sr = root.querySelector("[data-sr]"), pickBox = root.querySelector(".dk-pick");
    let stack = null, cards = [];

    const say = t => { sr.textContent = ""; setTimeout(() => { if (alive) sr.textContent = t; }, 40); };
    const count = () => api.setSub("swaps", SWAPS.length ? (st.i < st.order.length ? `${st.i + 1} of ${st.order.length}` : `All ${st.order.length} seen`) : "");

    // ---------- this week's swap (below the deck) ----------
    let replaced = null;
    // Every "yes" adds a swap to this week's list (store "deckPicks"); nothing is replaced.
    // "deckPick" stays the first one, for the Week receipt, Move-in and Chat.
    const picks = () => {
      const l = (store.get("deckPicks") || []).filter(id => byId(id));
      const one = pickId();
      return one && byId(one) && !l.includes(one) ? [one].concat(l) : l;
    };
    const setPicks = ids => {
      selfSet = true; store.set("deckPicks", ids); store.set("deckPick", ids[0] || null); selfSet = false;
    };
    // About how much a swap saves in a week: half as often as you do it now (at least once),
    // a monthly cancel at its weekly share, a weekly swap as is.
    const weekly = s => s.unit === "month" ? s.save * 12 / 52 : s.unit === "week" ? s.save
      : typeof s.perWeek === "number" ? s.save * Math.max(1, Math.round(s.perWeek / 2)) : s.save;
    function renderPick() {
      const list = picks().map(byId).filter(Boolean);
      const total = Math.round(list.reduce((t, s) => t + weekly(s), 0)), goal = api.data.thisWeek.saveTarget || 0;
      pickBox.innerHTML = list.length
        ? `<div class="dk-picks-sum"><span class="t-foot t-3">About</span> <b class="num">${money(total)}</b> <span class="t-foot t-3">a week${goal ? ` of your ${money(goal)} goal` : ""}</span></div>
           <div class="list">${list.map(s => `<div class="row dk-pick-row">${mark(s, 36)}
             <div class="grow"><p class="t-sub dk-pick-t">${esc(s.title)}</p>
               <p class="t-foot t-3 dk-pick-a">About <span class="num">${money(s.save)}</span> ${per(s)}</p></div>
             <button class="btn plain small dk-unpick" data-id="${esc(s.id)}" aria-label="Remove ${esc(s.title)}">Remove</button></div>`).join("")}</div>`
        : `<p class="t-sub t-2 dk-empty">No swaps picked. Swipe right to add one.</p>`;
      pickBox.querySelectorAll(".dk-unpick").forEach(b => b.addEventListener("click", () => {
        haptic(); const s = byId(b.dataset.id);
        setPicks(picks().filter(id => id !== b.dataset.id));
        renderPick(); toast(`Removed: ${s ? s.title : "swap"}`);
      }));
      const ids = picks();
      cards.forEach(c => c.classList.toggle("is-pick", ids.includes(c.dataset.id)));
    }
    function choose(s) {
      const ids = picks();
      if (ids.includes(s.id)) { toast(`Already picked: ${s.title}`); return; }
      setPicks(ids.concat(s.id));
      toast(`Added: ${s.title}`);
      renderPick();
      if (!api.reduced) animate(pickBox, [{ opacity: .4 }, { opacity: 1 }], { preset: "snappy" });
    }
    // Move-in or Chat changed the pick: show it, don't reset the deck.
    let selfSet = false;
    offs.push(store.on("deckPick", () => { if (!selfSet && alive) { replaced = null; renderPick(); } }));

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
        <p class="t-foot t-3 dk-basis">${esc(s.basis.replace(/\s*→\s*/g, " vs "))}</p>
      </article>`);
      c.classList.toggle("is-pick", s.id === pickId());
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
      const n = st.order.length, s = pickSwap();
      const node = el(`<div class="card dk-end">
        <h2 class="t-title3" data-title>All ${n} seen</h2>
        <p class="t-sub t-2">${picks().length ? `${picks().length} ${picks().length === 1 ? "swap" : "swaps"} picked this week` : "No swaps picked"}</p>
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
      replaced = null;
      renderPick();
      st.i >= st.order.length ? ended(false) : deck(false);
    };
    document.addEventListener("swap:facts", onFacts);
    offs.push(() => document.removeEventListener("swap:facts", onFacts));

    renderPick();
    if (SWAPS.length && st.i >= st.order.length) ended(false); else deck(false);

    return () => { alive = false; offs.forEach(f => { try { f(); } catch (e) {} }); };
  }
});
