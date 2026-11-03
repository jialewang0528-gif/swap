# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Static HTML/CSS (user's choice, 2026-11-02): one file per prototype, publishable on GitHub Pages and the portfolio site. The data tooling is Python standard library plus Plaid.

## Users
College students (any school, any year) who pay for their own food and getting around and keep overspending on it: dining out, quick food and coffee, delivery, and rides. The job: spend less on these without giving up convenience entirely, and see where the money actually goes. Founder's own case (NYU sophomore, user #1): spending jumped after moving somewhere with no kitchen and a slow subway trip.

## Product Purpose
Swap is a weekly money coach. It links a card, shows a student's real baseline for food and getting around, sets a weekly cap from a savings target, sends a Sunday recap and a one-word tag prompt after purchases, and suggests a cheaper swap that fits the student. Success means lower weekly spend against the student's own baseline, without the student quitting.

## Positioning
Empowers rather than blocks: unlike app-lockers such as Hinder, Swap never locks apps. It makes the cheaper choice easy (pickup instead of delivery, subway or a free campus shuttle instead of a ride, a dining hall instead of a sit-down meal) and uses a forgiving weekly payback instead of a hard reset.

## Operating Context
- Weekly rhythm: Sunday recap, per-purchase tags during the week.
- Delivered as texts plus a private progress page. The pilot ran by hand; no paid automation.
- Decision 2026-11-02: no live test with other students. Evidence comes from the founder's own data plus online user research (Reddit, app reviews, published surveys).

## Capabilities and Constraints
- Covers food and getting around only: dining, quick food, delivery, groceries, rides, transit. Shopping, rent and travel are out of scope.
- Bank categories are unreliable (Plaid files at least one ride app as a cash-advance payment), so detection uses charge text.
- Total cost must stay $0.
- Never recommend unlicensed or uninsured services as swaps.

## Brand Commitments
- Working name: Swap (placeholder).
- Copy is concise and literal: label + number, no cute phrasing.
- Clean, light, soft pastel look; not dense or "nerdy."
- Prototypes must look like the real platform (e.g. real iOS Messages), not a stylized redraw.

## Evidence on Hand
- Founder's spending autopsy: `research/my-spending-autopsy.md` (private, gitignored).
- Product spec with verified market and behavioral research: `~/.plans/nyu-delivery-spend-spec.md`.
- No testimonials, user counts or pilot results exist. Do not fabricate any.

## Product Principles
1. Show the real number first; most students underestimate convenience spending.
2. Make the cheaper option easier, never punish.
3. One weekly decision, not daily budgeting chores.
4. Forgive bad weeks so people don't quit.
5. Privacy by default: keep only the categories the product needs.
