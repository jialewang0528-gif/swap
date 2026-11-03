/* Swap core: feature registry, profiles, app shell (nav bar, tab bar, sheets) and the helpers
   every feature uses. Read DESIGN.md before adding to it.
   Add a feature: create features/<id>.js (and optional .css), call Swap.feature({...}),
   then add the id to features.js.
   render(slot, api) runs at boot and again whenever the profile changes (unless the feature sets
   profileAware: true and handles "swap:profile" itself). It may return a dispose() function. */
(function () {
  const features = [];
  const TABS = [
    { id: "week", label: "Week", title: "This week" },
    { id: "swaps", label: "Swaps", title: "Swaps" },
    { id: "wallet", label: "Wallet", title: "Wallet" },
    { id: "chat", label: "Chat", title: "Chat", minimize: false }
  ];
  const D0 = window.SwapData;

  // ---------- Icons (one stroke family, 24px grid, 1.9 stroke) ----------
  const I = {
    week: '<path d="M4 19V10M10 19V5M16 19v-6M22 19H2" />',
    swaps: '<path d="M7 4 3 8l4 4M3 8h13a4 4 0 0 1 4 4M17 20l4-4-4-4M21 16H8a4 4 0 0 1-4-4" />',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 14.5h2" />',
    chat: '<path d="M4 18.5 5.2 15A7.5 7.5 0 1 1 8.6 18l-4.6.5Z" />',
    close: '<path d="M6 6l12 12M18 6 6 18" />',
    check: '<path d="m5 12.5 4.2 4L19 7" />',
    x: '<path d="M7 7l10 10M17 7 7 17" />',
    chevron: '<path d="m9 5 7 7-7 7" />',
    chevronDown: '<path d="m6 9 6 6 6-6" />',
    back: '<path d="m15 5-7 7 7 7" />',
    plus: '<path d="M12 5v14M5 12h14" />',
    minus: '<path d="M5 12h14" />',
    train: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 20l-1.5 1.5M15 20l1.5 1.5M9 13h.01M15 13h.01" />',
    car: '<path d="M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7.5 13h.01M16.5 13h.01" />',
    food: '<path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1-3 4-3 7h3" />',
    bag: '<path d="M5 8h14l-1.2 12H6.2Z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10" />',
    glass: '<path d="M7 3h10l-.8 5.5a4.2 4.2 0 0 1-8.4 0Z"/><path d="M12 13v8M8.5 21h7" />',
    cup: '<path d="M5 8h12v5a6 6 0 0 1-12 0Z"/><path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17M8 3v2M12 3v2" />',
    tray: '<path d="M3 15h18M5 15a7 7 0 0 1 14 0M12 6v2M2 19h20" />',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />',
    home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4Z" />',
    person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0" />',
    people: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 5.8a3 3 0 0 1 0 5.4M17 14.2a5.5 5.5 0 0 1 3.5 4.8" />',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6" />',
    receipt: '<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21Z M9 8h6M9 12h6M9 16h3" />',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" />',
    reset: '<path d="M4 4v5h5"/><path d="M5.5 15a7 7 0 1 0 1-7.5L4 9" />',
    share: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1" />'
  };
  function icon(name, size = 24, stroke = 1.9) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${I[name] || ""}</svg>`;
  }

  // ---------- Motion ----------
  // Damped spring sampled into a CSS linear() easing, so WAAPI/CSS get real spring physics.
  // stiffness = (2π / response)², damping = 4π · dampingFraction / response (mass 1).
  const springCache = {};
  const LINEAR_OK = window.CSS && CSS.supports && CSS.supports("transition-timing-function", "linear(0, 1)");
  function spring(stiffness = 220, damping = 24, mass = 1) {
    const key = stiffness + "/" + damping + "/" + mass;
    if (springCache[key]) return springCache[key];
    let x = 0, v = 0; const dt = 1 / 120, pts = []; let t = 0;
    while (t < 3) {
      const a = (-stiffness * (x - 1) - damping * v) / mass;
      v += a * dt; x += v * dt; t += dt;
      pts.push(x);
      if (Math.abs(1 - x) < 0.0008 && Math.abs(v) < 0.002) break;
    }
    const step = Math.max(1, Math.floor(pts.length / 60));
    const sampled = pts.filter((_, i) => i % step === 0).map(p => +p.toFixed(4));
    sampled.unshift(0); sampled.push(1);
    return (springCache[key] = { easing: LINEAR_OK ? `linear(${sampled.join(",")})` : "cubic-bezier(.2,.9,.25,1.08)", duration: Math.round(t * 1000) });
  }
  // The only three springs. snappy = press feedback, standard = things moving, gentle = sheets and reveals.
  const springs = {
    snappy: { stiffness: 440, damping: 36 },     // response .30, damping fraction .86
    standard: { stiffness: 220, damping: 24 },   // response .42, damping fraction .81
    gentle: { stiffness: 170, damping: 26 }      // response .48, damping fraction ~1 (no overshoot)
  };
  const rmq = matchMedia("(prefers-reduced-motion: reduce)");
  const MOVING = ["translate", "transform", "scale", "rotate", "x", "y", "clipPath", "height", "width", "left", "top"];
  // animate(el, keyframes, { preset: "snappy" | "standard" | "gentle", stiffness, damping, delay, duration })
  // Never throws. Keeps the end state as inline style. Reduced motion: the end state lands at once and
  // only opacity cross-fades (180ms).
  function animate(el, keyframes, opts = {}) {
    if (!el) return Promise.resolve();
    const p = springs[opts.preset] || {};
    const s = spring(opts.stiffness || p.stiffness || 220, opts.damping || p.damping || 24);
    const finish = a => a.finished.then(() => { try { a.commitStyles(); } catch (e) {} a.cancel(); }).catch(() => {});
    try {
      if (api.reduced) {
        const a = el.animate(keyframes, { duration: 1, fill: "both" });
        const frames = Array.isArray(keyframes) ? keyframes : null;
        const o0 = frames && frames[0].opacity, o1 = frames && frames[frames.length - 1].opacity;
        return finish(a).then(() => (o0 != null && o1 != null && o0 !== o1)
          ? el.animate([{ opacity: o0 }, { opacity: o1 }], { duration: 180, easing: "ease-out" }).finished.catch(() => {}) : null);
      }
      const a = el.animate(keyframes, { duration: opts.duration || s.duration, easing: opts.easing || s.easing, delay: opts.delay || 0, fill: "both" });
      return finish(a);
    } catch (e) { console.warn("[swap] animation skipped", e); return Promise.resolve(); }
  }
  // Haptics: Android uses vibrate; iOS 18+ Safari ticks when a switch checkbox toggles.
  let hapticEl;
  const coarse = matchMedia("(pointer: coarse)").matches;
  // Inside the native iOS app (ios/), haptics and sharing go to UIKit through these message handlers.
  const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.haptic ? window.webkit.messageHandlers : null;
  if (native && native.share) {
    const toDataURL = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob); });
    navigator.canShare = () => true;
    navigator.share = async (d = {}) => {
      const image = d.files && d.files[0] ? await toDataURL(d.files[0]) : null;
      native.share.postMessage({ text: [d.text, d.url].filter(Boolean).join(" "), image });
    };
  }
  function haptic(kind = "light") {
    try {
      if (native) { native.haptic.postMessage(kind); return; }
      if (navigator.vibrate) { navigator.vibrate(kind === "heavy" ? 18 : kind === "success" ? [8, 40, 12] : 6); return; }
      if (!coarse) return;
      if (!hapticEl) {
        hapticEl = document.createElement("label"); hapticEl.className = "vh"; hapticEl.setAttribute("aria-hidden", "true");
        hapticEl.innerHTML = '<input type="checkbox" switch tabindex="-1">'; document.body.appendChild(hapticEl);
      }
      hapticEl.click();
    } catch (e) {}
  }
  function countUp(el, to, { from = 0, duration = 1100, prefix = "$", decimals = 0 } = {}) {
    const fmt = v => prefix + v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    if (api.reduced) { el.textContent = fmt(to); return Promise.resolve(); }
    return new Promise(res => {
      const t0 = performance.now();
      const tick = now => {
        const p = Math.min(1, (now - t0) / duration), e = 1 - Math.pow(1 - p, 4);
        el.textContent = fmt(from + (to - from) * e);
        p < 1 ? requestAnimationFrame(tick) : res();
      };
      requestAnimationFrame(tick);
    });
  }
  const money = (n, d = 0) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- Shared state: per viewer, per profile, safe if storage is blocked ----------
  // Shape: { profile, p: { you: {...}, mealplan: {...}, social: {...} } }. Every key except "profile"
  // is stored under the active profile, so a guess or a tag on one profile never leaks into another.
  const STORE_KEY = "swap-app-v3";
  // onboarded: first-run setup finished (features/onboard.js). notify: reminder switches (one phone, not per profile).
  const GLOBAL = new Set(["profile", "onboarded", "notify"]);
  let state = { p: {} };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state = JSON.parse(raw) || state;
    else { const old = JSON.parse(localStorage.getItem("swap-app-v2") || "null"); if (old) state = { profile: "you", p: { you: old } }; }
  } catch (e) {}
  if (!state.p) state.p = {};
  // Reminders used to be stored per profile; keep the "you" choice as the phone's choice.
  if (state.notify === undefined && state.p.you && state.p.you.notify !== undefined) state.notify = state.p.you.notify;
  const subs = {};
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} };
  const bucket = id => (state.p[id] = state.p[id] || {});
  const store = {
    get: k => GLOBAL.has(k) ? state[k] : bucket(activeId())[k],
    getFor: (profileId, k) => bucket(profileId)[k],
    set(k, v) {
      if (GLOBAL.has(k)) state[k] = v; else bucket(activeId())[k] = v;
      save();
      (subs[k] || []).slice().forEach(f => { try { f(v); } catch (e) { console.error("[swap] store listener", k, e); } });
    },
    on(k, f) { (subs[k] = subs[k] || []).push(f); return () => { subs[k] = (subs[k] || []).filter(x => x !== f); }; },
    reset() { state = { p: {} }; try { localStorage.removeItem(STORE_KEY); localStorage.removeItem("swap-app-v2"); } catch (e) {} location.href = location.pathname; }
  };

  // ---------- Profiles ----------
  const ORDER = D0.order || Object.keys(D0.profiles);
  const qp = new URLSearchParams(location.search).get("profile");
  let active = (qp && D0.profiles[qp]) ? qp : (D0.profiles[state.profile] ? state.profile : "you");
  D0.active = active;
  function activeId() { return active; }
  // The four living questions. One list, one order, used by onboarding, the You sheet and Move-in.
  // q/hint/opts = full wording (onboarding, Move-in); label/short = compact wording (You sheet rows).
  const QUESTIONS = [
    { key: "kitchen", q: "What kitchen do you have?", hint: "", label: "Kitchen",
      opts: [["none", "No kitchen"], ["micro", "Microwave only"], ["shared", "Shared kitchen"], ["own", "My own kitchen"]],
      short: { none: "None", micro: "Microwave", shared: "Shared", own: "Own" } },
    { key: "meal", q: "Do you have a meal plan?", hint: "Any campus plan with swipes.", label: "Meal plan",
      opts: [["yes", "Yes"], ["no", "No"]], short: { yes: "Yes", no: "No" } },
    { key: "subway", q: "Subway time to campus?", hint: "One way, door to class.", label: "Subway to campus",
      opts: [["u15", "Under 15 min"], ["15-30", "15–30 min"], ["30+", "30+ min"], ["none", "No subway, I walk"]],
      short: { u15: "Under 15 min", "15-30": "15–30 min", "30+": "30+ min", none: "No subway" } },
    { key: "nights", q: "Late nights out per week?", hint: "Out past 11 PM.", label: "Late nights a week",
      opts: [["0", "None"], ["1-2", "1–2"], ["3+", "3 or more"]], short: { "0": "None", "1-2": "1–2", "3+": "3+" } }
  ];
  // Move-in answers (store "moveProfile", per profile) override that profile's default facts.
  const SUBWAY_MIN = { u15: 12, "15-30": 25, "30+": 35, none: null };
  const KITCHEN = { none: "none", micro: "micro", shared: "shared", own: "own" };
  const NIGHTS = { "0": 0, "1-2": 2, "3+": 3 };
  function factsFor(p) {
    const f = Object.assign({}, p.baseFacts);
    const a = bucket(p.id).moveProfile;
    if (!a) return f;
    if (a.kitchen in KITCHEN) f.kitchen = KITCHEN[a.kitchen];
    if (a.subway in SUBWAY_MIN) f.subwayMinutes = SUBWAY_MIN[a.subway];
    if (a.meal) f.hasMealPlan = a.meal === "yes";
    if (a.nights in NIGHTS) f.lateNights = NIGHTS[a.nights];
    return f;
  }
  Object.values(D0.profiles).forEach(p => {
    p.baseFacts = p.facts;
    Object.defineProperty(p, "facts", { get: () => factsFor(p), enumerable: true, configurable: true });
  });
  const profileData = () => D0.profiles[active];
  // Weekly save target (store "saveTarget", per profile) -> cap = usual - save - owed per week.
  // Live "you" has no owed amount (data.js zeroes it), so its cap is usual - save.
  const owedOf = p => (p.thisWeek.payback && p.thisWeek.payback.perWeek) || 0;
  function applySave(p, amount) {
    const t = p.thisWeek;
    t.saveTarget = amount;
    t.cap = p.usual.total - amount - owedOf(p);
  }
  // The one cap formula. Every screen that shows a cap (onboarding, You sheet, Week, Chat) uses these.
  function capOf(save) { const p = profileData(); return p.usual.total - (save == null ? p.thisWeek.saveTarget : save) - owedOf(p); }
  function capParts(save) {
    const p = profileData(), s = save == null ? p.thisWeek.saveTarget : save, owed = owedOf(p);
    return { usual: p.usual.total, save: s, owed, cap: p.usual.total - s - owed, max: p.usual.total - owed };
  }
  // "$661 usual − $100 save" (+ " − $10 owed" only when something is owed).
  function capLine(save) {
    const c = capParts(save);
    return `${money(c.usual)} usual − ${money(c.save)} save${c.owed ? ` − ${money(c.owed)} owed` : ""}`;
  }
  // Living answers for the active profile: saved answers, else a sample profile's own facts as
  // answers. "you" starts blank: its default facts are guesses, not answers.
  function answers() {
    const saved = store.get("moveProfile");
    if (saved) { const a = Object.assign({}, saved); delete a.at; return a; }
    if (active === "you") return {};
    const f = profileData().baseFacts, s = f.subwayMinutes;
    return { kitchen: f.kitchen, meal: f.hasMealPlan ? "yes" : "no",
      subway: s == null ? "none" : s < 15 ? "u15" : s <= 30 ? "15-30" : "30+",
      nights: f.lateNights <= 0 ? "0" : f.lateNights <= 2 ? "1-2" : "3+" };
  }
  function setAnswer(key, value) {
    store.set("moveProfile", Object.assign({}, answers(), store.get("moveProfile") || {}, { [key]: value, at: Date.now() }));
  }
  ORDER.forEach(id => { const s = bucket(id).saveTarget; if (typeof s === "number" && s >= 0) applySave(D0.profiles[id], s); });
  // setSave(amount): sets the active profile's save target, recomputes its cap, re-renders features
  // and fires "swap:profile" (same detail as a switch) so profile-aware features redraw too.
  function setSave(amount) {
    const p = profileData(), max = p.usual.total - owedOf(p);
    const a = Math.max(0, Math.min(max, Math.round(+amount || 0)));
    if (a === p.thisWeek.saveTarget && typeof store.get("saveTarget") === "number") return p.thisWeek.cap;
    applySave(p, a); store.set("saveTarget", a);
    features.forEach(f => { if (!f.profileAware) renderFeature(f); });
    document.dispatchEvent(new CustomEvent("swap:profile", { detail: active }));
    return p.thisWeek.cap;
  }
  function profiles() {
    return ORDER.map(id => { const p = D0.profiles[id]; return { id, label: p.label, short: p.short, source: p.source, blurb: p.blurb, active: id === active }; });
  }
  function setProfile(id) {
    if (!D0.profiles[id] || id === active) return;
    closeSheets();
    active = id; D0.active = id; store.set("profile", id);
    syncProfileUI();
    features.forEach(f => { if (!f.profileAware) renderFeature(f); });
    Object.values(views).forEach(v => { v.scrollTop = 0; });
    syncScroll(true);
    document.dispatchEvent(new CustomEvent("swap:profile", { detail: id }));
  }
  store.on("moveProfile", () => document.dispatchEvent(new CustomEvent("swap:facts", { detail: profileData().facts })));

  // ---------- Data helpers ----------
  // This week's charges with the student's own tags applied and the night window resolved.
  // Shared so every feature agrees on what counts as a protected night ride.
  function charges() {
    const D = profileData(), tags = store.get("tags") || {}, nw = D.nightWindow;
    return D.charges.map(c => {
      const tag = tags[c.id] != null ? tags[c.id] : c.tag;
      const h = c.time ? +c.time.slice(0, 2) : null;
      const night = c.kind === "ride" && (tag === "night" || (h != null && (h >= nw.start || h < nw.end)));
      return Object.assign({}, c, { tag, night });
    });
  }
  // Which day (0 = Mon .. 6 = Sun) a charge belongs to. A ride from midnight to 6 AM counts toward
  // the evening before (a 1 AM Saturday ride home is Friday night). Monday's early rides stay on Monday.
  function dayOf(c) {
    const h = c && c.time ? +c.time.slice(0, 2) : null;
    return c && c.kind === "ride" && h != null && h < 6 && c.day > 0 ? c.day - 1 : c.day;
  }
  const FOOD_KINDS = new Set(["dining", "drinks", "quick", "delivery"]);
  // "food" | "move" | "night" for a charge from charges(), or pass a kind string through.
  function kindOf(c) {
    if (typeof c === "string") return FOOD_KINDS.has(c) || c === "food" ? "food" : c === "night" ? "night" : "move";
    return FOOD_KINDS.has(c.kind) ? "food" : c.night ? "night" : "move";
  }
  const KIND_LABEL = { food: "Food", move: "Getting around", night: "Night ride" };
  const KIND_ICON = { food: "food", dining: "food", drinks: "glass", quick: "cup", delivery: "bag", move: "car", ride: "car", transit: "train", night: "moon" };
  // Non-color cue for categories: an icon string, or a ready tile with { tile: true }.
  function kindIcon(kind, { size = 18, tile = false } = {}) {
    const svg = icon(KIND_ICON[kind] || "car", size);
    if (!tile) return svg;
    const k = kindOf(kind);
    return `<span class="kind ${k}" role="img" aria-label="${KIND_LABEL[k]}">${svg}</span>`;
  }
  const kindLabel = k => KIND_LABEL[kindOf(k)];
  // The lower-fare ride app: shown under its real name on the private build (profile.rideAppName),
  // never suggested anywhere. isRideApp(text) is the one never-suggest check; displayMerchant(name)
  // is the one display mapping.
  const RIDE_APP = /lower-fare|rideapp/i;
  const isRideApp = name => RIDE_APP.test(String(name || ""));
  // Only the founder's private build (profile.recommendRideApp) may suggest the ride app. Public and
  // sample profiles: never. Night rules still hold: a cheaper app at night is fine, skipping a night ride is not.
  const rideAppAllowed = () => !!profileData().recommendRideApp;
  function displayMerchant(name) {
    const n = profileData().rideAppName;
    return n && /lower-fare/i.test(String(name || "")) ? String(name).replace(/lower-fare app/i, n) : name;
  }
  // Swaps that fit the active profile's facts. Never the lower-fare app (unless rideAppAllowed()), never a night ride.
  const NEEDS = {
    mealPlan: f => f.hasMealPlan, noMealPlan: f => !f.hasMealPlan,
    kitchen: f => f.kitchen === "shared" || f.kitchen === "own", noKitchen: f => f.kitchen === "none" || f.kitchen === "micro",
    subway: f => f.subwayMinutes != null && f.subwayMinutes <= 30
  };
  function swaps() {
    const D = profileData(), f = D.facts;
    return D.swaps.filter(s => (rideAppAllowed() || !isRideApp(`${s.title} ${s.detail} ${s.basis}`)) && !s.night &&
      (s.needs || []).every(n => !NEEDS[n] || NEEDS[n](f)));
  }
  // ---------- Real vs sample ----------
  // Live "you" (private/live.js loaded) is real everywhere: never label it sample.
  const allReal = () => { const D = profileData(); return !!D.live; };
  const isReal = field => allReal() || profileData().real.includes(field);
  // The one small badge for a screen or section. "" when the whole screen is real (live "you").
  // badge() with no field labels the profile as a whole.
  function badge(field) {
    if (allReal()) return "";
    const D = profileData();
    const real = field ? isReal(field) : D.source === "real";
    return real ? `<span class="real">Real</span>` : `<span class="sample">Sample</span>`;
  }

  // ---------- Dates (always from the active profile's weekStart, so every label agrees) ----------
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dateOf = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const fmt = (d, o) => d.toLocaleDateString("en-US", o);
  // [{ i: 0..6, date: "2026-10-26", dow: "Mon", short: "Oct 26", label: "Mon, Oct 26", isToday }]
  // Daily plan for THIS week (Mon to today). With whole-bank data (the founder's build) it covers
  // ALL money out of the bank except investing: the weekly budget is his usual all-spending week
  // (last 8 full weeks) minus the save target, split across the days by his own weekday pattern.
  // Without it (sample profiles) it falls back to food + getting around and the food/ride cap.
  // Days gone keep their first plan; what's left is spread over today and the days ahead, so an
  // expensive day lowers the rest of the week. Money in (paybacks, pay) never counts against it.
  // null when there is no current-week data, or the data is from an older week.
  function dailyPlan(save) {
    const D = profileData(), B = D.live && window.SwapLive && window.SwapLive.bank;
    const all = !!(B && Array.isArray(B.items) && B.usualOut && Array.isArray(B.dayWeights));
    const C = D.current;
    if (!C || !C.weekStart) return null;
    const w = all ? B.dayWeights : D.dayWeights;
    if (!Array.isArray(w) || w.length !== 7) return null;
    const start = dateOf(C.weekStart), now = new Date(); now.setHours(12, 0, 0, 0);
    const t = Math.round((now - start) / 864e5);
    if (t < 0 || t > 6) return null;
    const add = (a, b) => a + b;
    const s = save == null ? D.thisWeek.saveTarget : save;
    const usual = all ? B.usualOut : D.usual.total;
    const cap = all ? usual - s : capOf(save);
    const charges = all
      ? B.items.filter(i => i.week === "now").map(i => Object.assign({ merchant: i.name }, i))
      : (C.charges || []);
    const spent = [0, 0, 0, 0, 0, 0, 0];
    charges.forEach(c => {
      if (!(c.amount > 0)) return;
      const d = all ? c.day : dayOf(c);
      if (d >= 0 && d < 7) spent[d] += c.amount;
    });
    const before = spent.slice(0, t).reduce(add, 0), left = cap - before, wRest = w.slice(t).reduce(add, 0) || 1;
    const days = w.map((x, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const plan = i < t ? cap * x : Math.max(0, left) * x / wRest;
      return { i, date: iso(d), dow: fmt(d, { weekday: "short" }), short: fmt(d, { month: "short", day: "numeric" }),
        plan: Math.round(plan), spent: Math.round(spent[i] * 100) / 100, past: i < t, isToday: i === t };
    });
    const total = spent.reduce(add, 0), planSoFar = cap * w.slice(0, t).reduce(add, 0);
    return { scope: all ? "all" : "food+move", usual, save: s, cap, weekStart: C.weekStart, today: t, days,
      spent: Math.round(total * 100) / 100, left: Math.round((cap - total) * 100) / 100,
      todayPlan: days[t].plan, todayLeft: Math.round((days[t].plan - spent[t]) * 100) / 100,
      aheadBy: Math.round(planSoFar - before), charges, syncedAt: D.syncedAt };
  }
  function weekDays() {
    const D = profileData(), s = dateOf(D.weekStart);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(s); d.setDate(s.getDate() + i);
      const dow = fmt(d, { weekday: "short" }), short = fmt(d, { month: "short", day: "numeric" });
      return { i, date: iso(d), dow, short, label: `${dow}, ${short}`, isToday: iso(d) === D.today };
    });
  }
  // "Oct 26 – Nov 1" (or "Nov 2 – 8" inside one month).
  function weekLabel() {
    const w = weekDays(), a = dateOf(w[0].date), b = dateOf(w[6].date);
    return a.getMonth() === b.getMonth() ? `${w[0].short} – ${b.getDate()}` : `${w[0].short} – ${w[6].short}`;
  }
  // True when today is after the week shown (live data shows the last full week).
  const weekIsPast = () => profileData().today > weekDays()[6].date;
  const weekName = () => weekIsPast() ? "Last week" : "This week";
  const todayLabel = () => fmt(dateOf(profileData().today), { weekday: "long", month: "short", day: "numeric" });
  const weekKey = () => profileData().weekStart;

  // ---------- Shell ----------
  let appEl, viewsEl, navbar, navTitle, views = {}, navGroups = {}, tabbar, tablist, pill, toastEl, current = "week";
  const slots = {};
  function buildShell() {
    appEl = document.getElementById("app");
    appEl.innerHTML = `<div class="wall" aria-hidden="true"></div>
      <main class="views"></main>
      <div class="navbar"><div class="nav-edge"></div><div class="nav-row"><div class="nav-title" aria-hidden="true"></div></div></div>
      <div class="edge-bottom" aria-hidden="true"></div>
      <nav class="tabbar glass" aria-label="Tabs"><div role="tablist" aria-label="Swap" style="--tabs:${TABS.length}"><span class="tab-pill" aria-hidden="true"></span></div></nav>
      <div class="toast glass strong" role="status" aria-live="polite" aria-atomic="true"></div>`;
    viewsEl = appEl.querySelector(".views");
    navbar = appEl.querySelector(".navbar"); navTitle = navbar.querySelector(".nav-title");
    tabbar = appEl.querySelector(".tabbar"); tablist = tabbar.querySelector('[role="tablist"]'); pill = tablist.querySelector(".tab-pill");
    toastEl = appEl.querySelector(".toast");
    const row = navbar.querySelector(".nav-row");
    TABS.forEach((t, i) => {
      const v = el(`<section class="view" id="view-${t.id}" role="tabpanel" aria-labelledby="title-${t.id}">
        <header class="lt"><h1 class="t-largetitle" id="title-${t.id}">${t.title}</h1><p class="lt-sub t-sub"></p></header></section>`);
      viewsEl.appendChild(v); views[t.id] = v;
      v.addEventListener("scroll", () => { if (t.id === current) queueScroll(); }, { passive: true });
      const g = el(`<div class="nav-actions" data-tab="${t.id}"></div>`); row.appendChild(g); navGroups[t.id] = g;
      const b = el(`<button role="tab" id="tab-${t.id}" aria-controls="view-${t.id}" aria-selected="false" tabindex="-1" data-tab="${t.id}">${icon(t.id)}<span>${t.label}</span></button>`);
      b.addEventListener("click", () => {
        haptic(); if (!api.reduced) animate(b.querySelector("svg"), [{ scale: 1 }, { scale: .84 }, { scale: 1 }], { preset: "snappy", duration: 300 });
        // Tapping the tab you're on scrolls it to the top (iOS convention).
        if (t.id === current) { views[t.id].scrollTo({ top: 0, behavior: api.reduced ? "auto" : "smooth" }); return; }
        go(t.id);
      });
      tablist.appendChild(b);
    });
    // Tab keyboard pattern: arrows / Home / End move and select.
    tablist.addEventListener("keydown", e => {
      const ids = TABS.map(t => t.id), i = ids.indexOf(current);
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ids.length - 1 }[e.key];
      if (j == null) return;
      e.preventDefault();
      const id = ids[(j + ids.length) % ids.length]; go(id); tablist.querySelector(`[data-tab="${id}"]`).focus();
    });
    // The You button: one avatar at the right of the nav bar on every tab (after the tab's own actions).
    const pb = el(`<button class="nav-me glass strong" data-profile-btn></button>`);
    pb.addEventListener("click", () => { haptic(); youSheet(); });
    row.appendChild(pb);
    // Nothing above a view may scroll (fixes the phone shifting inside the desktop frame).
    [appEl, viewsEl, appEl.parentElement].forEach(n => n && n.addEventListener("scroll", () => { if (n.scrollTop || n.scrollLeft) { n.scrollTop = 0; n.scrollLeft = 0; } }, { passive: true }));
  }
  function syncProfileUI() {
    const p = profileData();
    const pb = navbar.querySelector("[data-profile-btn]");
    const initial = p.id === "you" ? "Y" : p.short[0];
    pb.innerHTML = `<span class="av${p.source === "sample" ? " sample" : ""}" aria-hidden="true">${initial}</span>`;
    pb.setAttribute("aria-label", p.id === "you" ? "You: weekly save, reminders, settings" : `You: settings. Showing ${p.short}, sample`);
    // Week title + dates come from the same weekStart every feature reads (api.weekDays).
    const wk = TABS.find(t => t.id === "week");
    // With live current-week data the tab opens on today's plan, so it is titled for this week;
    // the last-week recap below names its own week.
    const plan = dailyPlan();
    wk.title = plan ? "This week" : weekName();
    const h = views.week && views.week.querySelector("h1"); if (h) h.textContent = wk.title;
    if (current === "week" && navTitle) navTitle.textContent = wk.title;
    setSub("week", plan ? `${plan.days[0].short} – ${plan.days[6].short}` : p.source === "sample" ? `${weekLabel()} · Sample student` : weekLabel());
    document.querySelectorAll(".seg [data-profile]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.profile === active)));
  }
  function setSub(tab, text) { const s = views[tab] && views[tab].querySelector(".lt-sub"); if (s) { s.textContent = text || ""; s.hidden = !text; } }
  function navAction(tab, node) { if (navGroups[tab] && node) navGroups[tab].appendChild(node); return node; }

  // Scroll-linked large title, top edge, and tab-bar minimize. One rAF per frame at most.
  let ticking = false, lastY = 0, down = 0, up = 0, minimized = false;
  function queueScroll() { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; syncScroll(); }); } }
  function syncScroll(reset) {
    const v = views[current]; if (!v) return;
    const y = v.scrollTop, clamp = n => Math.max(0, Math.min(1, n));
    appEl.style.setProperty("--p", clamp(y / 44).toFixed(3));
    appEl.style.setProperty("--edge", clamp(y / 14).toFixed(3));
    appEl.style.setProperty("--pull", clamp(-y / 90).toFixed(3));
    const tab = TABS.find(t => t.id === current);
    if (reset) { lastY = y; down = up = 0; minimized = false; }
    else {
      const dy = y - lastY; lastY = y;
      if (y < 8 || tab.minimize === false) minimized = false;
      else if (dy > 0) { down += dy; up = 0; if (down > 24 && y > 60) minimized = true; }
      else if (dy < 0) { up -= dy; down = 0; if (up > 12) minimized = false; }
    }
    appEl.classList.toggle("tb-min", minimized);
  }

  function go(tab) {
    if (!views[tab]) return;
    current = tab;
    Object.entries(views).forEach(([id, v]) => { const on = id === tab; v.classList.toggle("on", on); v.inert = !on; if (on) v.removeAttribute("aria-hidden"); else v.setAttribute("aria-hidden", "true"); });
    tablist.querySelectorAll('[role="tab"]').forEach(b => { const on = b.dataset.tab === tab; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
    Object.entries(navGroups).forEach(([id, g]) => g.classList.toggle("on", id === tab));
    navTitle.textContent = TABS.find(t => t.id === tab).title;
    const b = tablist.querySelector(`[data-tab="${tab}"]`);
    pill.style.left = b.offsetLeft + "px"; pill.style.width = b.offsetWidth + "px";
    syncScroll(true);
    document.dispatchEvent(new CustomEvent("swap:tab", { detail: tab }));
  }

  // ---------- Sheets ----------
  // sheet(content, { label, title, detent: "large" | "medium", onClose })
  // content: an Element, or a function(body, close) that fills the body.
  // detent "medium" = floating inset glass sheet sized to its content (short flows, pickers).
  // Focus moves to the sheet's title (title option, or the first h1/h2 in the body); Escape closes;
  // everything behind is inert; focus returns to the opener on close.
  const openSheets = [];
  let sheetSeq = 0;
  // One chrome for every sheet: Back chevron top-left (only on multi-step sheets, via
  // handle.setBack(fn) or api.sheetBack(body, fn)), Close X top-right, one primary action at the
  // bottom (api.sheetActions). No Back or Done buttons in the bottom bar.
  function sheet(content, { label = "Sheet", title, detent = "large", onClose, beforeClose, back } = {}) {
    const scrim = el(`<div class="scrim"></div>`);
    const sh = el(`<div class="sheet${detent === "medium" ? " inset" : ""}" role="dialog" aria-modal="true" aria-label="${esc(label)}">
      <div class="sheet-chrome"><button class="back" aria-label="Back" hidden>${icon("back", 18, 2.4)}</button><div class="grab" aria-hidden="true"></div><button class="close" aria-label="Close">${icon("close", 16, 2.4)}</button></div>
      <div class="body"></div></div>`);
    appEl.append(scrim, sh);
    const behind = [viewsEl, tabbar, navbar, document.querySelector(".panel")].filter(Boolean);
    behind.forEach(n => (n.inert = true));
    const body = sh.querySelector(".body");
    const prevFocus = document.activeElement;
    let closed = false;
    const onKey = e => { if (e.key === "Escape" && openSheets[openSheets.length - 1] === handle) { e.stopPropagation(); close(); } };
    function close() {
      if (closed) return; closed = true;
      if (beforeClose) { try { beforeClose(); } catch (e) { console.error("[swap] beforeClose", e); } }
      sh.inert = true; sh.setAttribute("aria-hidden", "true");   // no longer a modal while it animates out
      document.removeEventListener("keydown", onKey);
      const i = openSheets.indexOf(handle); if (i >= 0) openSheets.splice(i, 1);
      if (!openSheets.length) behind.forEach(n => (n.inert = false));
      sh.style.pointerEvents = "none"; scrim.style.pointerEvents = "none";   // a closing sheet takes no taps
      scrim.classList.remove("on");
      if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      animate(sh, [{ translate: getComputedStyle(sh).translate }, { translate: "0 110%" }], { stiffness: 260, damping: 32 })
        .then(() => { scrim.remove(); sh.remove(); onClose && onClose(); });
    }
    const backBtn = sh.querySelector(".sheet-chrome .back");
    // setBack(fn): show the Back chevron and run fn on tap; setBack(null) hides it (first step).
    function setBack(fn) {
      backBtn.hidden = !fn;
      backBtn.onclick = fn ? () => { haptic(); fn(); } : null;
    }
    const handle = { close, body, el: sh, setBack };
    sh._sheet = handle;
    openSheets.push(handle);
    if (back) setBack(back);
    if (title) body.appendChild(el(`<h2 class="sheet-title t-title">${esc(title)}</h2>`));
    if (typeof content === "function") content(body, close); else if (content) body.appendChild(content);
    requestAnimationFrame(() => scrim.classList.add("on"));
    animate(sh, [{ translate: "0 110%" }, { translate: "0 0" }], { preset: "gentle" });
    // Drag the grabber down to dismiss.
    const grab = sh.querySelector(".grab"); let y0 = null;
    grab.addEventListener("pointerdown", e => { sh.getAnimations().forEach(a => { try { a.commitStyles(); } catch (err) {} a.cancel(); }); y0 = e.clientY; grab.setPointerCapture(e.pointerId); });
    grab.addEventListener("pointermove", e => { if (y0 == null) return; sh.style.translate = `0 ${Math.max(0, e.clientY - y0)}px`; });
    const release = e => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; if (dy > 120) close(); else animate(sh, [{ translate: `0 ${Math.max(0, dy)}px` }, { translate: "0 0" }], { preset: "standard" }); };
    grab.addEventListener("pointerup", release); grab.addEventListener("pointercancel", release);
    document.addEventListener("keydown", onKey);
    sh.querySelector(".close").onclick = close; scrim.onclick = close;
    if (!focusTitle(body)) sh.querySelector(".close").focus({ preventScroll: true });
    return handle;
  }
  function closeSheets() { openSheets.slice().forEach(s => s.close()); }
  // Focus the first heading in a node (call after every step swap). Also re-labels its dialog.
  function focusTitle(node) {
    const h = node && node.querySelector("h1, h2, [data-title]");
    if (!h) return null;
    if (!h.id) h.id = "sheet-title-" + (++sheetSeq);
    h.tabIndex = -1;
    const dlg = h.closest('[role="dialog"]'); dlg && dlg.setAttribute("aria-labelledby", h.id);
    requestAnimationFrame(() => h.isConnected && h.focus({ preventScroll: true }));
    return h;
  }
  // Pin actions to the bottom of the sheet that holds `body`, above the home indicator.
  // buttons: Elements, or { label, kind: "primary" | "secondary" | "tint" | "plain", icon, onClick }.
  // Call again to replace them; pass [] to remove.
  function sheetActions(body, buttons = []) {
    const sh = body && body.closest(".sheet");
    if (!sh) return null;
    let bar = sh.querySelector(":scope > .sheet-actions");
    if (!bar) { bar = el(`<div class="sheet-actions"></div>`); sh.appendChild(bar); }
    bar.replaceChildren(...buttons.map(b => {
      if (b instanceof Element) return b;
      const n = el(`<button class="btn ${b.kind || "primary"}">${b.icon ? icon(b.icon, 20) : ""}<span>${esc(b.label)}</span></button>`);
      b.onClick && n.addEventListener("click", b.onClick);
      return n;
    }));
    bar.hidden = !buttons.length;
    sh.classList.toggle("has-actions", !!buttons.length);
    return bar;
  }
  // Show (fn) or hide (null) the top-left Back chevron of the sheet that holds `body`.
  function sheetBack(body, fn) { const sh = body && body.closest(".sheet"); if (sh && sh._sheet) sh._sheet.setBack(fn); }

  // Single-choice group: roving tabindex, arrows move and select. items are [role=radio] children.
  function radios(group, onPick) {
    const items = () => [...group.querySelectorAll('[role="radio"]')].filter(x => !x.disabled);
    const pick = b => {
      items().forEach(x => { const on = x === b; x.setAttribute("aria-checked", String(on)); x.tabIndex = on ? 0 : -1; });
      onPick && onPick(b.dataset.v, b);
    };
    items().forEach(b => b.addEventListener("click", () => { haptic(); pick(b); }));
    group.addEventListener("keydown", e => {
      const list = items(), i = list.indexOf(document.activeElement);
      const j = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1 }[e.key];
      if (j == null || i < 0) return;
      e.preventDefault(); const n = list[(j + list.length) % list.length]; n.focus(); pick(n);
    });
    const list = items(), on = list.find(x => x.getAttribute("aria-checked") === "true") || list[0];
    list.forEach(x => (x.tabIndex = x === on ? 0 : -1));
    return { pick };
  }

  // ---------- You sheet: weekly save, reminders, where you live, whose data, set up again ----------
  // Opened from the avatar on every tab, or api.openYou("save" | "remind" | "home" | "whose").
  const REMINDERS = [
    { k: "sunday", title: "Sunday 6 PM recap", sub: "Week total and cap", icon: "week" },
    { k: "daily", title: "Noon tag reminder", sub: "Tag why you bought it", icon: "receipt" }
  ];
  const SAVE_PRESETS = [25, 50, 100, 150];
  function youSheet(section) {
    const p = profileData();
    let save = p.thisWeek.saveTarget, saveTimer = null, factsDirty = false;
    const commitSave = () => { clearTimeout(saveTimer); saveTimer = null; if (save !== profileData().thisWeek.saveTarget) setSave(save); };
    const h = sheet((body, close) => {
      const sub = p.live ? esc(p.blurb) : p.source === "sample" ? `${esc(p.short)}: sample student` : esc(p.blurb);
      body.insertAdjacentHTML("beforeend", `<p class="t-sub t-2 you-sub">${sub}</p>
        <section class="you-sec" data-sec="save" aria-labelledby="you-save-h">
          <h3 class="you-h t-headline" id="you-save-h" tabindex="-1">Weekly save</h3>
          <div class="card you-save">
            <div class="you-stepper">
              <button class="icon-btn you-step" data-d="-5" aria-label="Save $5 less">${icon("minus", 22, 2.2)}</button>
              <span class="you-amt"><span class="n-m num"></span><span class="t-foot t-2">a week</span></span>
              <button class="icon-btn you-step" data-d="5" aria-label="Save $5 more">${icon("plus", 22, 2.2)}</button>
            </div>
            <div class="you-presets" role="group" aria-label="Quick amounts">${SAVE_PRESETS.map(v =>
              `<button class="chip" data-v="${v}" aria-pressed="false">${money(v)}</button>`).join("")}</div>
            <div class="you-cap">
              <span class="grow"><b class="t-headline">Cap</b><span class="t-foot t-2 you-line"></span></span>
              <span class="n-m num you-capn"></span>
            </div>
            <p class="t-foot t-2 you-help">Cap: usual minus savings.</p>
          </div>
          <p class="vh" role="status" aria-live="polite" data-save-status></p>
        </section>
        <section class="you-sec" data-sec="remind" aria-labelledby="you-rem-h">
          <h3 class="you-h t-headline" id="you-rem-h" tabindex="-1">Reminders</h3>
          <div class="card you-list">${REMINDERS.map(r => `
            <button class="switch-row" role="switch" data-k="${r.k}" aria-checked="false">
              <span class="well" aria-hidden="true">${icon(r.icon, 20)}</span>
              <span class="grow"><b class="t-headline">${r.title}</b><span class="t-foot t-2">${r.sub}</span></span>
              <span class="switch" aria-hidden="true"></span></button>`).join("")}</div>
          ${notify.available ? "" : `<p class="t-foot t-2 you-note">In the iPhone app.</p>`}
        </section>
        <section class="you-sec" data-sec="home" aria-labelledby="you-home-h">
          <h3 class="you-h t-headline" id="you-home-h" tabindex="-1">Where you live</h3>
          <div class="card you-qs">${QUESTIONS.map(q => `
            <div class="you-q"><span class="t-sub t-2" id="you-q-${q.key}">${q.label}</span>
              <div class="you-opts" role="radiogroup" aria-labelledby="you-q-${q.key}" data-k="${q.key}">${q.opts.map(([v]) =>
                `<button class="chip" role="radio" data-v="${v}" aria-checked="false">${esc(q.short[v])}</button>`).join("")}</div></div>`).join("")}</div>
        </section>
        <section class="you-sec" data-sec="whose" aria-labelledby="you-who-h">
          <h3 class="you-h t-headline" id="you-who-h" tabindex="-1">Whose data</h3>
          <div class="choices you-who">${profiles().map(x => `
            <button class="choice" data-id="${x.id}"${x.active ? ' aria-current="true"' : ""}>
              <span class="grow"><b>${esc(x.short)} <span class="${x.source === "real" ? "real" : "sample"}">${x.source === "real" ? "Real" : "Sample"}</span></b><span>${esc(x.blurb)}</span></span>
              <span class="tick" aria-hidden="true">${icon("check", 14, 3)}</span></button>`).join("")}</div>
        </section>
        ${features.some(f => f.id === "onboard") ? `<button class="btn tint block you-again">Set up again</button>` : ""}`);

      // Weekly save: stepper + presets, live cap, committed (debounced) through setSave.
      const amt = body.querySelector(".you-amt .n-m"), capN = body.querySelector(".you-capn"), line = body.querySelector(".you-line");
      const status = body.querySelector("[data-save-status]"), minus = body.querySelector('[data-d="-5"]'), plus = body.querySelector('[data-d="5"]');
      let statusTimer;
      const syncSave = (announce, bump) => {
        const c = capParts(save);
        amt.textContent = money(save); capN.textContent = money(c.cap); line.textContent = capLine(save);
        minus.disabled = save <= 0; plus.disabled = save + 5 > c.max;
        body.querySelectorAll(".you-presets .chip").forEach(b => { b.setAttribute("aria-pressed", String(+b.dataset.v === save)); b.disabled = +b.dataset.v > c.max; });
        if (bump) animate(capN, [{ scale: .94, opacity: .6 }, { scale: 1, opacity: 1 }], { preset: "snappy" });
        if (announce) { clearTimeout(statusTimer); statusTimer = setTimeout(() => { status.textContent = `Saving ${money(save)} a week. Cap ${money(c.cap)}.`; }, 250); }
      };
      const change = v => {
        save = Math.max(0, Math.min(capParts(save).max, v)); haptic(); syncSave(true, true);
        clearTimeout(saveTimer); saveTimer = setTimeout(commitSave, 450);
      };
      [minus, plus].forEach(b => b.addEventListener("click", () => change(save + +b.dataset.d)));
      body.querySelectorAll(".you-presets .chip").forEach(b => b.addEventListener("click", () => change(+b.dataset.v)));
      syncSave(false, false);

      // Reminders: native switches; on the web they show their state but are disabled.
      const syncRem = () => {
        const on = notify.state() || {};
        body.querySelectorAll(".switch-row").forEach(b => {
          b.setAttribute("aria-checked", String(!!on[b.dataset.k]));
          if (!notify.available) b.setAttribute("aria-disabled", "true");
        });
      };
      body.querySelectorAll(".switch-row").forEach(b => b.addEventListener("click", () => {
        if (!notify.available) { toast("Reminders work in the iPhone app", "lock"); return; }
        haptic();
        const o = Object.assign({ sunday: false, daily: false }, notify.state() || {}, { [b.dataset.k]: b.getAttribute("aria-checked") !== "true" });
        if (o.sunday || o.daily) notify.enable(o); else notify.disable();
        syncRem();
      }));
      syncRem();

      // Where you live: the same answers Move-in and onboarding write.
      const a = answers();
      body.querySelectorAll(".you-opts").forEach(g => {
        g.querySelectorAll('[role="radio"]').forEach(b => b.setAttribute("aria-checked", String(a[g.dataset.k] === b.dataset.v)));
        radios(g, v => { setAnswer(g.dataset.k, v); factsDirty = true; });
      });

      // Whose data: picking is a command (closes the sheet and switches).
      body.querySelectorAll(".you-who .choice").forEach(b => b.addEventListener("click", () => {
        haptic();
        const id = b.dataset.id, changed = id !== active;
        close();
        if (changed) setTimeout(() => { setProfile(id); const q = D0.profiles[id]; toast(`Showing ${q.short}${q.source === "sample" ? " (sample)" : ""}`, id === "you" ? "person" : "people"); }, 120);
      }));
      const again = body.querySelector(".you-again");
      again && again.addEventListener("click", () => { haptic(); open("onboard"); });
    }, {
      label: "You", title: "You",
      // Leaving the sheet (any way) commits a pending save, and redraws features if living answers changed.
      beforeClose: () => {
        if (saveTimer) commitSave();
        if (factsDirty) { factsDirty = false; features.forEach(f => { if (!f.profileAware) renderFeature(f); }); document.dispatchEvent(new CustomEvent("swap:profile", { detail: active })); }
      }
    });
    if (section) {
      const s = h.body.querySelector(`[data-sec="${section}"]`);
      if (s) requestAnimationFrame(() => { h.body.scrollTop = Math.max(0, s.offsetTop - 12); const hd = s.querySelector(".you-h"); hd && hd.focus({ preventScroll: true }); });
    }
    return h;
  }

  // ---------- Toast (one persistent live region, created at boot) ----------
  let toastTimer, toastSet;
  // toast(text, icon, { action: { label: "Undo", onClick } }): an action keeps it up for 4s and makes it tappable.
  function toast(text, iconName = "check", { action } = {}) {
    clearTimeout(toastTimer); clearTimeout(toastSet);
    toastEl.textContent = ""; toastEl.classList.remove("has-action");
    toastSet = setTimeout(() => {   // a later tick, so repeated identical toasts are announced again
      toastEl.innerHTML = icon(iconName, 16, 2.4) + `<span>${esc(text)}</span>`;
      if (action) {
        const b = el(`<button class="toast-act">${esc(action.label)}</button>`);
        b.addEventListener("click", () => { haptic(); toastEl.classList.remove("on"); try { action.onClick && action.onClick(); } catch (e) { console.error(e); } });
        toastEl.appendChild(b); toastEl.classList.add("has-action");
      }
      toastEl.classList.add("on");
      toastTimer = setTimeout(() => toastEl.classList.remove("on"), action ? 4000 : 2200);
    }, 50);
  }

  // ---------- api ----------
  // ---------- Brand logos (bundled in brand/, so they work offline) ----------
  // Match a merchant name to a logo file; generic places (e.g. "Thai restaurant") get null -> use kindIcon.
  const BRANDS = [
    ["uber eats", "ubereats"], ["ubereats", "ubereats"], ["doordash", "doordash"], ["dashpass", "doordash"], ["grubhub", "grubhub"],
    ["seamless", "seamless"], ["uber", "uber"], ["lyft", "lyft"], ["citi bike", "citibike"], ["omny", "omny"], ["mta", "mta"],
    ["chipotle", "chipotle"], ["raising cane", "raisingcanes"], ["panda express", "pandaexpress"], ["starbucks", "starbucks"],
    ["sweetgreen", "sweetgreen"], ["cava", "cava"], ["joe & the juice", "joeandthejuice"], ["joe and the juice", "joeandthejuice"],
    ["blank street", "blankstreet"], ["shake shack", "shakeshack"], ["chick-fil-a", "chickfila"], ["mcdonald", "mcdonalds"],
    ["domino", "dominos"], ["wingstop", "wingstop"], ["dunkin", "dunkin"], ["trader joe", "traderjoes"], ["apple", "apple"], ["hulu", "hulu"], ["anthropic", "anthropic"], ["popeyes", "popeyes"]
  ];
  // Logo file for a merchant: the private build's own logos first (window.SwapLive.logos, keyed by
  // display name; matched on the display name and the raw name), then the bundled App Store icons.
  function logo(name) {
    const raw = String(name || ""), shown = String(displayMerchant(raw) || "");
    const L = window.SwapLive && window.SwapLive.logos;
    if (L) {
      const keys = Object.keys(L), lc = k => k.toLowerCase();
      for (const n of [shown, raw].map(lc)) {
        const exact = keys.find(k => lc(k) === n);
        if (exact) return L[exact];
      }
      for (const n of [shown, raw].map(lc)) {
        const part = keys.filter(k => k.length > 2 && n.includes(lc(k))).sort((x, y) => y.length - x.length)[0];
        if (part) return L[part];
      }
    }
    if (isRideApp(shown) || isRideApp(raw)) return null;   // never borrow another ride brand's icon
    const n = (shown + " " + raw).toLowerCase();
    const hit = BRANDS.find(([k]) => n.includes(k));
    return hit ? `brand/${hit[1]}.png` : null;
  }
  // "Thai restaurant" -> "TR", "Cava" -> "C". Brand part only ("DoorDash · Thai" -> "D").
  function initials(name) {
    const words = String(name || "").split(/\s+[·|-]\s+/)[0].replace(/[^\p{L}\p{N}\s&']/gu, " ").split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
    if (!words.length) return "";
    return (words.length > 1 ? words[0][0] + words[1][0] : words[0][0]).toUpperCase();
  }
  // App-icon-style mark for a merchant: its logo, else a letter tile tinted by category (food / move /
  // night), else (no name) the category glyph. Decorative by default (alt=""), since the merchant name
  // sits next to it; pass `label` when the mark stands alone.
  function brandMark(name, kind, size = 36, label) {
    const src = logo(name), k = kindOf(kind || "food"), alt = label ? esc(label) : "";
    if (src) return `<span class="brandmark" style="--bm:${size}px"><img src="${esc(src)}" alt="${alt}" width="${size}" height="${size}" loading="lazy" decoding="async"></span>`;
    const ini = initials(displayMerchant(name));
    const a11y = label ? `role="img" aria-label="${alt}"` : `aria-hidden="true"`;
    if (ini) return `<span class="brandmark letter k-${k}" style="--bm:${size}px" ${a11y}>${esc(ini)}</span>`;
    return `<span class="brandmark generic k-${k}" style="--bm:${size}px" ${a11y}>${kindIcon(kind || "food", { size: Math.round(size * .5) })}</span>`;
  }

  // ---------- Notifications (native iOS app only; scheduled locally, no server) ----------
  const notify = {
    available: !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.notify),
    // opts: { sunday: true (Sun 6pm recap), daily: true (noon tag prompt) }
    enable(opts = { sunday: true, daily: false }) { if (notify.available) window.webkit.messageHandlers.notify.postMessage(Object.assign({ action: "schedule" }, opts)); store.set("notify", opts); },
    disable() { if (notify.available) window.webkit.messageHandlers.notify.postMessage({ action: "cancel" }); store.set("notify", null); },
    state: () => store.get("notify")
  };

  // Private, on-device data (founder's real subscriptions). Absent on the public site.
  const privateData = () => window.SwapPrivate || null;

  const api = {
    logo, brandMark, notify, privateData,
    charges, dayOf, swaps, isRideApp, rideAppAllowed, displayMerchant, isReal, allReal, badge, kindOf, kindIcon, kindLabel, icon, spring, springs, animate, haptic, countUp, money, el, esc, store,
    sheet, sheetActions, sheetBack, focusTitle, toast, setSub, navAction, radios,
    profile: () => active, setProfile, profiles, setSave, capOf, capParts, capLine,
    facts: () => profileData().facts, questions: QUESTIONS, answers, setAnswer,
    weekDays, weekLabel, weekName, weekIsPast, weekKey, todayLabel, dailyPlan,
    openYou: section => { closeSheets(); return youSheet(section); },
    go: t => go(t), open: id => open(id), current: () => current,
    reduced: rmq.matches
  };
  // api.data always points at the active profile (same field names as before profiles existed).
  Object.defineProperty(api, "data", { get: profileData, enumerable: true });
  rmq.addEventListener && rmq.addEventListener("change", e => { api.reduced = e.matches; });

  function open(id) {
    const f = features.find(x => x.id === id);
    if (!f) return;
    closeSheets();
    const switching = f.tab && f.tab !== current;
    if (f.tab) go(f.tab);
    if (f.open) setTimeout(() => f.open(api), switching ? 200 : 60);
    else {
      // Scroll the view's own scroller. Never scrollIntoView: it also scrolls .app/.device.
      const v = views[f.tab], s = slots[id];
      if (v && s) {
        const pad = parseFloat(getComputedStyle(v).paddingTop) || 0;
        v.scrollTo({ top: Math.max(0, s.offsetTop - pad - 6), behavior: api.reduced ? "auto" : "smooth" });
      }
    }
    markPanel(id);
  }

  // ---------- Feature rendering ----------
  function renderFeature(f) {
    const slot = slots[f.id]; if (!slot) return;
    if (typeof f._dispose === "function") { try { f._dispose(); } catch (e) {} }
    f._dispose = null;
    slot.replaceChildren();
    try { const r = f.render(slot, api); if (typeof r === "function") f._dispose = r; }
    catch (e) {
      console.error(`[swap] ${f.id} failed`, e);
      const fail = el(`<div class="card load-fail"><p class="t-sub t-2">This part didn't load.</p><button class="btn tint small">Try again</button></div>`);
      fail.querySelector("button").addEventListener("click", () => renderFeature(f));
      slot.replaceChildren(fail);
    }
  }

  // ---------- Desktop panel ----------
  function markPanel(id) { document.querySelectorAll(".feature-list button").forEach(b => b.setAttribute("aria-current", String(b.dataset.id === id))); }
  function buildPanel() {
    const list = document.querySelector(".feature-list");
    if (!list) return;
    const reset = document.querySelector("[data-reset]");
    reset && reset.addEventListener("click", () => store.reset());
    const seg = document.querySelector(".seg");
    if (seg) {
      profiles().forEach(p => {
        const b = el(`<button role="radio" data-profile="${p.id}" aria-checked="${p.active}">${esc(p.short)}<small>${p.source === "real" ? "Real" : "Sample"}</small></button>`);
        b.addEventListener("click", () => setProfile(p.id));
        seg.appendChild(b);
      });
      seg.addEventListener("keydown", e => {
        const ids = ORDER, i = ids.indexOf(active);
        const j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1 }[e.key];
        if (j == null) return;
        e.preventDefault(); const id = ids[(j + ids.length) % ids.length]; setProfile(id); seg.querySelector(`[data-profile="${id}"]`).focus();
      });
    }
    // Fine print: live "you" is real card data, so no prototype or sample wording about it.
    const fine = document.querySelector("[data-fine]"), you = D0.profiles.you;
    if (fine) fine.textContent = you.live
      ? `You: your card data, ${you.blurb.replace(/^Your card, s/, "s")}. Meal plan and Weekend are sample students.`
      : "Prototype. You: real card history, sample week. Meal plan and Weekend: sample students.";
    const tabIndex = id => TABS.findIndex(t => t.id === id);
    features.slice().sort((a, b) => (tabIndex(a.tab) - tabIndex(b.tab)) || ((a.order || 0) - (b.order || 0))).forEach(f => {
      const li = el(`<li><button data-id="${f.id}" aria-current="false"><strong>${esc(f.title)}</strong><span>${esc(f.pitch || "")}</span></button></li>`);
      li.firstElementChild.addEventListener("click", () => open(f.id));
      list.appendChild(li);
    });
  }
  // Fit the 874px phone frame into short desktop windows.
  const phoneMQ = matchMedia("(max-width: 640px), (display-mode: standalone), (hover: none) and (pointer: coarse)");
  function fitDevice() {
    const s = phoneMQ.matches ? 1 : Math.min(1, (innerHeight - 40) / 874);
    const r = document.documentElement.style;
    r.setProperty("--device-scale", s.toFixed(3));
    const d = document.querySelector(".device");
    if (d) d.style.margin = phoneMQ.matches ? "" : `${(-(1 - s) * 437).toFixed(1)}px ${(-(1 - s) * 201).toFixed(1)}px`;
  }

  // ---------- iOS keyboard + touch ----------
  function watchKeyboard() {
    const vv = window.visualViewport;
    if (vv) {
      const sync = () => { const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
        document.documentElement.style.setProperty("--kb", kb + "px"); appEl.classList.toggle("kb", kb > 80); };
      vv.addEventListener("resize", sync); vv.addEventListener("scroll", sync);
    }
    // iOS can leave the page scrolled after the keyboard closes; put it back.
    document.addEventListener("focusout", e => { if (e.target.matches && e.target.matches("input, textarea")) setTimeout(() => window.scrollTo(0, 0), 60); });
    document.addEventListener("touchstart", () => {}, { passive: true }); // lets :active fire on iOS
  }

  // Expose the springs to CSS so transitions (tab pill, tab bar, toast) use the same physics.
  function springVars() {
    const r = document.documentElement.style;
    Object.entries(springs).forEach(([name, p]) => {
      const s = spring(p.stiffness, p.damping);
      r.setProperty(`--ease-${name}`, s.easing); r.setProperty(`--dur-${name}`, s.duration + "ms");
    });
  }

  // ---------- Boot ----------
  window.Swap = {
    feature(def) { features.push(def); },
    api,
    start() {
      springVars();
      buildShell();
      watchKeyboard();
      features.sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(f => {
        if (!f.tab || !f.render || !views[f.tab]) return;
        const slot = el(`<div class="slot" id="slot-${f.id}"></div>`);
        views[f.tab].appendChild(slot); slots[f.id] = slot;
        renderFeature(f);
      });
      buildPanel();
      syncProfileUI();
      fitDevice(); addEventListener("resize", fitDevice);
      go("week");
      // Optional boot(api) hook for features with no tab slot (e.g. onboard opens itself on first launch).
      features.forEach(f => { if (typeof f.boot === "function") { try { f.boot(api); } catch (e) { console.error(`[swap] ${f.id} boot failed`, e); } } });
      const deep = new URLSearchParams(location.search).get("open");
      if (deep) setTimeout(() => open(deep), 400);
    }
  };
})();
