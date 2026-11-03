# Swap

A weekly coach that helps college students spend less on food and getting around. It shows a student's real weekly number next to their own usual, suggests one cheaper swap that fits their week, and never blocks apps.

This is a product case study by Michael Wang (NYU, Economics). It started as a delivery tracker and changed twice once I looked at real data.

**[Clickable prototype](prototype/index.html)** · [Product record](PRODUCT.md) · [Code](#how-the-code-works)

---

## The problem

Student spending on food and rides is modest on average and expensive at the margin. Every number below comes with a caveat. I kept only figures that survived a fact-check and a second-source audit.

| What it shows | Number | Caveat |
|---|---|---|
| Meals out are a steady monthly cost | $253/month on snacks and meals out, including delivery | UC undergraduates, 2025, self-reported ([UC COAS:25](https://www.ucop.edu/institutional-research-academic-planning/services/survey-services/2025-coas-report1.pdf)) |
| A meal plan does not stop it | $235/month on campus vs $261 off campus | Same survey, no significance tests |
| Delivery is a premium | The same chain meal costs about 70-90% more delivered, about $9 more per order | Two small price audits ([LendingTree 2025](https://www.lendingtree.com/credit-cards/study/delivery-pickup/), [FinanceBuzz 2026](https://financebuzz.com/compare-costs-food-delivery-apps)) |
| Delivery is a weekly habit | 2 in 5 to 1 in 2 Gen Z adults order every week | Opt-in polls, Gen Z rather than students ([YouGov 2025](https://yougov.com/en-us/articles/51282-exploring-americas-appetite-for-food-delivery-apps), [LendingTree 2025](https://www.lendingtree.com/credit-cards/study/delivery-pickup/)) |
| Most students have no meal plan to fall back on | About 1 in 6 undergraduates live on campus | NCES 2019-20, a COVID-affected year ([Table 331.10](https://nces.ed.gov/programs/digest/d22/tables/dt22_331.10.asp)) |
| Money is tight at the same time | About 1 in 5 undergraduates were food insecure | Federal data, 2019-20 ([GAO-24-107074](https://www.gao.gov/products/gao-24-107074)) |
| Students do not see the total | About a quarter understand their full cost of attendance well enough to budget | Nonprobability panel ([Inside Higher Ed, 2025](https://www.insidehighered.com/news/student-success/academic-life/2025/10/07/students-struggle-surprise-costs-dont-know-about-help)) |

## What I found

**User #1 was me.** I linked my own card through Plaid and pulled 13 months of transactions (1,945 of them, reconciled to the dollar). I expected delivery to be the problem. It was about 3% of my fall spending. After I moved somewhere with no kitchen and a slow subway trip, my everyday rides went from $13 a week to $193 a week, around 11 rides a week at about $15 each. No single ride felt expensive. Food and getting around together were about half of everything I spent. That is n=1, so it shaped questions, not conclusions.

**Then I read what students say online** instead of running a live test. Four research passes (food, rides, budgeting apps, survey data) were checked by a fact-checker who re-opened 52 sources and by a data audit that looked for a second source behind every number. What came out:

- **Spending happens at predictable moments:** after long days, after dining halls close, when running late, when free campus rides have unpredictable waits, late at night, when friends pick the plan, and after a housing change.
- **Students find the total weeks later,** by scrolling their bank app on purpose. Year-in-review features tend to frame it as "saved."
- **Willpower fixes fail within days.** Deleting the app, a monthly budget and meal prep get undone. What sticks is a ready, likable alternative at the trigger moment, like pickup instead of delivery or a frozen version of the usual order.
- **People quit budgeting apps** over price, surprise charges, broken bank sync and logging chores. They ask for one weekly number, a few buckets and no guilt.
- **Bank categories break.** Budgeting apps can't reliably split Uber rides from Uber Eats, and Plaid files at least one ride app's charges as cash-advance payments.

**Four situations, not demographics:** the far-from-campus rider, the meal-plan payer who still orders, the end-of-day orderer with no kitchen or no energy, and the social spender who rides home late.

## The product

| Decision | Why |
|---|---|
| Food **and** getting around, not just delivery | My own data and the research both showed delivery is a small slice |
| Compare to the student's own usual, never to other people | Peer comparison and shaming split users; the student's own baseline is the honest benchmark |
| One Sunday recap with one swap | People ask for batched weekly summaries and complain about per-charge alerts |
| One-word tags, once a day, always skippable | Tagging plus weekly feedback is the most promising combination in the research, and my bank sends no purchase times, so a daytime batch avoids pinging people mid-ride at night |
| Suggest swaps, never block apps | Blockers get bypassed or tuned out within about two weeks; a pause with an easy way out worked better than more friction ([one sec, PNAS 2023](https://www.pnas.org/doi/10.1073/pnas.2213114120)) |
| Night rides counted but never a swap target | Safety at night is a protected reason students give for riding |
| Forgiving payback (spread over 4 weeks) instead of streaks | Streak resets and guilt are common reasons people quit |
| "Unsorted" instead of guessing on ambiguous charges | A wrong category is worse than an honest unknown |
| Never recommend unlicensed ride services | Students use them for price, but a product can't recommend options without proper licensing and insurance |

## What I changed my mind about

1. **Delivery to food and getting around.** My own ledger showed delivery was about 3% of my spending.
2. **Live pilot to desk research.** I couldn't run a test with other students, so I replaced discovery interviews with verified online research. That covers discovery. It does **not** show that a weekly number changes behavior; that is the riskiest assumption and needs a real test.
3. **Recommending a cheaper ride app to cutting it.** It was the obvious cheap option and the one I use most. It's unlicensed in NYC, so it can't be a recommendation.

## How the code works

| File | What it does |
|---|---|
| `pull.py` | Links one card through Plaid (in person or via a Plaid-hosted link), pulls ~400 days of history, and keeps only food and getting-around charges. Everything else is dropped in memory and never saved. |
| `ledger.py` | Prints a full every-dollar ledger for the account owner without saving it: card payments, transfers, refunds, Zelle with friends, and buy-now-pay-later all reconciled. |
| `test_pull.py` | 16 offline tests (no keys needed): categories, Uber vs Uber Eats, transfers that look like rides, history loading, privacy. |
| `prototype/index.html` | Single-file clickable prototype: setup, a texts thread modeled on iOS Messages, and the progress page. |

```bash
python3 -m unittest test_pull
```

Setup for running it on your own card: copy `.env.example` to `.env`, add Plaid keys, then run `python3 pull.py link --person p00`. Plaid's free Trial plan allows 10 bank links in total, ever. Personal data (`data/`), keys (`.env`) and private research notes are gitignored.

**Lessons from real data that the tests now cover:** Plaid says history is done loading before the older transactions arrive (my first pull missed 12 months). A Zelle payment to someone named "Uber" looked like a ride. Credit card payments and buy-now-pay-later had to be netted out or spending gets counted twice.

## Status

Prototype and research done (Nov 2026). Not tested with other students. Next: a small behavior test of the weekly recap, since that is the assumption desk research can't answer.
