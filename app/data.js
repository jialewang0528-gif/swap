/* Swap prototype data: profiles that share one shape.
   - you      = the viewer's own bank (live data only; see below). Never on the public site.
   - mealplan = SAMPLE dorm student on a meal plan. Illustrative; chain names are examples.
   - social   = SAMPLE weekend social spender. Illustrative; chain names are examples. The public default.

   Every profile has the same fields, so features read api.data the same way for all of them:
     id, label, short, source ("real" | "sample"), blurb, real (fields that are REAL data),
     facts { hasMealPlan, kitchen, subwayMinutes, lateNights, moved },
     today, weekLabel, nightWindow, tags,
     usual { food, move, total }            = mean of the last 6 weekly rows (rounded)
     thisWeek { food, move, total, cap, saveTarget, payback, paidBack }
                                            food/move/total = sum of `charges`
                                            cap = usual.total - saveTarget - payback.perWeek
     weekly [ { wk, ride, delivery, dining, drinks, quick, transit } ]  (Mon-start weeks, last row = this week)
     move, ridePrices, subway, priceGaps, memberships, mealPlan (null if none), charges, swaps.

   For the sample profiles, the derived numbers are computed below from the rows and charges, so
   they can't drift. For `you`, they come from the live data.
   Kinds: food = dining + drinks + quick + delivery; move ("getting around") = ride + transit.
   Night rides (11 PM to 6 AM, or tagged "night") are counted and never a swap target. */
