/* Copy to founder.js (same folder, gitignored) to give your own "You" profile base numbers that the
   bank sync doesn't produce. Any field here overrides the defaults in data.js; private/live.js is laid
   on top. "You" only appears when live data is loaded. Example values, not anyone's real data. */
window.SwapFounder = {
  facts: { hasMealPlan: false, kitchen: "shared", subwayMinutes: 20, lateNights: 1, moved: true },
  thisWeek: { saveTarget: 50, payback: { owed: 0, perWeek: 0, weeksLeft: 0 }, paidBack: 0 },
  // The move you want compared (rideSpendAfter comes from live.js).
  move: { date: "2026-08-25", beforeLabel: "Last spring", afterLabel: "Since the move", ridesPerWeekBefore: 1, ridesPerWeekAfter: 4, rideSpendBefore: 15, rideSpendAfter: 60 },
  memberships: [ { name: "DashPass", price: 9.99, period: "month", ordersPerWeek: 1, student: 4.99 } ],
  swaps: [
    { id: "dashpass-student", title: "DashPass → student plan", detail: "Same perks at $4.99 once you verify student status.", save: 5, unit: "month", kind: "food", basis: "$9.99 vs $4.99 student price" }
  ]
};
