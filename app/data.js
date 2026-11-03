/* Swap prototype data: three profiles that share one shape.
   - you      = the founder's profile. Sample values (real numbers removed from history). This week's
                charges and the swaps are a SAMPLE week built on the real numbers; see `real`.
   - mealplan = SAMPLE dorm student on a meal plan. Illustrative; chain names are examples.
   - social   = SAMPLE weekend social spender. Illustrative; chain names are examples.

   Every profile has the same fields, so features read api.data the same way for all three:
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
   they can't drift. For `you`, the real numbers are written out and checked (console warning on drift).
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

  // ---------------- you: founder profile (sample values) ----------------
  const you = {
    id: "you", label: "You", short: "You", source: "real",
    blurb: "Sample values.",
    // Fields that are REAL. Everything else in this profile is SAMPLE and must be labeled.
    real: ["usual", "weekly", "move", "ridePrices", "priceGaps", "memberships", "subway"],
    // SAMPLE defaults until the student answers Move-in (store "moveProfile" overrides these).
    facts: { hasMealPlan: false, kitchen: "none", subwayMinutes: 30, lateNights: 2, moved: true },

    // Usual week (sample values).
    // Airport rides over $60 are excluded everywhere.
    // Food counts card charges at full price; friends' paybacks are not netted here.
    usual: { food: 300, move: 90, total: 390 },

    // SAMPLE: this week with Swap.
    thisWeek: { food: 366, move: 148, total: 514, cap: 520, saveTarget: 100, payback: { owed: 20, perWeek: 10, weeksLeft: 2 }, paidBack: 0 },

    // Weekly totals (USD) by kind, Mon-start weeks (sample values).
    weekly: [{"wk":"2026-08-24","ride":71,"delivery":0,"dining":248,"quick":38,"transit":15},{"wk":"2026-08-31","ride":88,"delivery":23,"dining":301,"quick":44,"transit":12},{"wk":"2026-09-07","ride":64,"delivery":0,"dining":276,"quick":36,"transit":15},{"wk":"2026-09-14","ride":95,"delivery":19,"dining":322,"quick":41,"transit":12},{"wk":"2026-09-21","ride":82,"delivery":0,"dining":288,"quick":47,"transit":15},{"wk":"2026-09-28","ride":104,"delivery":26,"dining":341,"quick":39,"transit":12},{"wk":"2026-10-05","ride":76,"delivery":0,"dining":265,"quick":44,"transit":15},{"wk":"2026-10-12","ride":118,"delivery":21,"dining":356,"quick":38,"transit":9},{"wk":"2026-10-19","ride":89,"delivery":0,"dining":302,"quick":43,"transit":12}],

    // Move (sample values).
    // "Before" and "After" exclude airport rides.
    move: { date: "2026-08-24", beforeLabel: "Last fall", afterLabel: "Since the move", ridesPerWeekBefore: 1, ridesPerWeekAfter: 5, rideSpendBefore: 15, rideSpendAfter: 75 },

    // Median ride price by app (sample values). The lower-fare app is never suggested on public profiles.
    ridePrices: [ { app: "Lower-fare app", median: 15.00 }, { app: "Lyft", median: 17.20 }, { app: "Uber", median: 19.40 } ],
    subway: { fare: 3, weeklyCap: 35, tapsPerWeek: 3, perWeek: 9 },

    // Same chain, in person vs delivered (sample values).
    priceGaps: [ { place: "Shake Shack", pickup: 15, delivered: 26 }, { place: "Domino's", pickup: 13, delivered: 24 }, { place: "Thai place", pickup: 17, delivered: 29 } ],

    // DashPass (sample values).
    memberships: [ { name: "DashPass", price: 9.99, period: "month", ordersPerWeek: 1, student: 4.99 } ],
    mealPlan: null,

    // SAMPLE: this week's charges. time = "HH:MM" or null when the bank sent no time.
    // day 0 = Monday ... 6 = Sunday. Ids are stable (saved tags are keyed by id).
    charges: [
      { id: "c1", day: 0, time: "08:42", merchant: "Lower-fare app", amount: 14, kind: "ride", tag: "class" },
      { id: "c2", day: 0, time: null, merchant: "Cava", amount: 16, kind: "dining", tag: "planned" },
      { id: "c3", day: 0, time: null, merchant: "Blank Street", amount: 7, kind: "quick", tag: null },
      { id: "c4", day: 1, time: "09:05", merchant: "Lower-fare app", amount: 15, kind: "ride", tag: "late" },
      { id: "c5", day: 1, time: null, merchant: "Cava", amount: 16, kind: "dining", tag: "planned" },
      { id: "c6", day: 1, time: null, merchant: "MTA", amount: 3, kind: "transit", tag: null },
      { id: "c7", day: 2, time: null, merchant: "MTA", amount: 3, kind: "transit", tag: null },
      { id: "c8", day: 2, time: "23:48", merchant: "Lyft", amount: 22, kind: "ride", tag: "night" },
      { id: "c9", day: 2, time: null, merchant: "DoorDash · Thai", amount: 34, kind: "delivery", tag: "tired" },
      { id: "c10", day: 3, time: "08:51", merchant: "Lower-fare app", amount: 16, kind: "ride", tag: "class" },
      { id: "c11", day: 3, time: null, merchant: "Joe & The Juice", amount: 12, kind: "quick", tag: null },
      { id: "c12", day: 4, time: null, merchant: "Thai restaurant", amount: 58, kind: "dining", tag: "friends" },
      { id: "c13", day: 4, time: "20:10", merchant: "Uber", amount: 18, kind: "ride", tag: "out" },
      { id: "c14", day: 5, time: null, merchant: "Bar tab", amount: 84, kind: "dining", tag: "friends" },
      { id: "c15", day: 5, time: "01:12", merchant: "Lower-fare app", amount: 21, kind: "ride", tag: "night" },
      { id: "c16", day: 5, time: null, merchant: "Coffee shop", amount: 9, kind: "quick", tag: "treat" },
      { id: "c17", day: 6, time: null, merchant: "Hot pot", amount: 46, kind: "dining", tag: "friends" },
      { id: "c18", day: 6, time: null, merchant: "Sushi place", amount: 31, kind: "dining", tag: "planned" },
      { id: "c19", day: 6, time: "13:30", merchant: "Lower-fare app", amount: 8, kind: "ride", tag: "errand" },
      { id: "c20", day: 6, time: null, merchant: "MTA", amount: 3, kind: "transit", tag: null },
      { id: "c21", day: 1, time: null, merchant: "Shake Shack", amount: 22, kind: "dining", tag: "tired" },
      { id: "c22", day: 3, time: null, merchant: "Sweetgreen", amount: 18, kind: "dining", tag: null },
      { id: "c23", day: 4, time: null, merchant: "Starbucks", amount: 8, kind: "quick", tag: null },
      { id: "c24", day: 4, time: "08:40", merchant: "Lower-fare app", amount: 15, kind: "ride", tag: "class" },
      { id: "c25", day: 2, time: null, merchant: "Lower-fare app", amount: 10, kind: "ride", tag: null }
    ],

    // SAMPLE swaps.
    // needs: facts that must hold (see api.swaps()): "mealPlan", "noMealPlan", "kitchen", "noKitchen", "subway".
    swaps: [
      { id: "subway-am", title: "Subway Tue + Thu mornings", detail: "Leave 15 min earlier on class days.", save: 24, unit: "week", kind: "move", basis: "2 rides at ~$15 → 2 fares at $3", needs: ["subway"] },
      { id: "pickup-chipotle", title: "Pick up Shake Shack", detail: "Same order, you walk 6 min.", save: 11, unit: "order", kind: "food", basis: "Delivered $26 vs pickup $15" },
      { id: "swipe-lunch", title: "Friend's dining hall swipe", detail: "Lunch on the 2 days you're near campus.", save: 18, unit: "meal", kind: "food", basis: "Sit-down lunch ~$18 vs a guest swipe", needs: ["noMealPlan"] },
      { id: "split-ride", title: "Split the ride to dinner", detail: "Same direction as friends. Opt in only. Night rides home stay as they are.", save: 9, unit: "ride", kind: "move", basis: "$18 ride at 8 pm split two ways" },
      { id: "dashpass-student", title: "DashPass → student plan", detail: "Same perks at $4.99 once you verify student status.", save: 5, unit: "month", kind: "food", basis: "$9.99 vs $4.99 student price" },
      { id: "coffee-home", title: "Make coffee 3 mornings", detail: "Cold brew from the fridge. Keep the coffee shop for Fridays.", save: 18, unit: "week", kind: "food", basis: "3 × ~$7 drinks vs ~$1 each" }
    ]
  };

  // ---------------- you: live data from sync.py (private/live.js), when present ----------------
  // On the founder's phone build, every number in "You" is real: last full week, charges, history.
  const L = window.SwapLive;
  // "2026-11-03T00:47" -> "Nov 3, 12:47 AM" (no raw ISO timestamps on screen).
  const synced = iso => {
    const [d, t = "00:00"] = String(iso).split("T"), [y, m, day] = d.split("-").map(Number), [h, min] = t.split(":").map(Number);
    const mon = new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${mon}, ${h % 12 || 12}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  if (L) {
    Object.assign(you, {
      label: "You", blurb: "Your card, synced " + synced(L.generatedAt), syncedAt: L.generatedAt,
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
    // The founder's own build: show the lower-fare app by name, and (his choice) recommend it over Uber/Lyft.
    you.recommendRideApp = !!L.recommendRideApp;
    if (you.recommendRideApp) {
      const med = re => (you.ridePrices.find(r => re.test(r.app)) || {}).median;
      const count = re => (you.ridePrices.find(r => re.test(r.app)) || {}).count || 0;
      const cheap = med(/lower-fare|rideapp/i), dear = med(/uber/i) || med(/lyft/i);
      const name = you.rideAppName || "Lower-fare app";
      // Share of rides already on the lower-fare app. Suggesting it only makes sense if Uber/Lyft is still common.
      const all = you.ridePrices.reduce((t, r) => t + (r.count || 0), 0);
      you.rideAppShare = all ? count(/lower-fare|rideapp/i) / all : 0;
      you.swaps = you.swaps.filter(x => x.id !== "rideapp-rides");
      if (cheap && dear && dear > cheap && you.rideAppShare < 0.8) {
        you.swaps = [{ id: "rideapp-rides", title: `${name} instead of Uber or Lyft`, detail: "Same trip, lower fare.",
          save: Math.round(dear - cheap), unit: "ride", kind: "move", basis: `Your Uber median vs ${name} median`, rideApp: true }]
          .concat(you.swaps);
      } else if (cheap) {
        // Already on the cheapest app: the next step down is the subway, daytime only.
        const since = new Date(L.move.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const n = count(/lower-fare|rideapp/i);
        you.swaps = [{ id: "subway-day", title: "Subway for daytime rides",
          detail: `You already take ${name} for ${n} of ${all} rides since ${since}, so switching apps saves nothing. The next step down is the subway, daytime only. Night rides stay as they are.`,
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
      you.swaps = keep.filter(x => x.id === "rideapp-rides").concat(L.swapOptions, keep.filter(x => x.id === "dashpass-student"), subs);
      // Keep the reasoning for the ride swap: he already rides the cheapest app.
      const sub = you.swaps.find(x => x.id === "subway-day"), all = you.ridePrices.reduce((t, r) => t + (r.count || 0), 0);
      const emp = (you.ridePrices.find(r => /lower-fare|rideapp/i.test(r.app)) || {}).count || 0;
      if (sub && you.rideAppShare >= 0.8) {
        const name = you.rideAppName || "Lower-fare app";
        sub.why = `${name} already: ${emp} of ${all} rides`;
        sub.detail = `You already take ${name} for ${emp} of ${all} rides, so switching apps saves nothing. Daytime only. Night rides stay as they are.`;
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

  // Real profile: check the written numbers instead of overwriting them (skipped when live data is loaded).
  if (!you.live) (function check(p) {
    const u = usualOf(p.weekly), w = weekOf(p), t = p.thisWeek;
    const bad = [];
    if (u.food !== p.usual.food || u.move !== p.usual.move || u.total !== p.usual.total) bad.push("usual " + JSON.stringify(u));
    if (w.food !== t.food || w.move !== t.move || w.total !== t.total) bad.push("thisWeek " + JSON.stringify(w));
    if (t.cap !== p.usual.total - t.saveTarget - t.payback.perWeek) bad.push("cap");
    if (bad.length) console.warn("[swap] data drift in profile 'you':", bad.join("; "));
  })(you);

  const profiles = { you, mealplan, social };
  Object.values(profiles).forEach(p => {
    Object.keys(shared).forEach(k => { if (p[k] === undefined) p[k] = shared[k]; });
  });

  window.SwapData = Object.assign({}, shared, { profiles, order: ["you", "mealplan", "social"], active: "you" });
  // Legacy top-level fields (SwapData.charges, SwapData.usual, ...) read the active profile.
  ["label", "short", "source", "blurb", "real", "facts", "usual", "thisWeek", "weekly", "move", "ridePrices", "subway", "priceGaps", "memberships", "mealPlan", "charges", "swaps"]
    .forEach(k => Object.defineProperty(window.SwapData, k, { get() { return profiles[this.active][k]; }, enumerable: true }));
})();