(function () {
  const shared = {
    today: "2026-11-01",            // Sunday of the demo week
    weekStart: "2026-10-26",
    weekLabel: "Oct 26 – Nov 1",
    nightWindow: { start: 23, end: 6 },
    tags: { food: ["planned", "tired", "late", "friends", "treat"], move: ["class", "late", "out", "night", "errand"] }
  };

  // ---------------- you: the viewer's own bank, only when there is one ----------------
  // "you" exists only with live data: private/live.js (the founder's phone build) or a signed-up
  // person's data from cloud.js. The public site has no "you" and opens on a sample student.
  // No real numbers are written in this file. The founder's own base numbers (move date, DashPass,
  // sample week and swaps) are in private/founder.js (gitignored) as window.SwapFounder.
  const L = window.SwapLive;
  const you = L ? Object.assign({
    id: "you", label: "You", short: "You", source: "real", blurb: "Your bank.",
    real: [],
    // Defaults until the person answers Move-in (store "moveProfile" overrides these).
    facts: { hasMealPlan: false, kitchen: "none", subwayMinutes: 30, lateNights: 2, moved: false },
    thisWeek: { saveTarget: 50, payback: { owed: 0, perWeek: 0, weeksLeft: 0 }, paidBack: 0 },
    weekly: [],
    move: { date: null, beforeLabel: "Before", afterLabel: "Now", ridesPerWeekBefore: 0, ridesPerWeekAfter: 0, rideSpendBefore: 0, rideSpendAfter: 0 },
    ridePrices: [], subway: { fare: 3, weeklyCap: 35 }, priceGaps: [], memberships: [], mealPlan: null,
    charges: [], swaps: []
  }, window.SwapFounder) : null;

  // ---------------- you: live data (private/live.js from sync.py, or cloud.js) ----------------
  // Every number in "You" is real: last full week, charges, history.
  // "2026-11-03T00:47" -> "Nov 3, 12:47 AM" (no raw ISO timestamps on screen).
  const synced = iso => {
    const [d, t = "00:00"] = String(iso).split("T"), [y, m, day] = d.split("-").map(Number), [h, min] = t.split(":").map(Number);
    const mon = new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${mon}, ${h % 12 || 12}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  if (you) {
    Object.assign(you, {
      label: "You", blurb: "Your bank, synced " + synced(L.generatedAt), syncedAt: L.generatedAt,
      rideAppName: L.rideAppName || null,
      live: true,
      real: ["usual", "thisWeek", "weekly", "charges", "move", "ridePrices", "priceGaps", "memberships", "subway", "current", "dayWeights"],
      today: L.today, weekStart: L.weekStart, weekLabel: L.weekLabel,
      usual: L.usual, weekly: L.weekly, charges: L.charges,
      ridePrices: L.ridePrices.length ? L.ridePrices : you.ridePrices,
      priceGaps: L.priceGaps.length ? L.priceGaps : you.priceGaps,
      subway: L.subway,
      current: L.current || null, dayWeights: L.dayWeights || null
    });
    Object.assign(you.move, { rideSpendAfter: L.move.rideSpendAfter });
    // The private build: show the lower-fare app by its own name (L.rideAppName, from .env), and,
    // when the data allows it, recommend it over Uber/Lyft. The name is never written in this file.
    you.recommendRideApp = !!L.recommendRideApp;
    const escRe = x => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const RIDE_RE = new RegExp(`lower-fare${L.rideAppName ? "|" + escRe(L.rideAppName) : ""}`, "i");
    if (you.recommendRideApp) {
      const med = re => (you.ridePrices.find(r => re.test(r.app)) || {}).median;
      const count = re => (you.ridePrices.find(r => re.test(r.app)) || {}).count || 0;
      const cheap = med(RIDE_RE), dear = med(/uber/i) || med(/lyft/i);
      const name = you.rideAppName || "Lower-fare app";
      // Share of rides already on the lower-fare app. Suggesting it only makes sense if Uber/Lyft is still common.
      const all = you.ridePrices.reduce((t, r) => t + (r.count || 0), 0);
      you.rideAppShare = all ? count(RIDE_RE) / all : 0;
      you.swaps = you.swaps.filter(x => x.id !== "rideapp-rides");
      if (cheap && dear && dear > cheap && you.rideAppShare < 0.8) {
        you.swaps = [{ id: "rideapp-rides", title: `${name} instead of Uber or Lyft`, detail: "Same trip, lower fare.",
          save: Math.round(dear - cheap), unit: "ride", kind: "move", basis: `Your Uber median vs ${name} median`, rideApp: true }]
          .concat(you.swaps);
      } else if (cheap) {
        // Already on the cheapest app: the next step down is the subway, daytime only.
        const n = count(RIDE_RE);
        you.swaps = [{ id: "subway-day", title: "Subway for daytime rides",
          detail: "Daytime only. Night rides stay as they are.",
          why: `${name} already: ${n} of ${all} rides`,
          save: Math.round(cheap - (L.subway && L.subway.fare || 3)), unit: "ride", kind: "move",
          basis: `Your ${name} median ${"$" + Math.round(cheap)} vs a $${L.subway && L.subway.fare || 3} fare`, needs: ["subway"] }]
          .concat(you.swaps.filter(x => x.id !== "subway-am"));
      }
    }
    // His real swaps (sync.py swapOptions: from his own charges, last 10 weeks), plus cancelling a
    // subscription (private/subscriptions.js) and the DashPass student plan. Replaces the sample list.
    if (Array.isArray(L.swapOptions) && L.swapOptions.length) {
      const keep = you.swaps.filter(x => x.id === "rideapp-rides" || x.id === "dashpass-student");
      const subs = ((window.SwapPrivate || {}).subscriptions || [])
        .filter(s => s.active && s.kind !== "delivery")
        .map(s => {
          const month = s.freq === "yearly" ? s.amount / 12 : s.amount;
          return { id: "cancel-" + s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title: `Cancel ${s.name}`,
            detail: s.kind === "apple" ? "Settings, your name, Subscriptions." : "Cancel on their website.",
            save: Math.round(month), unit: "month", kind: "food", cat: "Subscriptions", perWeek: 12 / 52, sub: true,
            basis: `$${month.toFixed(2)} a month, about $${(month * 12 / 52).toFixed(0)} a week`, real: true };
        })
        .sort((a, b) => b.save - a.save);
      // The bank sends no ride times, so the subway swap guesses daytime rides. If he told the app his
      // real count (Swaps > All swaps > subway row), use it instead of the guess.
      let daytime = null;
      try { const v = localStorage.getItem("swapDaytimeRides"); daytime = v == null ? null : +v; } catch (e) {}
      const opts = L.swapOptions.map(o => o.id !== "subway-day" || daytime == null || !(daytime >= 0) ? o : Object.assign({}, o, {
        perWeek: daytime, timesPerWeek: daytime >= 2 ? Math.floor(daytime / 2) : daytime >= 1 ? 0.5 : 0,
        everyOtherWeek: daytime >= 1 && daytime < 2, estimate: false, yours: true,
        basis: String(o.basis || "").split(". ")[0] + `. You said about ${daytime} daytime rides a week.` }));
      you.swaps = keep.filter(x => x.id === "rideapp-rides").concat(opts, keep.filter(x => x.id === "dashpass-student"), subs);
      // Keep the reasoning for the daytime subway swap (ride counts by app).
      const sub = you.swaps.find(x => x.id === "subway-day"), all = you.ridePrices.reduce((t, r) => t + (r.count || 0), 0);
      const emp = (you.ridePrices.find(r => RIDE_RE.test(r.app)) || {}).count || 0;
      if (sub && you.rideAppShare >= 0.8) {
        const name = you.rideAppName || "Lower-fare app";
        sub.why = `${name} already: ${emp} of ${all} rides`;
        sub.detail = "Daytime only. Night rides stay as they are.";
      }
    }
    you.memberships = you.memberships.map(m => m.name === "DashPass" ? Object.assign({}, m, { ordersPerWeek: L.deliveriesPerWeek }) : m);
    Object.assign(you.thisWeek, L.thisWeek, { payback: { owed: 0, perWeek: 0, weeksLeft: 0 }, paidBack: 0 });
    you.thisWeek.cap = you.usual.total - you.thisWeek.saveTarget;
  }

  // ---------------- mealplan: SAMPLE dorm student ----------------
  const mealplan = {
    id: "mealplan", label: "Meal-plan student", short: "Meal plan", source: "sample",
    blurb: "Dorm, meal plan, delivery after the hall closes, coffee every day.",
    real: [],
    facts: { hasMealPlan: true, kitchen: "micro", subwayMinutes: null, lateNights: 1, moved: true },
    thisWeek: { saveTarget: 25, payback: { owed: 0, perWeek: 0, weeksLeft: 0 } },
    // Earlier weeks; this week's row is added from the charges below.
    weekly: [
      { wk: "2026-08-03", ride: 12, delivery: 0, dining: 46, quick: 18, transit: 0 },
      { wk: "2026-08-10", ride: 0, delivery: 14, dining: 58, quick: 22, transit: 0 },
      { wk: "2026-08-17", ride: 8, delivery: 0, dining: 39, quick: 16, transit: 0 },
      { wk: "2026-08-24", ride: 46, delivery: 88, dining: 71, quick: 49, transit: 12 },
      { wk: "2026-08-31", ride: 0, delivery: 124, dining: 38, quick: 61, transit: 6 },
      { wk: "2026-09-07", ride: 15, delivery: 137, dining: 29, quick: 57, transit: 3 },
      { wk: "2026-09-14", ride: 0, delivery: 112, dining: 44, quick: 66, transit: 6 },
      { wk: "2026-09-21", ride: 0, delivery: 118, dining: 34, quick: 69, transit: 6 },
      { wk: "2026-09-28", ride: 21, delivery: 131, dining: 41, quick: 58, transit: 3 },
      { wk: "2026-10-05", ride: 0, delivery: 96, dining: 62, quick: 66, transit: 9 },
      { wk: "2026-10-12", ride: 42, delivery: 142, dining: 27, quick: 55, transit: 6 },
      { wk: "2026-10-19", ride: 17, delivery: 109, dining: 48, quick: 63, transit: 3 }
    ],
    // Moved into the dorm Aug 24. Before = summer at home (Aug 3 – 23), after = Aug 24 – Nov 1.
    move: { date: "2026-08-24", beforeLabel: "Summer at home", afterLabel: "Since move-in" },
    ridePrices: [ { app: "Lyft", median: 17.20 }, { app: "Uber", median: 19.40 } ],
    subway: { fare: 3, weeklyCap: 35 },
    priceGaps: [ { place: "Shake Shack", pickup: 15, delivered: 26 }, { place: "Domino's", pickup: 13, delivered: 24 }, { place: "Thai place", pickup: 17, delivered: 29 } ],
    memberships: [ { name: "DashPass", price: 9.99, period: "month", ordersPerWeek: 4, student: 4.99 } ],
    // Prepaid for the semester; not part of weekly spend.
    mealPlan: { name: "Dining plan", planCost: 3150, swipesPerSemester: 210, perSwipe: 15, swipesUsed: 98, swipesLeft: 112, weeksLeft: 7, guestSwipes: 4, hallHours: "7:30 am – 8 pm", hallCloses: "20:00", expires: "Dec 20" },
    charges: [
      { id: "m1", day: 0, time: "08:50", merchant: "Dunkin'", amount: 6, kind: "quick", tag: null },
      { id: "m2", day: 0, time: "21:40", merchant: "Uber Eats · Shake Shack", amount: 26, kind: "delivery", tag: "tired" },
      { id: "m3", day: 1, time: "08:45", merchant: "Campus café", amount: 7, kind: "quick", tag: null },
      { id: "m4", day: 1, time: "14:10", merchant: "MTA", amount: 3, kind: "transit", tag: null },
      { id: "m5", day: 1, time: "17:30", merchant: "MTA", amount: 3, kind: "transit", tag: null },
      { id: "m6", day: 2, time: "08:55", merchant: "Campus café", amount: 6, kind: "quick", tag: null },
      { id: "m7", day: 2, time: "22:10", merchant: "Domino's", amount: 24, kind: "delivery", tag: "late" },
      { id: "m8", day: 3, time: "09:00", merchant: "Coffee cart", amount: 5, kind: "quick", tag: null },
      { id: "m9", day: 3, time: "16:20", merchant: "Boba shop", amount: 7, kind: "quick", tag: "treat" },
      { id: "m10", day: 4, time: "08:40", merchant: "Dunkin'", amount: 6, kind: "quick", tag: null },
      { id: "m11", day: 4, time: "21:55", merchant: "Grubhub · Thai", amount: 29, kind: "delivery", tag: "tired" },
      { id: "m12", day: 5, time: "10:30", merchant: "Starbucks", amount: 7, kind: "quick", tag: "friends" },
      { id: "m13", day: 5, time: "19:30", merchant: "Ramen shop", amount: 22, kind: "dining", tag: "friends" },
      { id: "m14", day: 5, time: "23:40", merchant: "Lyft", amount: 19, kind: "ride", tag: "night" },
      { id: "m15", day: 6, time: "11:00", merchant: "Blank Street", amount: 7, kind: "quick", tag: null },
      { id: "m16", day: 6, time: "20:45", merchant: "DoorDash · Wingstop", amount: 27, kind: "delivery", tag: "late" },
      { id: "m17", day: 6, time: "16:05", merchant: "Corner deli", amount: 9, kind: "quick", tag: null }
    ],
    swaps: [
      { id: "hall-dinner", title: "Hall dinner before 8 pm", detail: "Eat at the hall on 2 nights.", save: 54, unit: "week", kind: "food", basis: "2 deliveries at ~$27 vs 2 prepaid swipes", needs: ["mealPlan"] },
      { id: "pickup-late", title: "Pick up Shake Shack", detail: "Same order, 5 min away.", save: 11, unit: "order", kind: "food", basis: "Delivered $26 vs pickup $15" },
      { id: "hall-coffee", title: "Hall coffee on 3 mornings", detail: "Coffee comes with breakfast. Keep the café for weekends.", save: 18, unit: "week", kind: "food", basis: "3 × ~$6 drinks vs breakfast swipes", needs: ["mealPlan"] },
      { id: "dashpass-student", title: "DashPass → student plan", detail: "Same perks at $4.99 once you verify student status.", save: 5, unit: "month", kind: "food", basis: "$9.99 vs $4.99 student price" },
      { id: "snack-shelf", title: "Snacks for after 8 pm", detail: "One Trader Joe's run covers a late order.", save: 15, unit: "week", kind: "food", basis: "1 delivery at ~$27 vs a ~$12 snack run" }
    ]
  };

  // ---------------- social: SAMPLE weekend social spender ----------------
  const social = {
    id: "social", label: "Weekend social", short: "Weekend", source: "sample",
    blurb: "Dinners and bars with friends, rides home late, Venmo splits.",
    real: [],
    facts: { hasMealPlan: false, kitchen: "shared", subwayMinutes: 15, lateNights: 2, moved: false },
    thisWeek: { saveTarget: 30, payback: { owed: 20, perWeek: 10, weeksLeft: 2 } },
    weekly: [
      { wk: "2026-08-24", ride: 71, delivery: 0, dining: 248, quick: 38, transit: 15 },
      { wk: "2026-08-31", ride: 88, delivery: 23, dining: 301, quick: 44, transit: 12 },
      { wk: "2026-09-07", ride: 64, delivery: 0, dining: 276, quick: 36, transit: 15 },
      { wk: "2026-09-14", ride: 95, delivery: 19, dining: 322, quick: 41, transit: 12 },
      { wk: "2026-09-21", ride: 82, delivery: 0, dining: 288, quick: 47, transit: 15 },
      { wk: "2026-09-28", ride: 104, delivery: 26, dining: 341, quick: 39, transit: 12 },
      { wk: "2026-10-05", ride: 76, delivery: 0, dining: 265, quick: 44, transit: 15 },
      { wk: "2026-10-12", ride: 118, delivery: 21, dining: 356, quick: 38, transit: 9 },
      { wk: "2026-10-19", ride: 89, delivery: 0, dining: 302, quick: 43, transit: 12 }
    ],
    // Same apartment as last year: no move. Kept so every profile has the same shape.
    move: { date: null, beforeLabel: "Last spring", afterLabel: "This fall", ridesPerWeekBefore: 3.6, ridesPerWeekAfter: 4.2, rideSpendBefore: 78, rideSpendAfter: 88 },
    ridePrices: [ { app: "Lyft", median: 18.40 }, { app: "Uber", median: 21.60 } ],
    subway: { fare: 3, weeklyCap: 35 },
    priceGaps: [ { place: "Pho spot", pickup: 14, delivered: 23 }, { place: "Taco place", pickup: 12, delivered: 21 } ],
    memberships: [ { name: "Uber One", price: 9.99, period: "month", ridesPerWeek: 4, student: 4.99 } ],
    mealPlan: null,
    // split = paid the whole bill on the card, friends sent `back` on Venmo. Totals stay at card price.
    charges: [
      { id: "s1", day: 0, time: "09:10", merchant: "Dunkin'", amount: 6, kind: "quick", tag: null },
      { id: "s2", day: 0, time: "09:30", merchant: "MTA", amount: 3, kind: "transit", tag: null },
      { id: "s3", day: 1, time: "09:25", merchant: "MTA", amount: 3, kind: "transit", tag: null },
      { id: "s4", day: 1, time: "12:40", merchant: "Sweetgreen", amount: 14, kind: "quick", tag: null },
      { id: "s5", day: 2, time: "09:20", merchant: "MTA", amount: 3, kind: "transit", tag: null },
      { id: "s6", day: 2, time: "10:05", merchant: "Chick-fil-A", amount: 8, kind: "quick", tag: null },
      { id: "s7", day: 3, time: "19:20", merchant: "Uber", amount: 18, kind: "ride", tag: "out" },
      { id: "s8", day: 3, time: "19:45", merchant: "Taco place", amount: 46, kind: "dining", tag: "friends", split: { people: 2, back: 23 } },
      { id: "s9", day: 3, time: "22:15", merchant: "MTA", amount: 3, kind: "transit", tag: null },
      { id: "s10", day: 4, time: "09:15", merchant: "Starbucks", amount: 6, kind: "quick", tag: null },
      { id: "s11", day: 4, time: "19:45", merchant: "Lyft", amount: 17, kind: "ride", tag: "out" },
      { id: "s12", day: 4, time: "20:10", merchant: "Italian place", amount: 96, kind: "dining", tag: "friends", split: { people: 4, back: 72 } },
      { id: "s13", day: 4, time: "22:30", merchant: "Bar tab", amount: 64, kind: "dining", tag: "friends" },
      { id: "s14", day: 5, time: "01:40", merchant: "Uber", amount: 26, kind: "ride", tag: "night" },
      { id: "s15", day: 5, time: "12:30", merchant: "Diner brunch", amount: 34, kind: "dining", tag: "friends" },
      { id: "s16", day: 5, time: "22:50", merchant: "Bar", amount: 52, kind: "dining", tag: "friends" },
      { id: "s17", day: 6, time: "02:05", merchant: "Lyft", amount: 31, kind: "ride", tag: "night" },
      { id: "s18", day: 6, time: "11:30", merchant: "Joe & The Juice", amount: 7, kind: "quick", tag: null },
      { id: "s19", day: 6, time: "19:15", merchant: "Uber Eats · Pho", amount: 23, kind: "delivery", tag: "tired" }
    ],
    swaps: [
      { id: "cook-friday", title: "Eat at home before Friday", detail: "Dinner at home, meet friends after.", save: 24, unit: "week", kind: "food", basis: "~$30 dinner share vs ~$6 at home", needs: ["kitchen"] },
      { id: "split-ride", title: "Split the ride to dinner", detail: "Same direction as friends. Opt in only. Rides home stay as they are.", save: 9, unit: "ride", kind: "move", basis: "$18 ride at 7:30 pm split two ways" },
      { id: "subway-dinner", title: "Subway to Thursday dinner", detail: "15 min, before 8 pm. The ride home stays as is.", save: 15, unit: "week", kind: "move", basis: "$18 ride vs a $3 fare", needs: ["subway"] },
      { id: "host-brunch", title: "Host Sunday brunch", detail: "Split groceries on Venmo instead of the bill.", save: 22, unit: "week", kind: "food", basis: "$34 brunch out vs ~$12 grocery share", needs: ["kitchen"] },
      { id: "uberone-student", title: "Uber One → student plan", detail: "Same perks at $4.99 with a student account.", save: 5, unit: "month", kind: "move", basis: "$9.99 vs $4.99 student price" }
    ]
  };

  // ---------------- derive + check ----------------
  const FOOD = ["dining", "drinks", "quick", "delivery"], MOVE = ["ride", "transit"];
  const sum = (rows, keys) => rows.reduce((s, r) => s + keys.reduce((t, k) => t + (r[k] || 0), 0), 0);
  function rowFromCharges(p) {
    const r = { wk: shared.weekStart, ride: 0, delivery: 0, dining: 0, drinks: 0, quick: 0, transit: 0 };
    p.charges.forEach(c => { r[c.kind] += c.amount; });
    return r;
  }
  function usualOf(weekly) {
    const last = weekly.slice(-6), food = Math.round(sum(last, FOOD) / last.length), move = Math.round(sum(last, MOVE) / last.length);
    return { food, move, total: food + move };
  }
  function weekOf(p) {
    const food = p.charges.filter(c => FOOD.includes(c.kind)).reduce((s, c) => s + c.amount, 0);
    const move = p.charges.filter(c => MOVE.includes(c.kind)).reduce((s, c) => s + c.amount, 0);
    return { food, move, total: food + move };
  }
  function deriveSample(p) {
    p.weekly.push(rowFromCharges(p));
    p.usual = usualOf(p.weekly);
    const t = p.thisWeek;
    Object.assign(t, weekOf(p));
    t.cap = p.usual.total - t.saveTarget - t.payback.perWeek;
    t.paidBack = p.charges.reduce((s, c) => s + (c.split ? c.split.back : 0), 0);
    const subTaps = p.weekly.slice(-6).reduce((s, r) => s + r.transit, 0) / 6 / p.subway.fare;
    p.subway.tapsPerWeek = Math.round(subTaps * 10) / 10;
    p.subway.perWeek = Math.round(subTaps * p.subway.fare);
    if (p.move.date) {   // before/after averages from this profile's own rows
      const d = p.move.date, before = p.weekly.filter(r => r.wk < d), after = p.weekly.filter(r => r.wk >= d);
      const avg = (rows, k) => Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length);
      const per = p.ridePrices[0].median;
      Object.assign(p.move, {
        rideSpendBefore: avg(before, "ride"), rideSpendAfter: avg(after, "ride"),
        ridesPerWeekBefore: Math.round(avg(before, "ride") / per * 10) / 10, ridesPerWeekAfter: Math.round(avg(after, "ride") / per * 10) / 10,
        deliverySpendBefore: avg(before, "delivery"), deliverySpendAfter: avg(after, "delivery")
      });
    }
  }
  deriveSample(mealplan);
  deriveSample(social);

  const profiles = Object.assign(you ? { you } : {}, { mealplan, social });
  Object.values(profiles).forEach(p => {
    Object.keys(shared).forEach(k => { if (p[k] === undefined) p[k] = shared[k]; });
  });

  window.SwapData = Object.assign({}, shared, { profiles, order: Object.keys(profiles), active: you ? "you" : "social" });
  // Legacy top-level fields (SwapData.charges, SwapData.usual, ...) read the active profile.
  ["label", "short", "source", "blurb", "real", "facts", "usual", "thisWeek", "weekly", "move", "ridePrices", "subway", "priceGaps", "memberships", "mealPlan", "charges", "swaps"]
    .forEach(k => Object.defineProperty(window.SwapData, k, { get() { return profiles[this.active][k]; }, enumerable: true }));
})();
