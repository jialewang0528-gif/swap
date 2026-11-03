# Swap

Swap shows you where your money actually goes, gives you one number to spend today, and suggests cheaper swaps. It never blocks apps.

I go to NYU and found myself spending wayyy too much money, so I wanted to get to the root of it and figure out how to stop.

[Early prototype](https://michaelwang.lol/swap/prototype/) · [Product notes](PRODUCT.md) · [Set it up](#set-it-up) · [How the code works](#how-the-code-works)

---

## What it does

- **Where your money goes.** Your last 10 weeks of spending, ranked by category. Tap any category to see the charges.
- **Today's number.** Take your usual week, subtract what you want to save, and split it across the days the way you actually spend. Weekends get more. Overspend on Monday and the rest of the week adjusts.
- **Every charge, every day.** Money in and money out. Tap a day to see it.
- **Swaps.** Cheaper options based on your own charges, like the subway instead of a daytime ride or pickup instead of delivery. Pick a few each week and see how close they get you to your goal.
- **It asks when it's not sure.** If the bank files something vaguely ("Services"), Swap asks what it was. You can also tap any charge and change its category.
- **Chat.** Ask "how much can I spend today?" On an iPhone with Apple Intelligence, it runs on the phone. Nothing gets sent anywhere.
- **Stays up to date.** Tap **Check bank** and Swap asks your bank for new charges right now. It also checks on its own and sends a notification when something new shows up.

One rule: night rides count as spending, but Swap never tells you to skip them. Getting home safe isn't a place to save money.

## Why I made it

Food and rides don't look expensive one at a time. They add up. Here are numbers I double-checked against a second source:

| What | Number | Source |
|---|---|---|
| Students spend steadily on food out | About $253 a month on snacks and meals, delivery included | UC students, 2025 survey ([UC COAS](https://www.ucop.edu/institutional-research-academic-planning/services/survey-services/2025-coas-report1.pdf)) |
| A meal plan doesn't stop it | $235 a month on campus vs $261 off campus | Same survey |
| Delivery costs more | The same meal costs about 70 to 90% more delivered, around $9 an order | Price checks ([LendingTree](https://www.lendingtree.com/credit-cards/study/delivery-pickup/), [FinanceBuzz](https://financebuzz.com/compare-costs-food-delivery-apps)) |
| Delivery is a weekly habit | 2 in 5 to 1 in 2 Gen Z adults order every week | Polls ([YouGov](https://yougov.com/en-us/articles/51282-exploring-americas-appetite-for-food-delivery-apps), [LendingTree](https://www.lendingtree.com/credit-cards/study/delivery-pickup/)) |
| Most students cook for themselves, or don't | Only about 1 in 6 undergrads live on campus | Federal data, 2019-20 ([NCES](https://nces.ed.gov/programs/digest/d22/tables/dt22_331.10.asp)) |
| Money is tight | About 1 in 5 undergrads were food insecure | Federal data, 2019-20 ([GAO](https://www.gao.gov/products/gao-24-107074)) |
| People don't see the total | Only about a quarter of students know their full cost well enough to budget | Survey ([Inside Higher Ed](https://www.insidehighered.com/news/student-success/academic-life/2025/10/07/students-struggle-surprise-costs-dont-know-about-help)) |

## Research

**I started with myself.** I connected my own card and pulled 13 months of transactions. I thought delivery was my problem. It was about 3% of my spending. The real thing: after I moved somewhere with no kitchen and a slow subway, my rides went from $13 a week to about $200 a week. Roughly 12 rides at $15 each. None of them felt expensive. That's just me, so it gave me questions, not answers.

**Conducted research.** I couldn't run a test with other students, so I read what students say online about food, rides and budgeting apps, plus the survey data above. Every number got checked against a second source.

**Findings:**

- **Spending happens at the same moments.** After long days, after the dining hall closes, when you're running late, late at night, when friends pick the plan, and after a move.
- **People find out weeks later,** when they scroll through their bank app.
- **Willpower fixes don't last.** Deleting apps, monthly budgets and meal prep usually fall apart within days. What works is an easy alternative right when you're about to spend, like pickup instead of delivery.
- **People quit budgeting apps** because of price, surprise charges, broken bank sync and having to log everything. They want one number, a few categories and no guilt.
- **Bank categories are messy.** Apps can't always tell an Uber ride from Uber Eats, and some ride apps show up as loan payments.

## How I decided things

| Decision | Why |
|---|---|
| Show all your money first | Food and rides were only part of the story. You need the full picture before any advice. |
| Compare you to you | Comparing to other people makes people feel bad and quit. Your own usual week is the fair benchmark. |
| A daily number that adjusts | A weekly budget is easy to blow on Saturday. A daily number is something you can use today. |
| Suggest, don't block | App blockers get turned off within a couple of weeks. A gentle nudge works better ([PNAS, 2023](https://www.pnas.org/doi/10.1073/pnas.2213114120)). |
| Show the math | "Your usual ride is $15, the subway is $3" beats a generic tip. |
| Ask instead of guess | A wrong category is worse than asking. |
| No cheap ride app suggestions by default | Some aren't licensed everywhere. You can turn it on for yourself in `.env`. |

## What I changed my mind about

1. **It's not about delivery.** Delivery was 3% of my spending. So the app covers every dollar now.
2. **Research instead of a pilot.** Reading what students say covers the "what's the problem" part. It doesn't prove a daily number changes what people spend. That still needs a real test.
3. **Cheaper ride app.** I already use the cheapest one, so suggesting it saved nothing. The real swap was the subway, during the day.

---

## Set it up

About 15 minutes. You need a Mac with Python 3. For the iPhone app you also need Xcode (a free Apple ID works).

**1. Get Plaid keys.** Make a free account at [dashboard.plaid.com](https://dashboard.plaid.com) and copy your client ID and secret.

```bash
cp .env.example .env
```

Paste the keys into `.env`. Keep `PLAID_ENV=sandbox` for now.

**2. Try it with a fake bank.**

```bash
python3 pull.py sandbox --person test
python3 -m unittest test_pull
```

**3. Connect your real card.** In `.env`, set `PLAID_ENV=production` and use your production secret. Then:

```bash
python3 pull.py link --person p00
python3 sync.py
```

This saves your data to `app/private/live.js`, which never goes to GitHub. Heads up: Plaid's free plan gives you 10 bank connections total, ever, so don't reconnect for fun.

**4. Open it in a browser.**

```bash
python3 -m http.server 8744 --bind 127.0.0.1 -d app
```

Go to [localhost:8744](http://localhost:8744). "You" is your data. The other two are sample students.

**5. Put it on your iPhone (optional).** Open `ios/Swap.xcodeproj` in Xcode. Pick your team under Signing, change the bundle ID to something like `com.yourname.swap`, plug in your phone and hit Run. The first time, your phone asks you to trust the developer (Settings → General → VPN & Device Management).

After that you can skip Xcode. Add your phone's ID and team to `.env` (`SWAP_DEVICE`, `SWAP_TEAM`, `SWAP_BUNDLE_ID`), then run:

```bash
zsh scripts/morning.sh
```

```bash
zsh scripts/install-morning.sh
```

The second one sets it to run every day at 7:30 AM and 11 PM. With a free Apple ID the app stops working after 7 days, and these runs reinstall it whenever your phone is plugged in or on the same Wi-Fi. Swap warns you a couple of days before it expires.

**6. Updates without plugging in (optional).** This sets up a free private link on your own Vercel account, so the app gets fresh data whenever you open it:

```bash
npm i -g vercel && vercel login
```

```bash
python3 cloud/setup.py
```

```bash
zsh cloud/deploy.sh
```

Your bank keys live in your Vercel settings, never in the code, and only your phone can ask for your data. Rebuild the app once after this (step 5).

**7. Your subscriptions (optional).** Copy `app/private/subscriptions.example.js` to `app/private/subscriptions.js` and list yours. They show up in Wallet.

**More `.env` options:**

- `HIDE_MERCHANTS`: merchants you never want to see.
- `SUPPORT_SENDERS`: family members who send you money, so it doesn't look like friends paying you back.
- `CATEGORY_OVERRIDES`: fix categories for good (you can also do this in the app).
- `RIDE_APP_NAME` and `RECOMMEND_RIDE_APP=1`: name a cheaper ride app and let Swap suggest it.

## How the code works

| Path | What it does |
|---|---|
| `pull.py` | Connects a card through Plaid and sorts charges into categories. |
| `ledger.py` | Lines up every dollar so card payments, transfers and refunds don't count twice. |
| `sync.py` | Builds everything the app shows: this week, last week, your usual week, the swaps. |
| `test_pull.py` | Tests that run without any keys. |
| `app/` | The app itself. Plain HTML, CSS and JavaScript, no build step. Each screen is a file in `app/features/`. |
| `ios/` | A small SwiftUI app around `app/`, plus notifications and the on-device chat. |
| `cloud/` | The optional private link (one function on Vercel). |
| `scripts/` | The daily sync-and-reinstall job. |
| `prototype/` | The very first clickable prototype. |

**Things real data taught me (the tests check all of these):** Plaid says it's done loading before your older history actually arrives. A Zelle to a friend named "Uber" looked like a ride. Card payments get counted twice unless you net them out. A pending ride shows a different name than the final charge. And a liquor store can show up as "shopping."

## Status

I use it every day with my real bank (Nov 2026). It hasn't been tested with other students yet. Next up: a small test of whether the daily number actually changes how much people spend.

MIT licensed. Take it and make it yours.
