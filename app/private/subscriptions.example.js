/* Copy to subscriptions.js (same folder, gitignored) and list your own subscriptions.
   The Wallet tab shows them; the Swaps tab offers "Cancel X" for each active one.
   kind: "apple" if it bills through the App Store, else anything ("software", "streaming", ...). */
window.SwapPrivate = {
  subscriptions: [
    { name: "Spotify Student", brand: null, amount: 5.99, freq: "monthly", since: "2026-01", active: true, kind: "streaming" },
    { name: "iCloud+ 50 GB", brand: "apple", amount: 0.99, freq: "monthly", since: "2025-09", active: true, kind: "apple" },
    { name: "Gym", brand: null, amount: 120, freq: "yearly", since: "2026-02", active: true, kind: "health" }
  ]
};
