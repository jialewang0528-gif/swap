# Swap

A money coach for college students that runs on your own bank data. It shows where your money actually goes, gives you a daily number to stay on track for the week, and suggests cheaper swaps instead of blocking apps.

I built it for myself first (Michael Wang, NYU Economics) and it runs on my iPhone every day. It started as a delivery tracker and changed a few times once I looked at real data. Clone it and make it yours.

**[Early prototype](https://michaelwang.lol/swap/prototype/)** (the first idea texted you; the real app uses notifications) · [Product record](PRODUCT.md) · [Set it up](#set-it-up-on-your-own-bank) · [How the code works](#how-the-code-works)

---

## What it does

- **Where your money goes.** Every dollar out of your bank over the last 10 weeks, ranked by category, plus the places that took the most.
- **A daily plan.** Your usual week minus what you want to save, split across the days the way you actually spend (weekends get more). Spend extra on Monday and the rest of the week adjusts. Tap any day to see what you spent.
- **By day.** Every transaction, money in and out.
- **Swaps.** Cheaper options built from your own charges (subway instead of a daytime ride, pickup instead of delivery, one fewer bodega run, cancel a subscription). Pick as many as you want each week and see how close they get you to your savings goal.
- **Chat.** Ask "how much can I spend today" or "what do I spend the most on". On an iPhone with Apple Intelligence it answers on-device. Nothing leaves the phone.
- **Updates itself and tells you.** Optional: a free private cloud link pulls fresh data from your bank every time you open the app, shows when your bank was last checked, and sends a notification when new charges land (iOS checks in the background a few times a day).

Night rides count as spending but are never a swap target. Getting home safe isn't something to cut.

## The problem

Student spending on food and rides is modest on average and expensive at the margin. I kept only figures that survived a fact-check and a second-source audit.

| What it shows | Number | Caveat |
|---|---|---|
| Meals out are a steady monthly cost | $253/month on snacks and meals out, including delivery | UC undergraduates, 2025, self-reported ([UC COAS:25](https://www.ucop.edu/institutional-research-academic-planning/services/survey-services/2025-coas-report1.pdf)) |
| A meal plan does not stop it | $235/month on campus vs $261 off campus | Same survey, no significance tests |
| Delivery is a premium | The same chain meal costs about 70-90% more delivered, about $9 more per order | Two small price audits ([LendingTree 2025](https://www.lendingtree.com/credit-cards/study/delivery-pickup/), [FinanceBuzz 2026](https://financebuzz.com/compare-costs-food-delivery-apps)) |
| Delivery is a weekly habit | 2 in 5 to 1 in 2 Gen Z adults order every week | Opt-in polls, Gen Z rather than students ([YouGov 2025](https://yougov.com/en-us/articles/51282-exploring-americas-appetite-for-food-delivery-apps), [LendingTree 2025](https://www.lendingtree.com/credit-cards/study/delivery-pickup/)) |
| Most students have no meal plan to fall back on | About 1 in 6 undergraduates live on campus | NCES 2019-20, a COVID-affected year ([Table 331.10](https://nces.ed.gov/programs/digest/d22/tables/dt22_331.10.asp)) |
| Money is tight at the same time | About 1 in 5 undergraduates were food insecure | Federal data, 2019-20 ([GAO-24-107074](https://www.gao.gov/products/gao-24-107074)) |
| Students do not see the total | About a quarter understand their full cost of attendance well enough to budget | Nonprobability panel ([Inside Higher Ed, 2025](https://www.insidehighered.com/news/student-success/academic-life/2025/10/07/students-struggle-surprise-costs-dont-know-about-help)) |

## Research

**User #1 was me.** I linked my own card through Plaid and pulled 13 months of transactions (1,945 of them, reconciled to the dollar). I expected delivery to be the problem. It was about 3% of my fall spending. After I moved somewhere with no kitchen and a slow subway trip, my everyday rides went from $13 a week to around $200 a week, about 12 rides a week at roughly $15 each. No single ride felt expensive. That is n=1, so it shaped questions, not conclusions.

**Conducted research.** Instead of a live test, I studied what students say online about food, rides and budgeting apps, plus the survey data above. A fact-checker re-opened 52 sources and every number got a second source.

**Findings:**

- **Spending happens at predictable moments:** after long days, after dining halls close, when running late, late at night, when friends pick the plan, and after a housing change.
- **Students find the total weeks later,** by scrolling their bank app on purpose. Year-in-review features tend to frame it as "saved."
- **Willpower fixes fail within days.** Deleting the app, a monthly budget and meal prep get undone. What sticks is a ready, likable alternative at the trigger moment, like pickup instead of delivery.
- **People quit budgeting apps** over price, surprise charges, broken bank sync and logging chores. They ask for one weekly number, a few buckets and no guilt.
- **Bank categories break.** Budgeting apps can't reliably split Uber rides from Uber Eats, and Plaid files at least one ride app's charges as cash-advance payments.

**Four situations, not demographics:** the far-from-campus rider, the meal-plan payer who still orders, the end-of-day orderer with no kitchen or no energy, and the social spender who rides home late.

## Product decisions

| Decision | Why |
|---|---|
| All your money, analysis first | Food and rides were only part of the story. Seeing everything ranked comes before any advice |
| Compare to your own usual, never to other people | Peer comparison and shaming split users; your own baseline is the honest benchmark |
| A daily number that adapts | A weekly budget is easy to blow on Saturday. A daily plan that rebalances is something you can act on today |
| Suggest swaps, never block apps | Blockers get bypassed or tuned out within about two weeks; a pause with an easy way out worked better than more friction ([one sec, PNAS 2023](https://www.pnas.org/doi/10.1073/pnas.2213114120)) |
| Swaps from your own charges, with the math shown | "Your median ride $15 vs a $3 fare" beats a generic tip |
| Night rides counted but never a swap target | Safety at night is a protected reason students give for riding |
| Honest unknowns over guesses | A wrong category is worse than an honest unknown |
| No lower-fare ride app suggestions by default | Some are unlicensed in some cities. You can turn it on for yourself in `.env` |

## What I changed my mind about

1. **Delivery to everything.** My own ledger showed delivery was about 3% of my spending. Then food and rides turned out to be only part of it, so the app now covers every dollar.
2. **Live pilot to desk research.** I couldn't run a test with other students, so research replaced discovery interviews. That covers discovery. It does **not** show that a daily number changes behavior; that needs a real test.
3. **Cheaper ride app.** I already take the cheapest one for almost every ride, so suggesting it saved nothing. The real swap was the subway, daytime only.

---

## Set it up on your own bank

Takes about 15 minutes. You need a Mac with Python 3. For the iPhone app you also need Xcode (a free Apple ID is fine).

**1. Get Plaid keys.** Make a free account at [dashboard.plaid.com](https://dashboard.plaid.com), then grab your client ID and secret.

```bash
cp .env.example .env
```

Paste the keys into `.env`. Leave `PLAID_ENV=sandbox` for now.

**2. Try it with a fake bank.**

```bash
python3 pull.py sandbox --person test
python3 -m unittest test_pull
```

**3. Connect your real card.** Set `PLAID_ENV=production` in `.env` (and the production secret), then:

```bash
python3 pull.py link --person p00
python3 sync.py
```

`sync.py` writes `app/private/live.js`, your data for the app. It's gitignored, so it never ends up on GitHub. Heads up: Plaid's free Trial plan allows 10 bank links total, ever, so don't re-link for fun.

**4. Look at it in a browser.**

```bash
python3 -m http.server 8744 --bind 127.0.0.1 -d app
```

Open [localhost:8744](http://localhost:8744). "You" is your data; the other two profiles are sample students.

**5. Put it on your iPhone (optional).** Open `ios/Swap.xcodeproj` in Xcode, pick your team under Signing, change the bundle ID to something like `com.yourname.swap`, plug in your phone and hit Run. First time, your phone asks you to trust the developer (Settings → General → VPN & Device Management).

To skip Xcode after that, put your phone's ID and team in `.env` (`SWAP_DEVICE`, `SWAP_TEAM`, `SWAP_BUNDLE_ID`), then:

```bash
zsh scripts/morning.sh
zsh scripts/install-morning.sh
```

The second command runs the first every morning at 7:30. With a free Apple ID the app expires after 7 days, and this reinstall keeps it alive whenever your phone is plugged in.

**6. Updates without plugging in (optional).** This sets up a private link on your own free Vercel account, so the app gets fresh bank data every time you open it:

```bash
npm i -g vercel && vercel login
python3 cloud/setup.py
zsh cloud/deploy.sh
```

Your Plaid keys go into that Vercel project's settings (never into code), and only your phone has the key to ask for your data. Rebuild the app once afterwards (step 5).

**7. Your subscriptions (optional).** Copy `app/private/subscriptions.example.js` to `app/private/subscriptions.js` and list yours. They show up in Wallet, and as "Cancel X" swaps.

**Other `.env` options:** `HIDE_MERCHANTS` hides merchants you never want to see (comma-separated). `SUPPORT_SENDERS` marks family Zelle senders as support, not friends paying you back. `RIDE_APP_NAME` and `RECOMMEND_RIDE_APP=1` name a lower-fare ride app and let Swap suggest it.

## How the code works

| Path | What it does |
|---|---|
| `pull.py` | Links a card through Plaid (in person or a Plaid-hosted link), pulls ~400 days of history, sorts food and getting-around charges. |
| `ledger.py` | Every-dollar ledger: card payments, transfers, refunds, Zelle with friends and buy-now-pay-later all reconciled so nothing counts twice. |
| `sync.py` | Builds everything the app shows: last week, this week, the daily plan's shape, the 10-week analysis, swaps from your charges, your whole bank. |
| `test_pull.py` | Offline tests (no keys needed): categories, Uber vs Uber Eats, transfers that look like rides, pending ride holds, history loading. |
| `app/` | The app (plain HTML/CSS/JS, no build step). `core.js` is the shell; each screen is a file in `app/features/`. `app/DESIGN.md` has the rules. |
| `ios/` | A small SwiftUI app that wraps `app/`, plus notifications and the on-device chat model. |
| `cloud/` | The optional private cloud link (one Python function on Vercel). |
| `scripts/` | The morning sync-and-reinstall job. |
| `prototype/` | The original single-file clickable prototype. |

**Lessons from real data that the tests now cover:** Plaid says history is done loading before the older transactions arrive (my first pull missed 12 months). A Zelle payment to someone named "Uber" looked like a ride. Credit card payments and buy-now-pay-later had to be netted out or spending gets counted twice. Pending ride charges show a different name than posted ones, and a pending liquor store charge gets filed as general shopping.

## Status

Running daily on my own iPhone with my real bank (Nov 2026). Not tested with other students yet. Next: a small behavior test of the daily plan, since that's the thing desk research can't answer.

MIT licensed. Take it, change it, make it yours.
